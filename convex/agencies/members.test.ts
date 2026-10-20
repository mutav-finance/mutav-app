// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import type { UserId } from "../users/domain";
import type { AgencyId, AgencyInviteId, MemberRole, OnboardingState } from "./domain";

type T = ReturnType<typeof convexTest>;

async function seedUser(t: T, key: string, email = `${key}@agency.test`): Promise<UserId> {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: `user-${key}`,
      subject: `auth0|${key}`,
      name: `User ${key}`,
      email,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

function as(t: T, key: string, { emailVerified = true }: { emailVerified?: boolean } = {}) {
  return t.withIdentity({ subject: `auth0|${key}`, emailVerified });
}

async function seedAgency(t: T, state: OnboardingState = "active"): Promise<AgencyId> {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name: `Agency ${state}`,
      agencyType: "empresa",
      onboardingState: state,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

async function addMember(t: T, userId: UserId, agencyId: AgencyId, role: MemberRole) {
  return t.run((ctx) =>
    ctx.db.insert("memberships", { userId, agencyId, role, joinedAt: "2026-01-02T00:00:00.000Z" }),
  );
}

async function seedInvite(
  t: T,
  {
    agencyId,
    email,
    invitedBy,
    status = "pending",
    expiresAt = "2999-01-01T00:00:00.000Z",
  }: {
    agencyId: AgencyId;
    email: string;
    invitedBy: UserId;
    status?: "pending" | "accepted" | "revoked" | "expired";
    expiresAt?: string;
  },
): Promise<AgencyInviteId> {
  return t.run((ctx) =>
    ctx.db.insert("agencyInvites", {
      agencyId,
      email,
      role: "member",
      status,
      invitedBy,
      createdAt: "2026-01-03T00:00:00.000Z",
      expiresAt,
    }),
  );
}

async function auditActions(t: T) {
  const rows = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
  return rows.map((row) => ({ action: row.action, resourceId: row.resourceId }));
}

/** Agency A with an owner, an admin and a member; agency B owned by a stranger. */
async function setupTeam() {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const foreignAgencyId = await seedAgency(t);
  const ownerId = await seedUser(t, "owner");
  const adminId = await seedUser(t, "admin");
  const memberId = await seedUser(t, "member");
  const strangerId = await seedUser(t, "stranger");
  const ownerMembershipId = await addMember(t, ownerId, agencyId, "owner");
  const adminMembershipId = await addMember(t, adminId, agencyId, "admin");
  const memberMembershipId = await addMember(t, memberId, agencyId, "member");
  const strangerMembershipId = await addMember(t, strangerId, foreignAgencyId, "owner");
  return {
    t,
    agencyId,
    foreignAgencyId,
    ownerId,
    adminId,
    memberId,
    strangerId,
    ownerMembershipId,
    adminMembershipId,
    memberMembershipId,
    strangerMembershipId,
  };
}

describe("listMembers", () => {
  test("returns every member enriched with name and email, flagging the caller", async () => {
    const { t, agencyId } = await setupTeam();
    const rows = await as(t, "member").query(api.agencies.members.listMembers, { agencyId });
    expect(rows).toHaveLength(3);
    const self = rows.find((row) => row.isSelf);
    expect(self).toMatchObject({
      name: "User member",
      email: "member@agency.test",
      role: "member",
    });
    expect(rows.map((row) => row.role).sort()).toEqual(["admin", "member", "owner"]);
  });

  test("rejects a caller from another agency", async () => {
    const { t, agencyId } = await setupTeam();
    await expect(
      as(t, "stranger").query(api.agencies.members.listMembers, { agencyId }),
    ).rejects.toThrow(/not a member/);
  });
});

describe("listPendingInvites", () => {
  test("lists open invites for an admin, hiding expired and closed ones", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedInvite(t, { agencyId, email: "open@x.test", invitedBy: ownerId });
    await seedInvite(t, {
      agencyId,
      email: "stale@x.test",
      invitedBy: ownerId,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    await seedInvite(t, { agencyId, email: "gone@x.test", invitedBy: ownerId, status: "revoked" });

    const rows = await as(t, "admin").query(api.agencies.members.listPendingInvites, { agencyId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "open@x.test", invitedByName: "User owner" });
  });

  test("is closed to plain members", async () => {
    const { t, agencyId } = await setupTeam();
    await expect(
      as(t, "member").query(api.agencies.members.listPendingInvites, { agencyId }),
    ).rejects.toThrow(/Requires agency 'admin'/);
  });
});

describe("inviteMember", () => {
  test("creates a normalized pending invite with a 7-day expiry and audits it", async () => {
    const { t, agencyId } = await setupTeam();
    const result = await as(t, "admin").mutation(api.agencies.members.inviteMember, {
      agencyId,
      email: "  New.Person@Example.com ",
      role: "admin",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const invite = await t.run((ctx) => ctx.db.get(result.data.inviteId));
    expect(invite).toMatchObject({
      email: "new.person@example.com",
      role: "admin",
      status: "pending",
    });
    if (!invite) return;
    const ttlMs = Date.parse(invite.expiresAt) - Date.parse(invite.createdAt);
    expect(ttlMs).toBe(7 * 24 * 60 * 60 * 1000);

    expect(await auditActions(t)).toEqual([
      { action: "membership.invited", resourceId: result.data.inviteId },
    ]);
  });

  test("rejects a malformed email", async () => {
    const { t, agencyId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.inviteMember, {
      agencyId,
      email: "not-an-email",
      role: "member",
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_EMAIL" } });
  });

  test("rejects an email that already belongs to a member", async () => {
    const { t, agencyId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.inviteMember, {
      agencyId,
      email: "MEMBER@agency.test",
      role: "member",
    });
    expect(result).toMatchObject({ success: false, error: { code: "ALREADY_MEMBER" } });
  });

  test("allows inviting someone who belongs only to another agency", async () => {
    const { t, agencyId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.inviteMember, {
      agencyId,
      email: "stranger@agency.test",
      role: "member",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a duplicate open invite for the same email", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedInvite(t, { agencyId, email: "dup@x.test", invitedBy: ownerId });
    const result = await as(t, "owner").mutation(api.agencies.members.inviteMember, {
      agencyId,
      email: "DUP@x.test",
      role: "member",
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVITE_ALREADY_PENDING" } });
  });

  test("replaces a lapsed invite, marking the old one expired", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    const staleId = await seedInvite(t, {
      agencyId,
      email: "again@x.test",
      invitedBy: ownerId,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const result = await as(t, "owner").mutation(api.agencies.members.inviteMember, {
      agencyId,
      email: "again@x.test",
      role: "member",
    });
    expect(result.success).toBe(true);
    const stale = await t.run((ctx) => ctx.db.get(staleId));
    expect(stale?.status).toBe("expired");
  });

  test("an open invite in another agency does not block this one", async () => {
    const { t, agencyId, foreignAgencyId, strangerId } = await setupTeam();
    await seedInvite(t, { agencyId: foreignAgencyId, email: "both@x.test", invitedBy: strangerId });
    const result = await as(t, "owner").mutation(api.agencies.members.inviteMember, {
      agencyId,
      email: "both@x.test",
      role: "member",
    });
    expect(result.success).toBe(true);
  });

  test("plain members cannot invite", async () => {
    const { t, agencyId } = await setupTeam();
    await expect(
      as(t, "member").mutation(api.agencies.members.inviteMember, {
        agencyId,
        email: "x@x.test",
        role: "member",
      }),
    ).rejects.toThrow(/Requires agency 'admin'/);
  });

  test("non-members cannot invite into another agency", async () => {
    const { t, agencyId } = await setupTeam();
    await expect(
      as(t, "stranger").mutation(api.agencies.members.inviteMember, {
        agencyId,
        email: "x@x.test",
        role: "member",
      }),
    ).rejects.toThrow(/not a member/);
  });

  test("an agency still under review cannot invite", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, "under_review");
    const ownerId = await seedUser(t, "owner");
    await addMember(t, ownerId, agencyId, "owner");
    await expect(
      as(t, "owner").mutation(api.agencies.members.inviteMember, {
        agencyId,
        email: "x@x.test",
        role: "member",
      }),
    ).rejects.toThrow(/not active/);
  });
});

describe("revokeInvite", () => {
  test("revokes an open invite and audits it", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    const inviteId = await seedInvite(t, { agencyId, email: "r@x.test", invitedBy: ownerId });
    const result = await as(t, "admin").mutation(api.agencies.members.revokeInvite, {
      agencyId,
      inviteId,
    });
    expect(result.success).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(inviteId)))?.status).toBe("revoked");
    expect(await auditActions(t)).toEqual([
      { action: "membership.invite_revoked", resourceId: inviteId },
    ]);
  });

  test("cannot reach another agency's invite", async () => {
    const { t, agencyId, foreignAgencyId, strangerId } = await setupTeam();
    const inviteId = await seedInvite(t, {
      agencyId: foreignAgencyId,
      email: "r@x.test",
      invitedBy: strangerId,
    });
    const result = await as(t, "owner").mutation(api.agencies.members.revokeInvite, {
      agencyId,
      inviteId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVITE_NOT_FOUND" } });
    expect((await t.run((ctx) => ctx.db.get(inviteId)))?.status).toBe("pending");
  });

  test("rejects an invite that is no longer pending", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    const inviteId = await seedInvite(t, {
      agencyId,
      email: "r@x.test",
      invitedBy: ownerId,
      status: "accepted",
    });
    const result = await as(t, "owner").mutation(api.agencies.members.revokeInvite, {
      agencyId,
      inviteId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVITE_NOT_PENDING" } });
  });

  test("plain members cannot revoke", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    const inviteId = await seedInvite(t, { agencyId, email: "r@x.test", invitedBy: ownerId });
    await expect(
      as(t, "member").mutation(api.agencies.members.revokeInvite, { agencyId, inviteId }),
    ).rejects.toThrow(/Requires agency 'admin'/);
  });
});

describe("changeMemberRole", () => {
  test("owner promotes a member to admin and the change is audited", async () => {
    const { t, agencyId, memberMembershipId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: memberMembershipId,
      role: "admin",
    });
    expect(result).toMatchObject({ success: true, data: { role: "admin" } });
    expect((await t.run((ctx) => ctx.db.get(memberMembershipId)))?.role).toBe("admin");
    expect(await auditActions(t)).toEqual([
      { action: "membership.role_changed", resourceId: memberMembershipId },
    ]);
  });

  test("owner can hand ownership to an admin", async () => {
    const { t, agencyId, adminMembershipId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: adminMembershipId,
      role: "owner",
    });
    expect(result.success).toBe(true);
  });

  test("setting the current role is a no-op without an audit entry", async () => {
    const { t, agencyId, memberMembershipId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: memberMembershipId,
      role: "member",
    });
    expect(result.success).toBe(true);
    expect(await auditActions(t)).toEqual([]);
  });

  test("nobody changes their own role", async () => {
    const { t, agencyId, ownerMembershipId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: ownerMembershipId,
      role: "member",
    });
    expect(result).toMatchObject({ success: false, error: { code: "CANNOT_CHANGE_OWN_ROLE" } });
  });

  test("admin cannot demote an owner", async () => {
    const { t, agencyId, ownerMembershipId } = await setupTeam();
    const result = await as(t, "admin").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: ownerMembershipId,
      role: "member",
    });
    expect(result).toMatchObject({ success: false, error: { code: "INSUFFICIENT_ROLE" } });
    expect((await t.run((ctx) => ctx.db.get(ownerMembershipId)))?.role).toBe("owner");
  });

  test("admin cannot grant owner", async () => {
    const { t, agencyId, memberMembershipId } = await setupTeam();
    const result = await as(t, "admin").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: memberMembershipId,
      role: "owner",
    });
    expect(result).toMatchObject({ success: false, error: { code: "INSUFFICIENT_ROLE" } });
  });

  test("a co-owner can demote the original owner, leaving exactly one owner", async () => {
    const { t, agencyId, adminMembershipId, ownerMembershipId } = await setupTeam();
    await as(t, "owner").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: adminMembershipId,
      role: "owner",
    });
    const demoteFirst = await as(t, "admin").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: ownerMembershipId,
      role: "member",
    });
    expect(demoteFirst.success).toBe(true);
    const owners = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("memberships")
          .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
          .collect()
      ).filter((m) => m.role === "owner"),
    );
    expect(owners).toHaveLength(1);
  });

  test("cannot reach another agency's membership", async () => {
    const { t, agencyId, strangerMembershipId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.changeMemberRole, {
      agencyId,
      membershipId: strangerMembershipId,
      role: "member",
    });
    expect(result).toMatchObject({ success: false, error: { code: "MEMBERSHIP_NOT_FOUND" } });
  });

  test("plain members cannot change roles", async () => {
    const { t, agencyId, adminMembershipId } = await setupTeam();
    await expect(
      as(t, "member").mutation(api.agencies.members.changeMemberRole, {
        agencyId,
        membershipId: adminMembershipId,
        role: "member",
      }),
    ).rejects.toThrow(/Requires agency 'admin'/);
  });
});

describe("removeMember", () => {
  test("admin removes a member and the removal is audited", async () => {
    const { t, agencyId, memberMembershipId } = await setupTeam();
    const result = await as(t, "admin").mutation(api.agencies.members.removeMember, {
      agencyId,
      membershipId: memberMembershipId,
    });
    expect(result.success).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(memberMembershipId))).toBeNull();
    expect(await auditActions(t)).toEqual([
      { action: "membership.removed", resourceId: memberMembershipId },
    ]);
  });

  test("nobody removes themselves", async () => {
    const { t, agencyId, adminMembershipId } = await setupTeam();
    const result = await as(t, "admin").mutation(api.agencies.members.removeMember, {
      agencyId,
      membershipId: adminMembershipId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "CANNOT_REMOVE_SELF" } });
  });

  test("admin cannot remove an owner", async () => {
    const { t, agencyId, ownerMembershipId } = await setupTeam();
    const result = await as(t, "admin").mutation(api.agencies.members.removeMember, {
      agencyId,
      membershipId: ownerMembershipId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "INSUFFICIENT_ROLE" } });
    expect(await t.run((ctx) => ctx.db.get(ownerMembershipId))).not.toBeNull();
  });

  test("cannot reach another agency's membership", async () => {
    const { t, agencyId, strangerMembershipId } = await setupTeam();
    const result = await as(t, "owner").mutation(api.agencies.members.removeMember, {
      agencyId,
      membershipId: strangerMembershipId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "MEMBERSHIP_NOT_FOUND" } });
    expect(await t.run((ctx) => ctx.db.get(strangerMembershipId))).not.toBeNull();
  });

  test("plain members cannot remove anyone", async () => {
    const { t, agencyId, adminMembershipId } = await setupTeam();
    await expect(
      as(t, "member").mutation(api.agencies.members.removeMember, {
        agencyId,
        membershipId: adminMembershipId,
      }),
    ).rejects.toThrow(/Requires agency 'admin'/);
  });
});

describe("listMyPendingInvites", () => {
  test("lists open invites addressed to the caller's email, case-insensitively", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedUser(t, "invitee", "Invitee@Example.com");
    await seedInvite(t, { agencyId, email: "invitee@example.com", invitedBy: ownerId });
    await seedInvite(t, {
      agencyId,
      email: "invitee@example.com",
      invitedBy: ownerId,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    await seedInvite(t, { agencyId, email: "someone.else@example.com", invitedBy: ownerId });

    const rows = await as(t, "invitee").query(api.agencies.members.listMyPendingInvites, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agencyName: "Agency active",
      role: "member",
      invitedByName: "User owner",
    });
  });

  test("is empty while the caller's email is unverified", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedUser(t, "invitee", "invitee@example.com");
    await seedInvite(t, { agencyId, email: "invitee@example.com", invitedBy: ownerId });
    const rows = await as(t, "invitee", { emailVerified: false }).query(
      api.agencies.members.listMyPendingInvites,
      {},
    );
    expect(rows).toEqual([]);
  });
});

describe("acceptInvite", () => {
  test("creates the membership, closes the invite and audits it", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    const inviteeId = await seedUser(t, "invitee", "invitee@example.com");
    const inviteId = await seedInvite(t, {
      agencyId,
      email: "invitee@example.com",
      invitedBy: ownerId,
    });

    const result = await as(t, "invitee").mutation(api.agencies.members.acceptInvite, {
      inviteId,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const membership = await t.run((ctx) => ctx.db.get(result.data.membershipId));
    expect(membership).toMatchObject({ userId: inviteeId, agencyId, role: "member" });
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite).toMatchObject({ status: "accepted", acceptedBy: inviteeId });
    expect(await auditActions(t)).toEqual([
      { action: "membership.invite_accepted", resourceId: inviteId },
    ]);
  });

  test("rejects an invite addressed to another email", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedUser(t, "invitee", "invitee@example.com");
    const inviteId = await seedInvite(t, {
      agencyId,
      email: "someone.else@example.com",
      invitedBy: ownerId,
    });
    const result = await as(t, "invitee").mutation(api.agencies.members.acceptInvite, {
      inviteId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVITE_EMAIL_MISMATCH" } });
    expect(await t.run((ctx) => ctx.db.query("memberships").collect())).toHaveLength(4);
  });

  test("rejects an unverified email", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedUser(t, "invitee", "invitee@example.com");
    const inviteId = await seedInvite(t, {
      agencyId,
      email: "invitee@example.com",
      invitedBy: ownerId,
    });
    const result = await as(t, "invitee", { emailVerified: false }).mutation(
      api.agencies.members.acceptInvite,
      { inviteId },
    );
    expect(result).toMatchObject({ success: false, error: { code: "EMAIL_NOT_VERIFIED" } });
  });

  test("rejects a revoked invite", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedUser(t, "invitee", "invitee@example.com");
    const inviteId = await seedInvite(t, {
      agencyId,
      email: "invitee@example.com",
      invitedBy: ownerId,
      status: "revoked",
    });
    const result = await as(t, "invitee").mutation(api.agencies.members.acceptInvite, {
      inviteId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVITE_NOT_PENDING" } });
  });

  test("rejects an expired invite and marks it expired", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedUser(t, "invitee", "invitee@example.com");
    const inviteId = await seedInvite(t, {
      agencyId,
      email: "invitee@example.com",
      invitedBy: ownerId,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const result = await as(t, "invitee").mutation(api.agencies.members.acceptInvite, {
      inviteId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVITE_EXPIRED" } });
    expect((await t.run((ctx) => ctx.db.get(inviteId)))?.status).toBe("expired");
  });

  test("rejects an invite into an agency the caller already belongs to", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    const inviteId = await seedInvite(t, {
      agencyId,
      email: "member@agency.test",
      invitedBy: ownerId,
    });
    const result = await as(t, "member").mutation(api.agencies.members.acceptInvite, {
      inviteId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ALREADY_MEMBER" } });
  });

  test("rejects an invite that no longer exists", async () => {
    const { t, agencyId, ownerId } = await setupTeam();
    await seedUser(t, "invitee", "invitee@example.com");
    const inviteId = await seedInvite(t, {
      agencyId,
      email: "invitee@example.com",
      invitedBy: ownerId,
    });
    await t.run((ctx) => ctx.db.delete(inviteId));
    const result = await as(t, "invitee").mutation(api.agencies.members.acceptInvite, {
      inviteId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVITE_NOT_FOUND" } });
  });
});
