import { v } from "convex/values";
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "../_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { User } from "../users/domain";
import type { Membership } from "../agencies/domain";

/**
 * Authenticated identity helpers + per-handler wrappers.
 *
 * Identity resolution is JWT-first with a dev-user fallback:
 *
 * 1. **Auth0 wired** (`AUTH0_DOMAIN` + `AUTH0_CLIENT_ID` set on the Convex
 *    deployment): `ctx.auth.getUserIdentity()` returns the decoded ID
 *    token. We look up the user by `subject` (the `{issuer}|{userId}` JWT
 *    claim). First-login provisioning happens via
 *    `users.getOrCreateByIdentity` — wrappers throw `UnauthenticatedError`
 *    if the row hasn't been created yet, which the client recovers from by
 *    calling `getOrCreateByIdentity` once at session start.
 *
 * 2. **Auth0 unwired** (env vars absent, dev/preview default): identity
 *    falls back to the `dev-user` row by `publicId`. The fallback is
 *    gated by the same env presence used in `auth.config.ts`, so prod
 *    cannot accidentally land here — if `AUTH0_DOMAIN` is set but the
 *    JWT is missing, the handler errors instead of silently impersonating.
 *
 * Wrappers:
 * - `queryWithAuth` / `mutationWithAuth` — adds `ctx.user` (the resolved
 *   `User` doc). Use for handlers that don't carry an agency in their args
 *   (e.g. listing the current user's own agencies).
 * - `queryWithAgencyScope` / `mutationWithAgencyScope` — takes `agencyId` as
 *   a required arg, asserts the user has membership in that agency, and adds
 *   `ctx.user`, `ctx.membership`, `ctx.agencyId` to the handler ctx. The
 *   `agencyId` arg is consumed by the wrapper and removed from handler args.
 * - `assertAgencyAccess(ctx, agencyId)` — inline check for handlers that
 *   derive the agency from a resource rather than args (e.g. resource-by-id
 *   lookups). Throws `ForbiddenError` if the resolved user has no membership.
 *
 * NEVER accept a `userId` / `tokenIdentifier` / `subject` from client args
 * for authorization. Always derive identity server-side via these wrappers.
 */

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;
type DbCtx = QueryCtx | MutationCtx;

export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Dev fallback identity used when Auth0 is not configured on the Convex
 * deployment. Matches the `publicId` of the row inserted by `seed.ts`.
 * The constant lives here (and in `testFixtures.ts`) — the client no
 * longer imports it. Once Auth0 is set in every environment, this
 * constant and the fallback branch in `resolveCurrentUser` go away.
 */
export const DEV_USER_PUBLIC_ID = "dev-user";

async function resolveCurrentUser(ctx: DbCtx): Promise<User> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (!user) {
      // The JWT is valid but no Convex row exists yet — the client must
      // call `users.getOrCreateByIdentity` once at session start to
      // provision. Throwing here surfaces the missing provisioning
      // explicitly instead of silently failing reads.
      throw new UnauthenticatedError(
        "Authenticated, but no user row provisioned. " +
          "Call `users.getOrCreateByIdentity` once at session start.",
      );
    }
    return user;
  }

  // No JWT. Two cases:
  //   (a) Auth0 is configured on this deployment → request is genuinely
  //       unauthenticated, fail closed.
  //   (b) Auth0 is unconfigured (dev/preview) → fall back to dev-user.
  // The presence of the Auth0 domain env var distinguishes the two so
  // prod cannot accidentally accept anonymous requests as `dev-user`.
  if (process.env.AUTH0_DOMAIN) {
    throw new UnauthenticatedError("Authentication required");
  }

  const fallback = await ctx.db
    .query("users")
    .withIndex("by_publicId", (q) => q.eq("publicId", DEV_USER_PUBLIC_ID))
    .unique();
  if (!fallback) {
    throw new UnauthenticatedError(
      `Dev user '${DEV_USER_PUBLIC_ID}' not found — run \`bunx convex run seed\` ` +
        "(or set AUTH0_DOMAIN to require real authentication).",
    );
  }
  return fallback;
}

async function resolveMembership(
  ctx: DbCtx,
  user: User,
  agencyId: Membership["agencyId"],
): Promise<Membership> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_agency", (q) => q.eq("userId", user._id).eq("agencyId", agencyId))
    .unique();
  if (!membership) {
    throw new ForbiddenError("User is not a member of this agency");
  }
  return membership;
}

/**
 * Verifies the current user has membership in `agencyId`. For handlers that
 * derive the agency from a fetched resource (e.g. `getByPublicId`) rather
 * than from client args.
 */
export async function assertAgencyAccess(
  ctx: DbCtx,
  agencyId: Membership["agencyId"],
): Promise<Membership> {
  const user = await resolveCurrentUser(ctx);
  return resolveMembership(ctx, user, agencyId);
}

// ─── Wrappers ─────────────────────────────────────────────────────────────────

export const queryWithAuth = customQuery(query, {
  args: {},
  input: async (ctx) => {
    const user = await resolveCurrentUser(ctx);
    return { ctx: { user }, args: {} };
  },
});

export const mutationWithAuth = customMutation(mutation, {
  args: {},
  input: async (ctx) => {
    const user = await resolveCurrentUser(ctx);
    return { ctx: { user }, args: {} };
  },
});

export const queryWithAgencyScope = customQuery(query, {
  args: { agencyId: v.id("agencies") },
  input: async (ctx, { agencyId }) => {
    const user = await resolveCurrentUser(ctx);
    const membership = await resolveMembership(ctx, user, agencyId);
    return { ctx: { user, membership, agencyId }, args: {} };
  },
});

export const mutationWithAgencyScope = customMutation(mutation, {
  args: { agencyId: v.id("agencies") },
  input: async (ctx, { agencyId }) => {
    const user = await resolveCurrentUser(ctx);
    const membership = await resolveMembership(ctx, user, agencyId);
    return { ctx: { user, membership, agencyId }, args: {} };
  },
});

// ─── Lower-level helpers (kept for non-DB ctx and existing callers) ──────────

/**
 * Returns the authenticated identity or throws `UnauthenticatedError`.
 * Use only for `ActionCtx` (where the wrappers don't apply because actions
 * have no `ctx.db`). Prefer the wrappers for queries/mutations.
 */
export async function requireIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new UnauthenticatedError();
  }
  return identity;
}

/**
 * Returns the identity if present, or `null` otherwise. Use only in functions
 * that are intentionally public — document why inline.
 */
export async function getOptionalIdentity(ctx: AnyCtx) {
  return ctx.auth.getUserIdentity();
}
