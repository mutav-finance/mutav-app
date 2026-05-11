import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

// ─── Agency ───────────────────────────────────────────────────────────────────

export type Agency = Doc<"agencies">;
export type AgencyId = Id<"agencies">;

// ─── Membership ───────────────────────────────────────────────────────────────

export type Membership = Doc<"memberships">;
export type MembershipId = Id<"memberships">;
export type MemberRole = Membership["role"];

export const MEMBER_ROLE = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const satisfies Record<Uppercase<MemberRole>, MemberRole>;

export const memberRoleValidator = v.union(
  v.literal(MEMBER_ROLE.OWNER),
  v.literal(MEMBER_ROLE.ADMIN),
  v.literal(MEMBER_ROLE.MEMBER),
);

/** Role ordering — higher index = more permissions. */
export const MEMBER_ROLE_ORDER: MemberRole[] = ["member", "admin", "owner"];

/** Returns true when `userRole` satisfies the `required` minimum. */
export const hasRole = (userRole: MemberRole, required: MemberRole): boolean =>
  MEMBER_ROLE_ORDER.indexOf(userRole) >= MEMBER_ROLE_ORDER.indexOf(required);
