// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { MutavStaffRole } from "./domain";

// Opaque identity values for withIdentity. The aud-bind was removed (Convex
// doesn't surface `aud` at runtime); the staff gate is the mutavStaff row
// (Tier-1 panel access). The wrappers ignore `aud` — these are just labels.
const ADMIN_AUD = "admin-client-id";
const AGENCY_AUD = "agency-client-id";

type T = ReturnType<typeof convexTest>;

async function seedStaff(t: T, subject: string, roles: MutavStaffRole[]) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `pub-${subject}`,
      subject,
      name: "Staff",
      email: `${subject}@test.br`,
      createdAt: new Date().toISOString(),
    });
    for (const role of roles) {
      await ctx.db.insert("mutavStaff", { userId, role, createdAt: new Date().toISOString() });
    }
    return userId;
  });
}

async function seedSubmittedAgency(t: T, cnpj = "00000000000123") {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name: "Imobiliária X",
      cnpj,
      agencyType: "empresa",
      onboardingState: "submitted",
      onboardingSubmittedAt: new Date().toISOString(),
      email: "x@test.br",
      phone: "11999999999",
      creci: "CRECI-J 99999",
      createdAt: new Date().toISOString(),
    }),
  );
}

describe("staff gate (Tier-1 panel access)", () => {
  test("a staff member with a mutavStaff row is allowed", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|staff", ["admin"]);
    const agencyId = await seedSubmittedAgency(t);

    const asStaff = t.withIdentity({ subject: "auth0|staff" });
    const result = await asStaff.mutation(api.mutavStaff.useCases.reviewOnboarding, {
      agencyId,
      decision: "approved",
    });
    expect(result.success).toBe(true);

    const agency = await t.run((ctx) => ctx.db.get(agencyId));
    expect(agency?.onboardingState).toBe("active");
  });

  test("token audience is not part of the gate (Convex doesn't surface aud)", async () => {
    // Two-tier model: panel access = the mutavStaff row, not the token's app of
    // origin. A both-role staff member is authorized for the panel regardless
    // of which app minted the token. Money moves (cover_default) are gated by
    // the on-chain wallet signature, not here.
    const t = convexTest(schema);
    await seedStaff(t, "auth0|staff", ["compliance"]);
    const asAnyApp = t.withIdentity({ subject: "auth0|staff", aud: AGENCY_AUD });
    const queue = await asAnyApp.query(api.mutavStaff.useCases.listPendingReviews, {});
    expect(Array.isArray(queue)).toBe(true);
  });
});

describe("staff membership gate", () => {
  test("an admin-aud token without a mutavStaff row is rejected", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "pub-plain",
        subject: "auth0|plain",
        name: "Plain",
        email: "plain@test.br",
        createdAt: new Date().toISOString(),
      }),
    );
    const asPlain = t.withIdentity({ subject: "auth0|plain", aud: ADMIN_AUD });
    await expect(asPlain.query(api.mutavStaff.useCases.listPendingReviews, {})).rejects.toThrow();
  });
});

describe("role hierarchy", () => {
  test("support cannot list the review queue (needs compliance)", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|support", ["support"]);
    const asSupport = t.withIdentity({ subject: "auth0|support", aud: ADMIN_AUD });
    await expect(asSupport.query(api.mutavStaff.useCases.listPendingReviews, {})).rejects.toThrow();
  });

  test("compliance can list but cannot approve (approve needs admin)", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|compliance", ["compliance"]);
    const agencyId = await seedSubmittedAgency(t);
    const asCompliance = t.withIdentity({ subject: "auth0|compliance", aud: ADMIN_AUD });

    const queue = await asCompliance.query(api.mutavStaff.useCases.listPendingReviews, {});
    expect(queue.length).toBe(1);

    await expect(
      asCompliance.mutation(api.mutavStaff.useCases.reviewOnboarding, {
        agencyId,
        decision: "approved",
      }),
    ).rejects.toThrow();
  });

  test("treasury (off-ladder) never satisfies an operational gate", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|treasury", ["treasury"]);
    const asTreasury = t.withIdentity({ subject: "auth0|treasury", aud: ADMIN_AUD });
    await expect(
      asTreasury.query(api.mutavStaff.useCases.listPendingReviews, {}),
    ).rejects.toThrow();
  });
});

describe("resource-aware document scoping", () => {
  test("cannot reach another agency's document by passing its agencyId", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|compliance", ["compliance"]);
    const agencyA = await seedSubmittedAgency(t, "00000000000111");
    const agencyB = await seedSubmittedAgency(t, "00000000000222");

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["kyc-doc"])));
    await t.run((ctx) =>
      ctx.db.insert("agencyDocuments", {
        agencyId: agencyA,
        kind: "responsavel_id",
        storageId,
        fileName: "rg.pdf",
        uploadedAt: new Date().toISOString(),
      }),
    );

    const asCompliance = t.withIdentity({ subject: "auth0|compliance", aud: ADMIN_AUD });

    // Agency A owns the doc → resolvable.
    const urlA = await asCompliance.query(api.mutavStaff.useCases.getDocumentDownloadUrl, {
      agencyId: agencyA,
      kind: "responsavel_id",
    });
    expect(urlA).not.toBeNull();

    // Agency B has no such doc → null, even though the doc exists in the system.
    const urlB = await asCompliance.query(api.mutavStaff.useCases.getDocumentDownloadUrl, {
      agencyId: agencyB,
      kind: "responsavel_id",
    });
    expect(urlB).toBeNull();
  });
});

describe("audit trail", () => {
  test("an admin review writes one onboarding.reviewed entry attributed to the staff user", async () => {
    const t = convexTest(schema);
    const staffUserId = await seedStaff(t, "auth0|admin", ["admin"]);
    const agencyId = await seedSubmittedAgency(t);

    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });
    await asAdmin.mutation(api.mutavStaff.useCases.reviewOnboarding, {
      agencyId,
      decision: "approved",
    });

    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) => q.eq("resourceType", "agency").eq("resourceId", agencyId))
        .collect(),
    );
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("onboarding.reviewed");
    expect(entries[0].actor).toEqual({ kind: "user", userId: staffUserId });
  });
});

async function seedPlainUser(t: T, subject: string) {
  return t.run(async (ctx) =>
    ctx.db.insert("users", {
      publicId: `pub-${subject}`,
      subject,
      name: `User ${subject}`,
      email: `${subject}@test.br`,
      createdAt: new Date().toISOString(),
    }),
  );
}

describe("listAllStaff", () => {
  test("admin sees every mutavStaff row enriched with auth0Sub + addedBy name", async () => {
    const t = convexTest(schema);
    const adminUserId = await seedStaff(t, "auth0|admin", ["admin"]);
    await seedStaff(t, "auth0|comp", ["compliance"]);

    // Grant one row via the admin panel so addedBy is populated.
    await seedPlainUser(t, "auth0|newbie");
    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });
    await asAdmin.mutation(api.mutavStaff.useCases.createStaffRole, {
      auth0Sub: "auth0|newbie",
      role: "support",
    });

    const rows = await asAdmin.query(api.mutavStaff.useCases.listAllStaff, {});
    expect(rows.length).toBe(3);

    const bySub = new Map(rows.map((row) => [`${row.auth0Sub}:${row.role}`, row]));
    const seeded = bySub.get("auth0|comp:compliance");
    expect(seeded?.addedBy).toBeNull();
    expect(seeded?.addedByName).toBeNull();

    const granted = bySub.get("auth0|newbie:support");
    expect(granted?.addedBy).toBe(adminUserId);
    expect(granted?.addedByName).toBe("Staff");
  });

  test("compliance caller is rejected (admin-only)", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|comp", ["compliance"]);
    const asCompliance = t.withIdentity({ subject: "auth0|comp", aud: ADMIN_AUD });
    await expect(asCompliance.query(api.mutavStaff.useCases.listAllStaff, {})).rejects.toThrow();
  });
});

describe("createStaffRole", () => {
  test("happy path — grants row, sets addedBy, writes audit entry", async () => {
    const t = convexTest(schema);
    const adminUserId = await seedStaff(t, "auth0|admin", ["admin"]);
    const targetUserId = await seedPlainUser(t, "auth0|newbie");
    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });

    const result = await asAdmin.mutation(api.mutavStaff.useCases.createStaffRole, {
      auth0Sub: "auth0|newbie",
      role: "compliance",
    });
    expect(result.success).toBe(true);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("mutavStaff")
        .withIndex("by_user", (q) => q.eq("userId", targetUserId))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe("compliance");
    expect(rows[0].addedBy).toBe(adminUserId);

    const audits = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "mutavStaff").eq("resourceId", rows[0]._id),
        )
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].action).toBe("staff.created");
    expect(audits[0].actor).toEqual({ kind: "user", userId: adminUserId });
  });

  test("ROLE_ALREADY_EXISTS when the same (sub, role) is granted twice", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|admin", ["admin"]);
    await seedPlainUser(t, "auth0|newbie");
    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });

    await asAdmin.mutation(api.mutavStaff.useCases.createStaffRole, {
      auth0Sub: "auth0|newbie",
      role: "support",
    });
    const second = await asAdmin.mutation(api.mutavStaff.useCases.createStaffRole, {
      auth0Sub: "auth0|newbie",
      role: "support",
    });
    expect(second.success).toBe(false);
    if (!second.success) expect(second.error.code).toBe("ROLE_ALREADY_EXISTS");
  });

  test("USER_NOT_FOUND when the target auth0Sub has no users row yet", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|admin", ["admin"]);
    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });

    const result = await asAdmin.mutation(api.mutavStaff.useCases.createStaffRole, {
      auth0Sub: "auth0|nobody-here",
      role: "support",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("USER_NOT_FOUND");
  });

  test("compliance caller is rejected (admin-only)", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|comp", ["compliance"]);
    await seedPlainUser(t, "auth0|newbie");
    const asCompliance = t.withIdentity({ subject: "auth0|comp", aud: ADMIN_AUD });
    await expect(
      asCompliance.mutation(api.mutavStaff.useCases.createStaffRole, {
        auth0Sub: "auth0|newbie",
        role: "support",
      }),
    ).rejects.toThrow();
  });
});

describe("deleteStaffRole", () => {
  test("happy path — removes row and writes staff.deleted audit entry", async () => {
    const t = convexTest(schema);
    const adminUserId = await seedStaff(t, "auth0|admin", ["admin"]);
    const targetUserId = await seedStaff(t, "auth0|comp", ["compliance"]);
    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });

    const result = await asAdmin.mutation(api.mutavStaff.useCases.deleteStaffRole, {
      auth0Sub: "auth0|comp",
      role: "compliance",
    });
    expect(result.success).toBe(true);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("mutavStaff")
        .withIndex("by_user", (q) => q.eq("userId", targetUserId))
        .collect(),
    );
    expect(rows.length).toBe(0);

    const audits = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .filter((q) => q.eq(q.field("action"), "staff.deleted"))
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].actor).toEqual({ kind: "user", userId: adminUserId });
  });

  test("ROLE_NOT_FOUND when the (sub, role) pair doesn't exist", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|admin", ["admin"]);
    await seedPlainUser(t, "auth0|ghost");
    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });

    const result = await asAdmin.mutation(api.mutavStaff.useCases.deleteStaffRole, {
      auth0Sub: "auth0|ghost",
      role: "support",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ROLE_NOT_FOUND");
  });

  test("LAST_ADMIN_LOCKOUT when the caller removes their own last admin row", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|admin", ["admin"]);
    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });

    const result = await asAdmin.mutation(api.mutavStaff.useCases.deleteStaffRole, {
      auth0Sub: "auth0|admin",
      role: "admin",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("LAST_ADMIN_LOCKOUT");
  });

  test("self-revoke succeeds when another admin remains", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|admin", ["admin"]);
    await seedStaff(t, "auth0|admin2", ["admin"]);
    const asAdmin = t.withIdentity({ subject: "auth0|admin", aud: ADMIN_AUD });

    const result = await asAdmin.mutation(api.mutavStaff.useCases.deleteStaffRole, {
      auth0Sub: "auth0|admin",
      role: "admin",
    });
    expect(result.success).toBe(true);
  });

  test("LAST_ADMIN_LOCKOUT on mutual revoke — admin-A removes admin-B (B is the only other admin)", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|adminA", ["admin"]);
    await seedStaff(t, "auth0|adminB", ["admin"]);
    const asAdminA = t.withIdentity({ subject: "auth0|adminA", aud: ADMIN_AUD });

    const first = await asAdminA.mutation(api.mutavStaff.useCases.deleteStaffRole, {
      auth0Sub: "auth0|adminB",
      role: "admin",
    });
    expect(first.success).toBe(true);

    const second = await asAdminA.mutation(api.mutavStaff.useCases.deleteStaffRole, {
      auth0Sub: "auth0|adminA",
      role: "admin",
    });
    expect(second.success).toBe(false);
    if (!second.success) expect(second.error.code).toBe("LAST_ADMIN_LOCKOUT");
  });

  test("admin-A can revoke admin-B when 3+ admins remain", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|adminA", ["admin"]);
    await seedStaff(t, "auth0|adminB", ["admin"]);
    await seedStaff(t, "auth0|adminC", ["admin"]);
    const asAdminA = t.withIdentity({ subject: "auth0|adminA", aud: ADMIN_AUD });

    const result = await asAdminA.mutation(api.mutavStaff.useCases.deleteStaffRole, {
      auth0Sub: "auth0|adminB",
      role: "admin",
    });
    expect(result.success).toBe(true);
  });

  test("admin-A can revoke admin-B's non-admin role even when only 2 admins remain", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|adminA", ["admin"]);
    await seedStaff(t, "auth0|adminB", ["admin", "compliance"]);
    const asAdminA = t.withIdentity({ subject: "auth0|adminA", aud: ADMIN_AUD });

    const result = await asAdminA.mutation(api.mutavStaff.useCases.deleteStaffRole, {
      auth0Sub: "auth0|adminB",
      role: "compliance",
    });
    expect(result.success).toBe(true);
  });

  test("compliance caller is rejected (admin-only)", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|comp", ["compliance"]);
    await seedStaff(t, "auth0|other", ["support"]);
    const asCompliance = t.withIdentity({ subject: "auth0|comp", aud: ADMIN_AUD });
    await expect(
      asCompliance.mutation(api.mutavStaff.useCases.deleteStaffRole, {
        auth0Sub: "auth0|other",
        role: "support",
      }),
    ).rejects.toThrow();
  });
});

describe("bootstrapFirstAdmin", () => {
  test("happy path — grants first admin row and writes staff.bootstrap audit entry", async () => {
    const t = convexTest(schema);
    const targetUserId = await seedPlainUser(t, "auth0|genesis");

    const result = await t.mutation(internal.mutavStaff.useCases.bootstrapFirstAdmin, {
      auth0Sub: "auth0|genesis",
      email: "genesis@test.br",
    });
    expect(result.success).toBe(true);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("mutavStaff")
        .withIndex("by_user", (q) => q.eq("userId", targetUserId))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe("admin");
    expect(rows[0].addedBy).toBeUndefined();

    const audits = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .filter((q) => q.eq(q.field("action"), "staff.bootstrap"))
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].actor).toEqual({ kind: "system", source: "bootstrap" });
  });

  test("ADMIN_ALREADY_EXISTS when an admin row is already present", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|existing", ["admin"]);
    await seedPlainUser(t, "auth0|genesis");

    const result = await t.mutation(internal.mutavStaff.useCases.bootstrapFirstAdmin, {
      auth0Sub: "auth0|genesis",
      email: "genesis@test.br",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ADMIN_ALREADY_EXISTS");
  });

  test("USER_NOT_FOUND when the target auth0Sub has no users row yet", async () => {
    const t = convexTest(schema);
    const result = await t.mutation(internal.mutavStaff.useCases.bootstrapFirstAdmin, {
      auth0Sub: "auth0|nobody",
      email: "nobody@test.br",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("USER_NOT_FOUND");
  });
});

describe("grantStaffRole", () => {
  test("grants a second admin — the case bootstrapFirstAdmin refuses", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|incumbent", ["admin"]);
    const targetUserId = await seedPlainUser(t, "auth0|second");

    const blocked = await t.mutation(internal.mutavStaff.useCases.bootstrapFirstAdmin, {
      auth0Sub: "auth0|second",
      email: "second@test.br",
    });
    expect(blocked.success).toBe(false);
    if (!blocked.success) expect(blocked.error.code).toBe("ADMIN_ALREADY_EXISTS");

    const result = await t.mutation(internal.mutavStaff.useCases.grantStaffRole, {
      auth0Sub: "auth0|second",
      role: "admin",
    });
    expect(result.success).toBe(true);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("mutavStaff")
        .withIndex("by_user", (q) => q.eq("userId", targetUserId))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe("admin");
    expect(rows[0].addedBy).toBeUndefined();
  });

  test("writes a staff.created audit entry attributed to the operator CLI", async () => {
    const t = convexTest(schema);
    await seedPlainUser(t, "auth0|target");

    await t.mutation(internal.mutavStaff.useCases.grantStaffRole, {
      auth0Sub: "auth0|target",
      role: "treasury",
    });

    const audits = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .filter((q) => q.eq(q.field("action"), "staff.created"))
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].actor).toEqual({ kind: "system", source: "operator-cli" });
  });

  test("grants a non-admin role", async () => {
    const t = convexTest(schema);
    await seedPlainUser(t, "auth0|compliance-hire");

    const result = await t.mutation(internal.mutavStaff.useCases.grantStaffRole, {
      auth0Sub: "auth0|compliance-hire",
      role: "compliance",
    });
    expect(result.success).toBe(true);
  });

  test("ROLE_ALREADY_EXISTS is idempotent — no duplicate row", async () => {
    const t = convexTest(schema);
    const targetUserId = await seedStaff(t, "auth0|dupe", ["admin"]);

    const result = await t.mutation(internal.mutavStaff.useCases.grantStaffRole, {
      auth0Sub: "auth0|dupe",
      role: "admin",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ROLE_ALREADY_EXISTS");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("mutavStaff")
        .withIndex("by_user", (q) => q.eq("userId", targetUserId))
        .collect(),
    );
    expect(rows.length).toBe(1);
  });

  test("USER_NOT_FOUND — never invents a users row for an unseen subject", async () => {
    const t = convexTest(schema);
    const result = await t.mutation(internal.mutavStaff.useCases.grantStaffRole, {
      auth0Sub: "auth0|never-signed-in",
      role: "admin",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("USER_NOT_FOUND");

    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.length).toBe(0);
  });
});
