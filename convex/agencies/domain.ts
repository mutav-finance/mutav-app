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

// ─── Etherfuse onboarding ─────────────────────────────────────────────────────

export type EtherfuseOnboardingStatus = Agency["etherfuseOnboardingStatus"];

export const ETHERFUSE_ONBOARDING_STATUS = {
  NOT_STARTED: "not_started",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  UPDATE_REQUIRED: "update_required",
} as const satisfies Record<Uppercase<EtherfuseOnboardingStatus>, EtherfuseOnboardingStatus>;

export const etherfuseOnboardingStatusValidator = v.union(
  v.literal(ETHERFUSE_ONBOARDING_STATUS.NOT_STARTED),
  v.literal(ETHERFUSE_ONBOARDING_STATUS.PENDING),
  v.literal(ETHERFUSE_ONBOARDING_STATUS.APPROVED),
  v.literal(ETHERFUSE_ONBOARDING_STATUS.REJECTED),
  v.literal(ETHERFUSE_ONBOARDING_STATUS.UPDATE_REQUIRED),
);
