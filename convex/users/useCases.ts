import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { DEV_USER_PUBLIC_ID, UnauthenticatedError, queryWithAuth } from "../lib/auth";

/**
 * Resolves the current user using the same precedence as the auth
 * wrappers: JWT subject when Auth0 is wired, dev-user fallback only when
 * the deployment has no Auth0 configured.
 *
 * Returns `null` (instead of throwing) for two states the UI must
 * distinguish from "unknown error":
 * - Auth0 wired, JWT absent → user is signed out, render the public shell.
 * - Auth0 wired, JWT present, but no Convex row yet → first login mid-flight,
 *   the provisioning hook is about to write the row.
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
    if (identity) {
      return ctx.db
        .query("users")
        .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
        .unique();
    }
    if (process.env.AUTH0_DOMAIN) return null;
    return ctx.db
      .query("users")
      .withIndex("by_publicId", (q) => q.eq("publicId", DEV_USER_PUBLIC_ID))
      .unique();
  },
});

/**
 * First-login provisioning. Idempotent and safe to call on every
 * authenticated session start — the typical caller is the Auth0
 * `onCallback` hook in `src/lib/auth0.ts`, but client code can also
 * call this when it observes `getMe` returning `null` despite a valid
 * Auth0 session (e.g. users who signed up via Auth0 before this
 * provisioning path existed).
 *
 * Three resolution paths, in order:
 * 1. Existing row with matching `subject` → return it unchanged.
 * 2. Existing row with matching `email` and no `subject` yet → link by
 *    patching the subject onto the existing row (covers users created
 *    pre-Auth0 by older flows that only stored email).
 * 3. No match → insert a fresh row keyed on subject + email.
 *
 * No args: identity is read from `ctx.auth.getUserIdentity()`. The
 * argless shape is a security invariant — accepting `subject` from
 * client args would let any authenticated user impersonate any other.
 */
export const getOrCreateByIdentity = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new UnauthenticatedError("getOrCreateByIdentity requires a JWT");
    }

    const subject = identity.subject;
    const email = identity.email ?? "";
    const name = identity.name ?? identity.nickname ?? email.split("@")[0] ?? "user";

    const bySubject = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    if (bySubject) {
      return { userId: bySubject._id, created: false, linked: false };
    }

    if (email) {
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (byEmail && !byEmail.subject) {
        await ctx.db.patch(byEmail._id, { subject });
        return { userId: byEmail._id, created: false, linked: true };
      }
    }

    const userId = await ctx.db.insert("users", {
      publicId: cryptoRandomPublicId(),
      subject,
      email,
      name,
      createdAt: new Date().toISOString(),
    });
    return { userId, created: true, linked: false };
  },
});

/**
 * SECURITY POSTURE (legacy, dev only): unscoped public read by publicId.
 * Used to retain backwards compatibility for any tooling still pointing
 * at the pre-Auth0 dev-user lookup. New code should call `getMe` instead;
 * this endpoint disappears with the dev-user row.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
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
