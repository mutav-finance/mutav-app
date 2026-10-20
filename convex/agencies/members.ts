import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { AUDIT_ACTION } from "../audit/domain";
import type { AuditActionKey } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import {
  mutationWithActiveAgencyRole,
  mutationWithAuth,
  queryWithAgencyRole,
  queryWithAgencyScope,
  queryWithAuth,
} from "../lib/auth";
import type { Result } from "../lib/result";
import type { User, UserId } from "../users/domain";
import {
  INVITE_STATUS,
  MEMBER_ROLE,
  MEMBERSHIP_ERROR_CODE,
  computeInviteExpiry,
  decideRemoval,
  decideRoleChange,
  invitableRoleValidator,
  isInviteOpen,
  isValidEmail,
  memberRoleValidator,
  normalizeEmail,
} from "./domain";
import type {
  AgencyId,
  AgencyInvite,
  AgencyInviteId,
  InvitableRole,
  MemberRole,
  MembershipId,
  RemovalRefusalCode,
  RoleChangeRefusalCode,
} from "./domain";

// Agencies are small teams; the bound keeps every read within one transaction.
const MEMBER_LIST_LIMIT = 200;
const INVITE_LIST_LIMIT = 100;

const AUDIT_RESOURCE = {
  MEMBERSHIP: "membership",
  INVITE: "agencyInvite",
} as const;

// ─── Result types ─────────────────────────────────────────────────────────────

type InviteMemberSuccessResult = { inviteId: AgencyInviteId; expiresAt: string };
type InviteMemberErrorResult = {
  code:
    | typeof MEMBERSHIP_ERROR_CODE.INVALID_EMAIL
    | typeof MEMBERSHIP_ERROR_CODE.ALREADY_MEMBER
    | typeof MEMBERSHIP_ERROR_CODE.INVITE_ALREADY_PENDING;
};

type RevokeInviteSuccessResult = { inviteId: AgencyInviteId };
type RevokeInviteErrorResult = {
  code:
    | typeof MEMBERSHIP_ERROR_CODE.INVITE_NOT_FOUND
    | typeof MEMBERSHIP_ERROR_CODE.INVITE_NOT_PENDING;
};

type ChangeMemberRoleSuccessResult = { membershipId: MembershipId; role: MemberRole };
type ChangeMemberRoleErrorResult = {
  code: typeof MEMBERSHIP_ERROR_CODE.MEMBERSHIP_NOT_FOUND | RoleChangeRefusalCode;
};

type RemoveMemberSuccessResult = { membershipId: MembershipId };
type RemoveMemberErrorResult = {
  code: typeof MEMBERSHIP_ERROR_CODE.MEMBERSHIP_NOT_FOUND | RemovalRefusalCode;
};

type AcceptInviteSuccessResult = { agencyId: AgencyId; membershipId: MembershipId };
type AcceptInviteErrorResult = {
  code:
    | typeof MEMBERSHIP_ERROR_CODE.INVITE_NOT_FOUND
    | typeof MEMBERSHIP_ERROR_CODE.INVITE_EMAIL_MISMATCH
    | typeof MEMBERSHIP_ERROR_CODE.EMAIL_NOT_VERIFIED
    | typeof MEMBERSHIP_ERROR_CODE.INVITE_NOT_PENDING
    | typeof MEMBERSHIP_ERROR_CODE.INVITE_EXPIRED
    | typeof MEMBERSHIP_ERROR_CODE.ALREADY_MEMBER;
};

// ─── Shapes ───────────────────────────────────────────────────────────────────

type MemberRow = {
  membershipId: MembershipId;
  userId: UserId;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
  isSelf: boolean;
};

type PendingInviteRow = {
  inviteId: AgencyInviteId;
  email: string;
  role: InvitableRole;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
};

type MyPendingInviteRow = {
  inviteId: AgencyInviteId;
  agencyName: string;
  role: InvitableRole;
  invitedByName: string | null;
  expiresAt: string;
};

function shapePendingInvite(invite: AgencyInvite, inviter: User | null): PendingInviteRow {
  return {
    inviteId: invite._id,
    email: invite.email,
    role: invite.role,
    invitedByName: inviter?.name ?? null,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function listAgencyMemberships(ctx: QueryCtx | MutationCtx, agencyId: AgencyId) {
  return ctx.db
    .query("memberships")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .take(MEMBER_LIST_LIMIT);
}

async function countOwners(ctx: QueryCtx | MutationCtx, agencyId: AgencyId): Promise<number> {
  const memberships = await listAgencyMemberships(ctx, agencyId);
  return memberships.filter((m) => m.role === MEMBER_ROLE.OWNER).length;
}

async function appendMemberAudit(
  ctx: MutationCtx,
  {
    userId,
    action,
    resourceType,
    resourceId,
    payload,
  }: {
    userId: UserId;
    action: AuditActionKey;
    resourceType: (typeof AUDIT_RESOURCE)[keyof typeof AUDIT_RESOURCE];
    resourceId: string;
    payload: Record<string, unknown>;
  },
) {
  await appendAuditEntry(ctx, {
    actor: { kind: "user", userId },
    action,
    resourceType,
    resourceId,
    payload,
  });
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Every member of the agency, enriched with the user's name and email. Any member may read. */
export const listMembers = queryWithAgencyScope({
  args: {},
  handler: async (ctx): Promise<MemberRow[]> => {
    const memberships = await listAgencyMemberships(ctx, ctx.agencyId);
    const rows = await Promise.all(
      memberships.map(async (membership): Promise<MemberRow | null> => {
        const user = await ctx.db.get(membership.userId);
        if (!user) return null;
        return {
          membershipId: membership._id,
          userId: user._id,
          name: user.name,
          email: user.email,
          role: membership.role,
          joinedAt: membership.joinedAt,
          isSelf: user._id === ctx.user._id,
        };
      }),
    );
    return rows.filter((row): row is MemberRow => row !== null);
  },
});

/** Open invites for the agency. Owners and admins only — invitee addresses are not shown to members. */
export const listPendingInvites = queryWithAgencyRole({ minRole: MEMBER_ROLE.ADMIN })({
  args: {},
  handler: async (ctx): Promise<PendingInviteRow[]> => {
    const now = new Date().toISOString();
    const invites = await ctx.db
      .query("agencyInvites")
      .withIndex("by_agency_status", (q) =>
        q.eq("agencyId", ctx.agencyId).eq("status", INVITE_STATUS.PENDING),
      )
      .take(INVITE_LIST_LIMIT);
    const open = invites.filter((invite) => isInviteOpen(invite, now));
    return Promise.all(
      open.map(async (invite) => shapePendingInvite(invite, await ctx.db.get(invite.invitedBy))),
    );
  },
});

/**
 * Open invites addressed to the signed-in user's email, across agencies.
 * Identity-only: drives the onboarding welcome screen, where the user has no
 * agency yet. Empty for an unverified email — the address is not yet proven.
 */
export const listMyPendingInvites = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<MyPendingInviteRow[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.emailVerified !== true) return [];
    const now = new Date().toISOString();
    const invites = await ctx.db
      .query("agencyInvites")
      .withIndex("by_email_status", (q) =>
        q.eq("email", normalizeEmail(ctx.user.email)).eq("status", INVITE_STATUS.PENDING),
      )
      .take(INVITE_LIST_LIMIT);
    const rows = await Promise.all(
      invites
        .filter((invite) => isInviteOpen(invite, now))
        .map(async (invite): Promise<MyPendingInviteRow | null> => {
          const agency = await ctx.db.get(invite.agencyId);
          if (!agency) return null;
          const inviter = await ctx.db.get(invite.invitedBy);
          return {
            inviteId: invite._id,
            agencyName: agency.name ?? "",
            role: invite.role,
            invitedByName: inviter?.name ?? null,
            expiresAt: invite.expiresAt,
          };
        }),
    );
    return rows.filter((row): row is MyPendingInviteRow => row !== null);
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Invite an email address as admin or member. Owners and admins only. */
export const inviteMember = mutationWithActiveAgencyRole({ minRole: MEMBER_ROLE.ADMIN })({
  args: { email: v.string(), role: invitableRoleValidator },
  handler: async (
    ctx,
    args,
  ): Promise<Result<InviteMemberSuccessResult, InviteMemberErrorResult>> => {
    if (!isValidEmail(args.email)) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.INVALID_EMAIL },
        message: "Email address is malformed",
      };
    }
    const email = normalizeEmail(args.email);

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existingUser) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user_agency", (q) =>
          q.eq("userId", existingUser._id).eq("agencyId", ctx.agencyId),
        )
        .unique();
      if (membership) {
        return {
          success: false,
          error: { code: MEMBERSHIP_ERROR_CODE.ALREADY_MEMBER },
          message: "That email already belongs to a member of this agency",
        };
      }
    }

    const now = new Date().toISOString();
    const pendingForEmail = await ctx.db
      .query("agencyInvites")
      .withIndex("by_email_status", (q) => q.eq("email", email).eq("status", INVITE_STATUS.PENDING))
      .take(INVITE_LIST_LIMIT);
    for (const invite of pendingForEmail) {
      if (invite.agencyId !== ctx.agencyId) continue;
      if (isInviteOpen(invite, now)) {
        return {
          success: false,
          error: { code: MEMBERSHIP_ERROR_CODE.INVITE_ALREADY_PENDING },
          message: "An open invite for that email already exists",
        };
      }
      await ctx.db.patch(invite._id, { status: INVITE_STATUS.EXPIRED });
    }

    const expiresAt = computeInviteExpiry(now);
    const inviteId = await ctx.db.insert("agencyInvites", {
      agencyId: ctx.agencyId,
      email,
      role: args.role,
      status: INVITE_STATUS.PENDING,
      invitedBy: ctx.user._id,
      createdAt: now,
      expiresAt,
    });

    await appendMemberAudit(ctx, {
      userId: ctx.user._id,
      action: AUDIT_ACTION.MEMBERSHIP_INVITED,
      resourceType: AUDIT_RESOURCE.INVITE,
      resourceId: inviteId,
      payload: { agencyId: ctx.agencyId, email, role: args.role, expiresAt },
    });

    const agency = await ctx.db.get(ctx.agencyId);
    await ctx.scheduler.runAfter(0, internal.agencies.actions.sendInviteEmail, {
      email,
      agencyName: agency?.name ?? "",
      inviterName: ctx.user.name,
      role: args.role,
      expiresAt,
    });

    return { success: true, data: { inviteId, expiresAt }, message: "Invite sent" };
  },
});

/** Withdraw an open invite. Owners and admins only. */
export const revokeInvite = mutationWithActiveAgencyRole({ minRole: MEMBER_ROLE.ADMIN })({
  args: { inviteId: v.id("agencyInvites") },
  handler: async (
    ctx,
    { inviteId },
  ): Promise<Result<RevokeInviteSuccessResult, RevokeInviteErrorResult>> => {
    const invite = await ctx.db.get(inviteId);
    if (!invite || invite.agencyId !== ctx.agencyId) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.INVITE_NOT_FOUND },
        message: "Invite not found",
      };
    }
    if (invite.status !== INVITE_STATUS.PENDING) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.INVITE_NOT_PENDING },
        message: "Invite is no longer pending",
      };
    }

    await ctx.db.patch(inviteId, { status: INVITE_STATUS.REVOKED });
    await appendMemberAudit(ctx, {
      userId: ctx.user._id,
      action: AUDIT_ACTION.MEMBERSHIP_INVITE_REVOKED,
      resourceType: AUDIT_RESOURCE.INVITE,
      resourceId: inviteId,
      payload: { agencyId: ctx.agencyId, email: invite.email },
    });

    return { success: true, data: { inviteId }, message: "Invite revoked" };
  },
});

/** Move a member to another role. Owners and admins only; see `decideRoleChange`. */
export const changeMemberRole = mutationWithActiveAgencyRole({ minRole: MEMBER_ROLE.ADMIN })({
  args: { membershipId: v.id("memberships"), role: memberRoleValidator },
  handler: async (
    ctx,
    { membershipId, role },
  ): Promise<Result<ChangeMemberRoleSuccessResult, ChangeMemberRoleErrorResult>> => {
    const target = await ctx.db.get(membershipId);
    if (!target || target.agencyId !== ctx.agencyId) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.MEMBERSHIP_NOT_FOUND },
        message: "Member not found",
      };
    }

    const decision = decideRoleChange({
      actor: ctx.membership,
      target,
      nextRole: role,
      ownerCount: await countOwners(ctx, ctx.agencyId),
    });
    if (!decision.allowed) {
      return { success: false, error: { code: decision.code }, message: "Role change refused" };
    }
    if (target.role === role) {
      return { success: true, data: { membershipId, role }, message: "Role unchanged" };
    }

    await ctx.db.patch(membershipId, { role });
    await appendMemberAudit(ctx, {
      userId: ctx.user._id,
      action: AUDIT_ACTION.MEMBERSHIP_ROLE_CHANGED,
      resourceType: AUDIT_RESOURCE.MEMBERSHIP,
      resourceId: membershipId,
      payload: {
        agencyId: ctx.agencyId,
        userId: target.userId,
        fromRole: target.role,
        toRole: role,
      },
    });

    return { success: true, data: { membershipId, role }, message: "Role changed" };
  },
});

/** Take a member out of the agency. Owners and admins only; see `decideRemoval`. */
export const removeMember = mutationWithActiveAgencyRole({ minRole: MEMBER_ROLE.ADMIN })({
  args: { membershipId: v.id("memberships") },
  handler: async (
    ctx,
    { membershipId },
  ): Promise<Result<RemoveMemberSuccessResult, RemoveMemberErrorResult>> => {
    const target = await ctx.db.get(membershipId);
    if (!target || target.agencyId !== ctx.agencyId) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.MEMBERSHIP_NOT_FOUND },
        message: "Member not found",
      };
    }

    const decision = decideRemoval({
      actor: ctx.membership,
      target,
      ownerCount: await countOwners(ctx, ctx.agencyId),
    });
    if (!decision.allowed) {
      return { success: false, error: { code: decision.code }, message: "Removal refused" };
    }

    await ctx.db.delete(membershipId);
    await appendMemberAudit(ctx, {
      userId: ctx.user._id,
      action: AUDIT_ACTION.MEMBERSHIP_REMOVED,
      resourceType: AUDIT_RESOURCE.MEMBERSHIP,
      resourceId: membershipId,
      payload: { agencyId: ctx.agencyId, userId: target.userId, role: target.role },
    });

    return { success: true, data: { membershipId }, message: "Member removed" };
  },
});

/**
 * Join an agency through an invite addressed to the caller's verified email.
 * Identity-only: the caller has no membership in the agency yet.
 */
export const acceptInvite = mutationWithAuth({
  args: { inviteId: v.id("agencyInvites") },
  handler: async (
    ctx,
    { inviteId },
  ): Promise<Result<AcceptInviteSuccessResult, AcceptInviteErrorResult>> => {
    const invite = await ctx.db.get(inviteId);
    if (!invite) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.INVITE_NOT_FOUND },
        message: "Invite not found",
      };
    }
    if (invite.email !== normalizeEmail(ctx.user.email)) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.INVITE_EMAIL_MISMATCH },
        message: "Invite is addressed to a different email",
      };
    }
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.emailVerified !== true) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.EMAIL_NOT_VERIFIED },
        message: "Verify your email address before accepting an invite",
      };
    }
    if (invite.status !== INVITE_STATUS.PENDING) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.INVITE_NOT_PENDING },
        message: "Invite is no longer pending",
      };
    }
    const now = new Date().toISOString();
    if (!isInviteOpen(invite, now)) {
      await ctx.db.patch(inviteId, { status: INVITE_STATUS.EXPIRED });
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.INVITE_EXPIRED },
        message: "Invite has expired",
      };
    }

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_agency", (q) =>
        q.eq("userId", ctx.user._id).eq("agencyId", invite.agencyId),
      )
      .unique();
    if (existing) {
      return {
        success: false,
        error: { code: MEMBERSHIP_ERROR_CODE.ALREADY_MEMBER },
        message: "Already a member of this agency",
      };
    }

    const membershipId = await ctx.db.insert("memberships", {
      userId: ctx.user._id,
      agencyId: invite.agencyId,
      role: invite.role,
      joinedAt: now,
    });
    await ctx.db.patch(inviteId, {
      status: INVITE_STATUS.ACCEPTED,
      acceptedBy: ctx.user._id,
      acceptedAt: now,
    });
    await appendMemberAudit(ctx, {
      userId: ctx.user._id,
      action: AUDIT_ACTION.MEMBERSHIP_INVITE_ACCEPTED,
      resourceType: AUDIT_RESOURCE.INVITE,
      resourceId: inviteId,
      payload: { agencyId: invite.agencyId, membershipId, role: invite.role },
    });

    return {
      success: true,
      data: { agencyId: invite.agencyId, membershipId },
      message: "Invite accepted",
    };
  },
});
