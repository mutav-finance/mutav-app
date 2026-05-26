import { mutation, query } from "../_generated/server";
import { UnauthenticatedError, queryWithAuth } from "../lib/auth";

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
    const email = identity.email;
    // The schema's `users.email` is `v.string()` and `by_email` is unique.
    // Storing `""` for a no-email JWT (e.g. some social connections that
    // omit the email scope) would let a second no-email user collide on
    // `.unique()`. Refuse provisioning instead — Auth0 social connections
    // can be configured to require email, and password connections
    // always carry it.
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
      return { userId: bySubject._id, created: false, linked: false };
    }

    const byEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (byEmail && !byEmail.subject) {
      await ctx.db.patch(byEmail._id, { subject });
      return { userId: byEmail._id, created: false, linked: true };
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
