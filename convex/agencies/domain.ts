import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

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

export const ONBOARDING_DECISION = {
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type OnboardingDecision = (typeof ONBOARDING_DECISION)[keyof typeof ONBOARDING_DECISION];

export const onboardingDecisionValidator = v.union(
  v.literal(ONBOARDING_DECISION.APPROVED),
  v.literal(ONBOARDING_DECISION.REJECTED),
);

export const bankingInfoValidator = v.object({
  bank: v.string(),
  agency: v.optional(v.string()),
  account: v.string(),
  accountType: v.union(v.literal("corrente"), v.literal("poupanca")),
  pixKey: v.optional(v.string()),
});

export const agencyDocumentKindValidator = v.union(
  v.literal(AGENCY_DOCUMENT_KIND.DOCUMENTO_EMPRESA),
  v.literal(AGENCY_DOCUMENT_KIND.RESPONSAVEL_ID),
);

/** Documents required for `empresa` type. `autonomo` skips all uploads. */
export const EMPRESA_REQUIRED_DOCS: readonly AgencyDocumentKind[] = [
  AGENCY_DOCUMENT_KIND.DOCUMENTO_EMPRESA,
  AGENCY_DOCUMENT_KIND.RESPONSAVEL_ID,
];

/**
 * Legal onboarding moves. `rejected → in_progress` is the resubmit path the
 * agency owner opens with `reopenOnboarding`; `active` has no exit.
 */
export const ONBOARDING_TRANSITIONS = {
  not_started: ["in_progress"],
  in_progress: ["submitted"],
  submitted: ["under_review", "active", "rejected"],
  under_review: ["active", "rejected"],
  rejected: ["in_progress"],
  active: [],
} as const satisfies Record<OnboardingState, readonly OnboardingState[]>;

export function canTransitionOnboarding({
  from,
  to,
}: {
  from: OnboardingState;
  to: OnboardingState;
}): boolean {
  const allowed: readonly OnboardingState[] = ONBOARDING_TRANSITIONS[from];
  return allowed.includes(to);
}

/** Returns true when the onboarding is in a terminal state. */
export function isTerminalOnboardingState(state: OnboardingState): boolean {
  return state === ONBOARDING_STATE.ACTIVE || state === ONBOARDING_STATE.REJECTED;
}

// Checksum validation moved to the shared lib so the tenants domain can
// reuse it without cross-domain imports; re-exported here so existing
// consumers keep compiling.
export { isValidCPF, isValidCNPJ } from "../lib/taxId";

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
