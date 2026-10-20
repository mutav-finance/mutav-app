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

/** True when `role` may manage the agency's members and invites. */
export const canManageMembers = (role: MemberRole): boolean => hasRole(role, MEMBER_ROLE.ADMIN);

// ─── Member management ────────────────────────────────────────────────────────

export type AgencyInvite = Doc<"agencyInvites">;
export type AgencyInviteId = Id<"agencyInvites">;
export type InvitableRole = AgencyInvite["role"];
export type InviteStatus = AgencyInvite["status"];

export const INVITABLE_ROLE = {
  ADMIN: "admin",
  MEMBER: "member",
} as const satisfies Record<Uppercase<InvitableRole>, InvitableRole>;

export const invitableRoleValidator = v.union(
  v.literal(INVITABLE_ROLE.ADMIN),
  v.literal(INVITABLE_ROLE.MEMBER),
);

export const INVITE_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REVOKED: "revoked",
  EXPIRED: "expired",
} as const satisfies Record<Uppercase<InviteStatus>, InviteStatus>;

export const inviteStatusValidator = v.union(
  v.literal(INVITE_STATUS.PENDING),
  v.literal(INVITE_STATUS.ACCEPTED),
  v.literal(INVITE_STATUS.REVOKED),
  v.literal(INVITE_STATUS.EXPIRED),
);

export const INVITE_TTL_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const MEMBERSHIP_ERROR_CODE = {
  INVALID_EMAIL: "INVALID_EMAIL",
  INVITE_ALREADY_PENDING: "INVITE_ALREADY_PENDING",
  ALREADY_MEMBER: "ALREADY_MEMBER",
  INVITE_NOT_FOUND: "INVITE_NOT_FOUND",
  INVITE_NOT_PENDING: "INVITE_NOT_PENDING",
  INVITE_EXPIRED: "INVITE_EXPIRED",
  INVITE_EMAIL_MISMATCH: "INVITE_EMAIL_MISMATCH",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  MEMBERSHIP_NOT_FOUND: "MEMBERSHIP_NOT_FOUND",
  CANNOT_CHANGE_OWN_ROLE: "CANNOT_CHANGE_OWN_ROLE",
  CANNOT_REMOVE_SELF: "CANNOT_REMOVE_SELF",
  INSUFFICIENT_ROLE: "INSUFFICIENT_ROLE",
  LAST_OWNER: "LAST_OWNER",
} as const;

export type MembershipErrorCode =
  (typeof MEMBERSHIP_ERROR_CODE)[keyof typeof MEMBERSHIP_ERROR_CODE];

// Deliberately loose: one `@`, a dot in the domain, no whitespace. Deliverability
// is proven by the invitee signing in with that address, not by this check.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isValidEmail = (email: string): boolean => EMAIL_SHAPE.test(normalizeEmail(email));

export const computeInviteExpiry = (createdAt: string): string =>
  new Date(Date.parse(createdAt) + INVITE_TTL_DAYS * MS_PER_DAY).toISOString();

export const isInviteExpired = ({ expiresAt }: Pick<AgencyInvite, "expiresAt">, now: string) =>
  Date.parse(expiresAt) <= Date.parse(now);

/** A pending invite that has not reached its expiry — the only acceptable kind. */
export const isInviteOpen = (invite: Pick<AgencyInvite, "status" | "expiresAt">, now: string) =>
  invite.status === INVITE_STATUS.PENDING && !isInviteExpired(invite, now);

// `userId` widened to string: the rules only compare identities, never load them.
type MemberRef = { userId: string; role: MemberRole };

type MemberChangeDecision<TCode extends MembershipErrorCode> =
  | { allowed: true }
  | { allowed: false; code: TCode };

export type RoleChangeRefusalCode =
  | typeof MEMBERSHIP_ERROR_CODE.CANNOT_CHANGE_OWN_ROLE
  | typeof MEMBERSHIP_ERROR_CODE.INSUFFICIENT_ROLE
  | typeof MEMBERSHIP_ERROR_CODE.LAST_OWNER;

export type RemovalRefusalCode =
  | typeof MEMBERSHIP_ERROR_CODE.CANNOT_REMOVE_SELF
  | typeof MEMBERSHIP_ERROR_CODE.INSUFFICIENT_ROLE
  | typeof MEMBERSHIP_ERROR_CODE.LAST_OWNER;

/**
 * Who may move whom to which role. Owners may do anything except touch their
 * own row; admins manage admins and members but never an owner, and never
 * grant ownership. An agency always keeps at least one owner.
 */
export function decideRoleChange({
  actor,
  target,
  nextRole,
  ownerCount,
}: {
  actor: MemberRef;
  target: MemberRef;
  nextRole: MemberRole;
  ownerCount: number;
}): MemberChangeDecision<RoleChangeRefusalCode> {
  if (actor.userId === target.userId) {
    return { allowed: false, code: MEMBERSHIP_ERROR_CODE.CANNOT_CHANGE_OWN_ROLE };
  }
  if (!canManageMembers(actor.role)) {
    return { allowed: false, code: MEMBERSHIP_ERROR_CODE.INSUFFICIENT_ROLE };
  }
  const touchesOwnership = target.role === MEMBER_ROLE.OWNER || nextRole === MEMBER_ROLE.OWNER;
  if (touchesOwnership && actor.role !== MEMBER_ROLE.OWNER) {
    return { allowed: false, code: MEMBERSHIP_ERROR_CODE.INSUFFICIENT_ROLE };
  }
  if (target.role === MEMBER_ROLE.OWNER && nextRole !== MEMBER_ROLE.OWNER && ownerCount <= 1) {
    return { allowed: false, code: MEMBERSHIP_ERROR_CODE.LAST_OWNER };
  }
  return { allowed: true };
}

/** Same ladder as `decideRoleChange`, for taking someone out of the agency. */
export function decideRemoval({
  actor,
  target,
  ownerCount,
}: {
  actor: MemberRef;
  target: MemberRef;
  ownerCount: number;
}): MemberChangeDecision<RemovalRefusalCode> {
  if (actor.userId === target.userId) {
    return { allowed: false, code: MEMBERSHIP_ERROR_CODE.CANNOT_REMOVE_SELF };
  }
  if (!canManageMembers(actor.role)) {
    return { allowed: false, code: MEMBERSHIP_ERROR_CODE.INSUFFICIENT_ROLE };
  }
  if (target.role === MEMBER_ROLE.OWNER && actor.role !== MEMBER_ROLE.OWNER) {
    return { allowed: false, code: MEMBERSHIP_ERROR_CODE.INSUFFICIENT_ROLE };
  }
  if (target.role === MEMBER_ROLE.OWNER && ownerCount <= 1) {
    return { allowed: false, code: MEMBERSHIP_ERROR_CODE.LAST_OWNER };
  }
  return { allowed: true };
}
