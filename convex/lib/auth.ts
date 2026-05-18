import { v } from "convex/values";
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "../_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { User } from "../users/domain";
import type { Membership } from "../agencies/domain";

/**
 * Authenticated identity helpers + per-handler wrappers.
 *
 * Pre-Auth0 (current state): identity is resolved by looking up the hardcoded
 * `dev-user` row — same shortcut the client's `WorkspaceContext` uses. When
 * Auth0 ships, swap `resolveCurrentUser` below to read `ctx.auth.getUserIdentity()`
 * and look up the user by JWT subject. Every wrapped handler picks up the
 * change for free; no per-handler edits.
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
 * Pre-Auth0 dev shortcut — only active when AUTH0_ISSUER_BASE_URL is unset.
 * Deleted when Auth0 is wired: every wrapped handler picks up the swap for free.
 */
const DEV_USER_PUBLIC_ID = "dev-user";

async function resolveCurrentUser(ctx: DbCtx): Promise<User> {
  const identity = await ctx.auth.getUserIdentity();

  if (identity) {
    // Auth0 path — JWT present and validated by Convex against auth.config.ts.
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (!user) {
      // Row not yet provisioned — this can happen if the Auth0 callback route
      // handler hasn't called `getOrCreateByIdentity` yet (race on first login).
      throw new UnauthenticatedError("User row not provisioned — retry after login callback");
    }
    return user;
  }

  // Dev fallback — active only when no JWT is present (Auth0 not wired yet).
  // Remove this block once AUTH0_ISSUER_BASE_URL is set in all environments.
  const user = await ctx.db
    .query("users")
    .withIndex("by_publicId", (q) => q.eq("publicId", DEV_USER_PUBLIC_ID))
    .unique();
  if (!user) {
    throw new UnauthenticatedError(
      `Dev user '${DEV_USER_PUBLIC_ID}' not found — run \`bunx convex run seed\``,
    );
  }
  return user;
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
