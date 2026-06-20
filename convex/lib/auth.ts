import { v } from "convex/values";
import type { UserIdentity } from "convex/server";
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "../_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { User } from "../users/domain";
import type { Membership } from "../agencies/domain";
import type { AppendAuditEntryInput } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { meetsMinRole } from "../mutavStaff/domain";
import type { MutavLadderRole, MutavStaffRole } from "../mutavStaff/domain";
import { getAuth0AdminClientId } from "./env";

/**
 * Authenticated identity helpers + per-handler wrappers.
 *
 * `ctx.auth.getUserIdentity()` returns the decoded ID token issued by
 * Auth0; we look up the user by `subject` (the `{issuer}|{userId}` JWT
 * claim). First-login provisioning happens via
 * `users.getOrCreateByIdentity` — wrappers throw `UnauthenticatedError`
 * if the row hasn't been created yet, which the client recovers from by
 * calling `getOrCreateByIdentity` once at session start.
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

async function resolveCurrentUser(ctx: DbCtx): Promise<User> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new UnauthenticatedError("Authentication required");
  }
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

// ─── Mutav staff wrappers ────────────────────────────────────────────────────
//
// Staff (Mutav-org) authorization. Distinct from the agency wrappers: staff act
// across ALL agencies with no agency context, so these inject `ctx.user` +
// `ctx.mutavStaffRoles` (never `ctx.agencyId`). They are mutually exclusive
// with `*WithAgencyScope`.
//
// LOAD-BEARING SECURITY: every staff wrapper binds to the admin app's audience.
// Agency and admin are two Auth0 apps on one Convex deployment (two providers
// in auth.config.ts), and identity is keyed on `subject` — so without this
// bind, an agency-app token for a human who also holds a `mutavStaff` row would
// be a valid credential for staff functions. The aud-bind makes the dedicated
// admin app (confidential, MFA, short session) actually mean something at the
// Convex boundary. When admin isn't wired (empty admin client id), it denies
// all staff access (fail-closed).

type StaffAuditInput = Omit<AppendAuditEntryInput, "actor">;

/**
 * Asserts the presenting token was issued to the admin Auth0 application.
 * Auth0 `aud` is the client id (a string), or an array when multiple audiences
 * are requested — accept either shape. Reads a deserialized JWT claim via the
 * `UserIdentity` index signature; narrowed with runtime guards, no cast.
 */
function assertAdminAudience(identity: UserIdentity): void {
  const adminAud = getAuth0AdminClientId();
  const aud = identity.aud;
  const ok =
    adminAud !== "" && (aud === adminAud || (Array.isArray(aud) && aud.includes(adminAud)));
  if (!ok) {
    throw new ForbiddenError("Staff capability requires an admin-app session");
  }
}

async function resolveStaffUser(ctx: DbCtx): Promise<{ user: User; roles: MutavStaffRole[] }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new UnauthenticatedError("Authentication required");
  }
  assertAdminAudience(identity);
  const user = await resolveCurrentUser(ctx);
  const staffRows = await ctx.db
    .query("mutavStaff")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  if (staffRows.length === 0) {
    throw new ForbiddenError("Not a Mutav staff member");
  }
  return { user, roles: staffRows.map((row) => row.role) };
}

/** Any-staff gate (≥1 mutavStaff row). Injects `ctx.user`, `ctx.mutavStaffRoles`. */
export const queryWithMutavStaff = customQuery(query, {
  args: {},
  input: async (ctx) => {
    const { user, roles } = await resolveStaffUser(ctx);
    return { ctx: { user, mutavStaffRoles: roles }, args: {} };
  },
});

/**
 * Any-staff mutation gate. Injects `ctx.user`, `ctx.mutavStaffRoles`, and
 * `ctx.appendStaffAudit(input)` — a hash-chained audit append with the actor
 * pre-bound to the resolved staff user (the actor can't be forgotten or
 * spoofed; the handler supplies only action/resource/payload).
 */
export const mutationWithMutavStaff = customMutation(mutation, {
  args: {},
  input: async (ctx) => {
    const { user, roles } = await resolveStaffUser(ctx);
    const appendStaffAudit = (input: StaffAuditInput) =>
      appendAuditEntry(ctx, { actor: { kind: "user", userId: user._id }, ...input });
    return { ctx: { user, mutavStaffRoles: roles, appendStaffAudit }, args: {} };
  },
});

/**
 * Role-gated staff wrappers. `minRole` is checked against the operational
 * ladder (`support` < `compliance` < `admin`) via `meetsMinRole`; treasury is
 * off-ladder and never satisfies an operational gate. Fail-closed.
 */
export const queryWithMutavRole = ({ minRole }: { minRole: MutavLadderRole }) =>
  customQuery(query, {
    args: {},
    input: async (ctx) => {
      const { user, roles } = await resolveStaffUser(ctx);
      if (!meetsMinRole(roles, minRole)) {
        throw new ForbiddenError(`Requires '${minRole}' role or higher`);
      }
      return { ctx: { user, mutavStaffRoles: roles }, args: {} };
    },
  });

export const mutationWithMutavRole = ({ minRole }: { minRole: MutavLadderRole }) =>
  customMutation(mutation, {
    args: {},
    input: async (ctx) => {
      const { user, roles } = await resolveStaffUser(ctx);
      if (!meetsMinRole(roles, minRole)) {
        throw new ForbiddenError(`Requires '${minRole}' role or higher`);
      }
      const appendStaffAudit = (input: StaffAuditInput) =>
        appendAuditEntry(ctx, { actor: { kind: "user", userId: user._id }, ...input });
      return { ctx: { user, mutavStaffRoles: roles, appendStaffAudit }, args: {} };
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
