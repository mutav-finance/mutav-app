import { v } from "convex/values";
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
export const MUTAV_STAFF_LADDER = [
  "support",
  "compliance",
  "admin",
] as const satisfies readonly MutavStaffRole[];

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
 * (`createStaffRole` / `deleteStaffRole`) and the genesis `bootstrapFirstAdmin`.
 * Rendered client-side via `t('errors.<code>')` lookup — never surface raw
 * messages.
 *
 * `LAST_ADMIN_LOCKOUT` guards against dropping the admin count below 1 by
 * revocation (either self-revoke or mutual revoke). `USER_NOT_FOUND` covers
 * the "no `users` row for that auth0Sub yet" case — the target must have
 * logged in at least once before being granted a role.
 * `ADMIN_ALREADY_EXISTS` is emitted only by `bootstrapFirstAdmin` when an
 * admin row is already present; further admins must go through
 * `createStaffRole` under the regular audited path.
 */
export const MUTAV_STAFF_ERROR_CODE = {
  ADMIN_ALREADY_EXISTS: "ADMIN_ALREADY_EXISTS",
  LAST_ADMIN_LOCKOUT: "LAST_ADMIN_LOCKOUT",
  ROLE_ALREADY_EXISTS: "ROLE_ALREADY_EXISTS",
  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
} as const;

export type MutavStaffErrorCode =
  (typeof MUTAV_STAFF_ERROR_CODE)[keyof typeof MUTAV_STAFF_ERROR_CODE];
