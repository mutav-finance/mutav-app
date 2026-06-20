// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import type { MutavStaffRole } from "./domain";

// The admin app's audience. The aud-bind asserts the presenting token carries
// THIS as its `aud`. A token from any other app (e.g. the agency SPA) must not
// reach staff capabilities even with a valid staff subject.
const ADMIN_AUD = "admin-client-id";
const AGENCY_AUD = "agency-client-id";

beforeEach(() => {
  vi.stubEnv("AUTH0_ADMIN_CLIENT_ID", ADMIN_AUD);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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

describe("aud-bind (load-bearing)", () => {
  test("an agency-aud token with a valid staff subject is REJECTED", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|staff", ["admin"]);
    const agencyId = await seedSubmittedAgency(t);

    // Same human, same staff row — but the token came from the agency app.
    const asAgencyToken = t.withIdentity({ subject: "auth0|staff", aud: AGENCY_AUD });
    await expect(
      asAgencyToken.mutation(api.mutavStaff.useCases.reviewOnboarding, {
        agencyId,
        decision: "approved",
      }),
    ).rejects.toThrow();

    // And the read surface is equally closed.
    await expect(
      asAgencyToken.query(api.mutavStaff.useCases.listPendingReviews, {}),
    ).rejects.toThrow();
  });

  test("an admin-aud token with a staff row is ALLOWED", async () => {
    const t = convexTest(schema);
    await seedStaff(t, "auth0|staff", ["admin"]);
    const agencyId = await seedSubmittedAgency(t);

    const asAdmin = t.withIdentity({ subject: "auth0|staff", aud: ADMIN_AUD });
    const result = await asAdmin.mutation(api.mutavStaff.useCases.reviewOnboarding, {
      agencyId,
      decision: "approved",
    });
    expect(result.success).toBe(true);

    const agency = await t.run((ctx) => ctx.db.get(agencyId));
    expect(agency?.onboardingState).toBe("active");
  });

  test("the admin aud is fail-closed when AUTH0_ADMIN_CLIENT_ID is the placeholder", async () => {
    vi.stubEnv("AUTH0_ADMIN_CLIENT_ID", "__SET_BEFORE_LAUNCH__:dev");
    const t = convexTest(schema);
    await seedStaff(t, "auth0|staff", ["admin"]);

    // No real admin aud configured ⇒ no token can satisfy the bind.
    const asAdmin = t.withIdentity({ subject: "auth0|staff", aud: "__SET_BEFORE_LAUNCH__:dev" });
    await expect(asAdmin.query(api.mutavStaff.useCases.listPendingReviews, {})).rejects.toThrow();
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
