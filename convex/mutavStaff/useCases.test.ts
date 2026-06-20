// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
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
