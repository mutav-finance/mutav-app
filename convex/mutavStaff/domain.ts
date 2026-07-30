import { v } from "convex/values";
import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";

// ─── Mutav staff ────────────────────────────────────────────────────────────────
//
// A `mutavStaff` row grants a single internal staff capability to a `users`
// row. One row per (user, role) — a person who is both compliance and admin
// holds two rows. This is Mutav-org membership: distinct from `memberships`
// (agency-scoped) because staff have NO agency context and act across all
// agencies. See docs/architecture/admin.md.

export type MutavStaff = Doc<"mutavStaff">;
export type MutavStaffId = Id<"mutavStaff">;
export type MutavStaffRole = MutavStaff["role"];

export const MUTAV_STAFF_ROLE = {
  ADMIN: "admin",
  COMPLIANCE: "compliance",
  SUPPORT: "support",
  TREASURY: "treasury",
} as const satisfies Record<Uppercase<MutavStaffRole>, MutavStaffRole>;

export const mutavStaffRoleValidator = v.union(
  v.literal(MUTAV_STAFF_ROLE.ADMIN),
  v.literal(MUTAV_STAFF_ROLE.COMPLIANCE),
  v.literal(MUTAV_STAFF_ROLE.SUPPORT),
  v.literal(MUTAV_STAFF_ROLE.TREASURY),
);

/**
 * The operational authority ladder — `support` < `compliance` < `admin`.
 * `minRole` gates (KYC review, parameter changes) are checked against THIS
 * ladder only.
 *
 * `treasury` is intentionally NOT on the ladder: it's an orthogonal custody
 * capability (attestation), not "more authority than compliance". A treasury
 * member must never satisfy an operational `minRole` gate by accident — so
 * treasury-specific capabilities are checked with `hasExactRole`, never
 * `meetsMinRole`. Folding treasury into a linear order is the exact bug that
 * would let a custody role approve KYC.
 */
export const MUTAV_STAFF_LADDER = ["support", "compliance", "admin"] as const;

export type MutavLadderRole = (typeof MUTAV_STAFF_LADDER)[number];

/**
 * True when the staff member holds at least one ladder role satisfying
 * `minRole`. Roles off the ladder (treasury) never satisfy an operational
 * gate. Empty role set ⇒ false (fail-closed).
 */
export const meetsMinRole = (
  roles: readonly MutavStaffRole[],
  minRole: MutavLadderRole,
): boolean => {
  const need = MUTAV_STAFF_LADDER.indexOf(minRole);
  return roles.some((role) => {
    const have = MUTAV_STAFF_LADDER.findIndex((ladderRole) => ladderRole === role);
    return have >= 0 && have >= need;
  });
};

/** True when the staff member holds the exact role. For orthogonal capabilities (treasury). */
export const hasExactRole = (roles: readonly MutavStaffRole[], role: MutavStaffRole): boolean =>
  roles.includes(role);

/**
 * Error codes returned by the admin-panel staff-provisioning mutations
 * (`createStaffRole` / `deleteStaffRole`). Rendered client-side via
 * `t('errors.<code>')` lookup — never surface raw messages.
 *
 * `SELF_REVOKE_LAST_ADMIN` guards against an admin locking every admin out by
 * revoking their own last `admin` row when nobody else holds it.
 * `USER_NOT_FOUND` covers the "no `users` row for that auth0Sub yet" case —
 * the target must have logged in at least once before being granted a role.
 */
export const MUTAV_STAFF_ERROR_CODE = {
  ROLE_ALREADY_EXISTS: "ROLE_ALREADY_EXISTS",
  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  SELF_REVOKE_LAST_ADMIN: "SELF_REVOKE_LAST_ADMIN",
  USER_NOT_FOUND: "USER_NOT_FOUND",
} as const;

export type MutavStaffErrorCode =
  (typeof MUTAV_STAFF_ERROR_CODE)[keyof typeof MUTAV_STAFF_ERROR_CODE];

/**
 * Auth0 custom claim carrying the staff member's Mutav roles, namespaced per
 * Auth0's custom-claim rules. Injected by the admin app's Post-Login Action
 * (Auth0 dashboard) from the user's group membership. This constant MUST match
 * the claim name the Action sets — it is the contract between the IdP and the
 * `mutavStaff` provisioning path.
 */
export const MUTAV_ROLES_CLAIM = "https://mutav.finance/mutav_roles";

/**
 * Parse + validate the roles claim off a decoded token. Returns only values
 * that are real `MutavStaffRole`s; anything malformed or unknown is dropped
 * (fail-closed). Reads via the `UserIdentity` index signature with runtime
 * guards — no cast.
 */
export function readMutavRolesClaim(identity: UserIdentity): MutavStaffRole[] {
  const claim = identity[MUTAV_ROLES_CLAIM];
  if (!Array.isArray(claim)) return [];
  const valid = new Set<string>(Object.values(MUTAV_STAFF_ROLE));
  return claim.filter(
    (entry): entry is MutavStaffRole => typeof entry === "string" && valid.has(entry),
  );
}
