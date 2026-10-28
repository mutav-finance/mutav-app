import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
import { UnauthenticatedError, queryWithAuth } from "../lib/auth";
import type { Result } from "../lib/result";
import { USER_ERROR_CODE, type UserId } from "./domain";

/**
 * Returns the current user row, or `null` for two states the UI must
 * distinguish from "unknown error":
 * - JWT absent → user is signed out, render the public shell.
 * - JWT present, but no Convex row yet → first login mid-flight; the
 *   provisioning hook is about to write the row.
 *
 * Use this for client-side identity reads (e.g. `WorkspaceContext`).
 * Server-side handlers go through `queryWithAuth` / `mutationWithAuth`
 * which throw on missing identity — that's the right shape for write
 * paths that must fail closed.
 */
export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
  },
});

type GetOrCreateByIdentitySuccessResult = {
  userId: UserId;
  created: boolean;
  linked: boolean;
};
type GetOrCreateByIdentityErrorResult = {
  code:
    | typeof USER_ERROR_CODE.EMAIL_NOT_VERIFIED
    | typeof USER_ERROR_CODE.EMAIL_BOUND_TO_OTHER_IDENTITY;
};

/**
 * First-login provisioning. Idempotent and safe to call on every
 * authenticated session start — the typical caller is the Auth0
 * `onCallback` hook in `src/lib/auth0.ts`, but client code can also
 * call this when it observes `getMe` returning `null` despite a valid
 * Auth0 session (e.g. users who signed up via Auth0 before this
 * provisioning path existed).
 *
 * Resolution paths, in order:
 * 1. Existing row with matching `subject` → return it unchanged.
 * 2. Existing row with matching `email` and no `subject` → link it, but
 *    only when the IdP vouches for the email (`emailVerified === true`).
 *    Subjectless rows are seeded or tenant-cut rows that already hold
 *    agency memberships; linking on an unverified email would hand those
 *    memberships to whoever typed the address. Unverified → error.
 * 3. Existing row with matching `email` and a different `subject` →
 *    error. Inserting a second row would break every `by_email` lookup
 *    that assumes one row per email, and silently merging would let one
 *    identity take over another's account.
 * 4. No match → insert a fresh row keyed on subject + email.
 *
 * Callers today ignore the Result: an error leaves `getMe` returning
 * `null`, which the agency app surfaces as `not-provisioned`.
 *
 * No args: identity is read from `ctx.auth.getUserIdentity()`. The
 * argless shape is a security invariant — accepting `subject` from
 * client args would let any authenticated user impersonate any other.
 */
export const getOrCreateByIdentity = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<Result<GetOrCreateByIdentitySuccessResult, GetOrCreateByIdentityErrorResult>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new UnauthenticatedError("getOrCreateByIdentity requires a JWT");
    }

    const subject = identity.subject;
    const email = identity.email;
    // Storing `""` for a no-email JWT (e.g. some social connections that
    // omit the email scope) would make every no-email user collide on the
    // same `by_email` key. Refuse provisioning instead — Auth0 social
    // connections can be configured to require email, and password
    // connections always carry it.
    if (!email) {
      throw new UnauthenticatedError(
        "Auth0 identity is missing the email claim; cannot provision user",
      );
    }
    const name = identity.name ?? identity.nickname ?? email.split("@")[0] ?? "user";

    const bySubject = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    if (bySubject) {
      return {
        success: true,
        data: { userId: bySubject._id, created: false, linked: false },
        message: "User already provisioned",
      };
    }

    // `.first()`, not `.unique()`: deployments that predate this guard may
    // already hold duplicate rows for one email, and a throw here would lock
    // that user out of provisioning entirely.
    const byEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (byEmail?.subject) {
      return {
        success: false,
        error: { code: USER_ERROR_CODE.EMAIL_BOUND_TO_OTHER_IDENTITY },
        message: "Email is already bound to another identity",
      };
    }
    if (byEmail) {
      if (identity.emailVerified !== true) {
        return {
          success: false,
          error: { code: USER_ERROR_CODE.EMAIL_NOT_VERIFIED },
          message: "Email must be verified before linking to an existing user",
        };
      }
      await ctx.db.patch(byEmail._id, { subject });
      return {
        success: true,
        data: { userId: byEmail._id, created: false, linked: true },
        message: "Existing user linked to identity",
      };
    }

    const userId = await ctx.db.insert("users", {
      publicId: cryptoRandomPublicId(),
      subject,
      email,
      name,
      createdAt: new Date().toISOString(),
    });
    return {
      success: true,
      data: { userId, created: true, linked: false },
      message: "User created",
    };
  },
});

const TENANT_CUT_BATCH_SIZE = 200;

/**
 * Auth0 tenant cut-over (#119) runbook step. A new tenant issues a new
 * `subject` for every user, so without this each returning user would hit
 * `EMAIL_BOUND_TO_OTHER_IDENTITY` against their own row. Clearing every
 * `subject` turns each row back into a subjectless row, and the user's first
 * verified-email login on the new tenant re-links it with memberships intact.
 *
 * Run it ONCE, at the cut-over, and only after the new tenant's users have
 * verified emails — an unverified login is refused, so an unverified user
 * stays locked out until they verify. Touches only `users`. Processes one
 * page per transaction and reschedules itself until the table is done; the
 * returned counts cover this invocation's page.
 */
export const clearSubjectsForTenantCut = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ scanned: number; cleared: number; isDone: boolean }> => {
    const page = await ctx.db
      .query("users")
      .paginate({ numItems: TENANT_CUT_BATCH_SIZE, cursor: args.cursor ?? null });

    let cleared = 0;
    for (const user of page.page) {
      if (user.subject === undefined) continue;
      await ctx.db.patch(user._id, { subject: undefined });
      cleared++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.users.useCases.clearSubjectsForTenantCut, {
        cursor: page.continueCursor,
      });
    }

    return { scanned: page.page.length, cleared, isDone: page.isDone };
  },
});

/**
 * Internal-only: surface the current user's resolved row to other Convex
 * modules without re-implementing the JWT-subject lookup. Mirrors
 * `queryWithAuth` semantics — throws on missing identity.
 */
export const getCurrent = queryWithAuth({
  args: {},
  handler: async (ctx) => ctx.user,
});

function cryptoRandomPublicId(): string {
  // 16 hex chars (~64 bits of entropy) — uniqueness check is by_publicId
  // and by_subject below; collisions are astronomically unlikely at our
  // scale, and the index would catch one anyway.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let hex = "user-";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
