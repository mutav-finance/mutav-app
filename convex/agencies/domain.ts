import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { agencyDocumentKindValidator as _agencyDocumentKindValidator } from "./validators";

// ─── Agency ───────────────────────────────────────────────────────────────────

export type Agency = Doc<"agencies">;
export type AgencyId = Id<"agencies">;
export type AgencyType = NonNullable<Agency["agencyType"]>;
export type OnboardingState = NonNullable<Agency["onboardingState"]>;
export type BankingInfo = NonNullable<Agency["bankingInfo"]>;
export type AgencyDocument = Doc<"agencyDocuments">;
export type AgencyDocumentId = Id<"agencyDocuments">;
export type AgencyDocumentKind = AgencyDocument["kind"];

export const AGENCY_TYPE = {
  AUTONOMO: "autonomo",
  EMPRESA: "empresa",
} as const satisfies Record<Uppercase<AgencyType>, AgencyType>;

export const ONBOARDING_STATE = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  ACTIVE: "active",
  REJECTED: "rejected",
} as const satisfies Record<Uppercase<OnboardingState>, OnboardingState>;

export const AGENCY_DOCUMENT_KIND = {
  DOCUMENTO_EMPRESA: "documento_empresa",
  RESPONSAVEL_ID: "responsavel_id",
} as const satisfies Record<Uppercase<AgencyDocumentKind>, AgencyDocumentKind>;

export const agencyTypeValidator = v.union(
  v.literal(AGENCY_TYPE.AUTONOMO),
  v.literal(AGENCY_TYPE.EMPRESA),
);

export const onboardingStateValidator = v.union(
  v.literal(ONBOARDING_STATE.NOT_STARTED),
  v.literal(ONBOARDING_STATE.IN_PROGRESS),
  v.literal(ONBOARDING_STATE.SUBMITTED),
  v.literal(ONBOARDING_STATE.UNDER_REVIEW),
  v.literal(ONBOARDING_STATE.ACTIVE),
  v.literal(ONBOARDING_STATE.REJECTED),
);

export const bankingInfoValidator = v.object({
  bank: v.string(),
  agency: v.string(),
  account: v.string(),
  accountType: v.union(v.literal("corrente"), v.literal("poupanca")),
  pixKey: v.optional(v.string()),
});

export const agencyDocumentKindValidator = _agencyDocumentKindValidator;

/** Documents required for `empresa` type. `autonomo` skips all uploads. */
export const EMPRESA_REQUIRED_DOCS: AgencyDocumentKind[] = [
  AGENCY_DOCUMENT_KIND.DOCUMENTO_EMPRESA,
  AGENCY_DOCUMENT_KIND.RESPONSAVEL_ID,
];

/** Returns true when the onboarding is in a terminal state. */
export function isTerminalOnboardingState(state: OnboardingState): boolean {
  return state === ONBOARDING_STATE.ACTIVE || state === ONBOARDING_STATE.REJECTED;
}

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
export const MEMBER_ROLE_ORDER = [
  "member",
  "admin",
  "owner",
] as const satisfies readonly MemberRole[];

/** Returns true when `userRole` satisfies the `required` minimum. */
export const hasRole = (userRole: MemberRole, required: MemberRole): boolean =>
  MEMBER_ROLE_ORDER.indexOf(userRole) >= MEMBER_ROLE_ORDER.indexOf(required);
