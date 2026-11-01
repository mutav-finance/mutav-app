// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { registerGuaranteeAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import type { AgencyId } from "../agencies/domain";
import type { GuaranteeId } from "../guarantees/domain";
import type { UserId } from "../users/domain";

function setup() {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

type T = ReturnType<typeof setup>;

const STAFF_SUBJECT = "auth0|expiry-compliance";

async function makeFixture(t: T) {
  const { userId, agencyId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: "expiry-user",
      subject: "auth0|expiry-user",
      name: "Agency User",
      email: "expiry@test.br",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: "Expiry Agency",
      cnpj: "00000000000001",
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: "owner",
      joinedAt: "2026-01-01T00:00:00.000Z",
    });
    const staffUserId = await ctx.db.insert("users", {
      publicId: "expiry-compliance",
      subject: STAFF_SUBJECT,
      name: "Compliance",
      email: "compliance@mutav.finance",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("mutavStaff", {
      userId: staffUserId,
      role: "compliance",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    return { userId, agencyId };
  });
  const { guaranteeId } = await seedGuaranteeWithLease(
    t,
    { agencyId, status: "in_arrears", activatedAt: "2024-06-01T00:00:00.000Z", rentCents: 300_000 },
    "CT-expiry",
  );
  return { userId, agencyId, guaranteeId };
}

async function insertOpenNotice(
  t: T,
  fx: { userId: UserId; agencyId: AgencyId; guaranteeId: GuaranteeId },
  { publicId, rentDueDate }: { publicId: string; rentDueDate: string },
) {
  return t.run((ctx) =>
    ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId,
      guaranteeId: fx.guaranteeId,
      agencyId: fx.agencyId,
      status: "open",
      rentDueDate,
      originalAmountCents: 300_000,
      updatedAmountCents: 300_000,
      evidenceSource: "agency_reported",
      openedAt: `${rentDueDate}T12:00:00.000Z`,
      openedByUserId: fx.userId,
    }),
  );
}

describe("expireLapsedClaims", () => {
  test("expires an unclaimed notice past the filing window and leaves the guarantee in arrears", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const lapsed = await insertOpenNotice(t, fx, {
      publicId: "DN-lapsed",
      rentDueDate: "2024-07-05",
    });
    const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const live = await insertOpenNotice(t, fx, { publicId: "DN-live", rentDueDate: today });

    const result = await t.mutation(internal.delinquencies.expiry.expireLapsedClaims, {});
    expect(result.expired).toBe(1);

    const [lapsedRow, liveRow, guarantee] = await t.run(async (ctx) => [
      await ctx.db.get(lapsed),
      await ctx.db.get(live),
      await ctx.db.get(fx.guaranteeId),
    ]);
    expect(lapsedRow?.status).toBe("resolved");
    expect(lapsedRow?.resolution?.kind).toBe("stale");
    expect(lapsedRow?.resolution?.resolvedByUserId).toBeUndefined();
    expect(liveRow?.status).toBe("open");
    expect(guarantee?.status).toBe("in_arrears");

    const audit = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-lapsed"),
        )
        .collect(),
    );
    expect(audit.map((row) => [row.action, row.actor])).toEqual([
      ["delinquency.expired", { kind: "system", source: "cron_claim_expiry" }],
    ]);
  });

  test("a second run changes nothing", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertOpenNotice(t, fx, { publicId: "DN-lapsed", rentDueDate: "2024-07-05" });
    await t.mutation(internal.delinquencies.expiry.expireLapsedClaims, {});
    const again = await t.mutation(internal.delinquencies.expiry.expireLapsedClaims, {});
    expect(again.expired).toBe(0);
  });
});

describe("arrears without a claim", () => {
  test("staff see the stranded guarantee and can return it to active", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertOpenNotice(t, fx, { publicId: "DN-lapsed", rentDueDate: "2024-07-05" });
    await t.mutation(internal.delinquencies.expiry.expireLapsedClaims, {});
    const staff = t.withIdentity({ subject: STAFF_SUBJECT });

    const rows = await staff.query(api.delinquencies.expiry.listArrearsWithoutClaim, {});
    expect(rows.map((row) => [row.guaranteePublicId, row.lastRentDueDate])).toEqual([
      ["CT-expiry", "2024-07-05"],
    ]);

    const cleared = await staff.mutation(api.delinquencies.expiry.staffReturnToActive, {
      guaranteeId: fx.guaranteeId,
      note: "Imobiliária confirmou acordo com o inquilino.",
    });
    expect(cleared.success).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(fx.guaranteeId)))?.status).toBe("active");
    expect(await staff.query(api.delinquencies.expiry.listArrearsWithoutClaim, {})).toEqual([]);
  });

  test("a guarantee with an open notice is not listed and cannot be cleared", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await insertOpenNotice(t, fx, { publicId: "DN-live", rentDueDate: today });
    const staff = t.withIdentity({ subject: STAFF_SUBJECT });

    expect(await staff.query(api.delinquencies.expiry.listArrearsWithoutClaim, {})).toEqual([]);
    const result = await staff.mutation(api.delinquencies.expiry.staffReturnToActive, {
      guaranteeId: fx.guaranteeId,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOTICE_OUTSTANDING");
  });

  test("an agency member cannot clear arrears", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await expect(
      t
        .withIdentity({ subject: "auth0|expiry-user" })
        .mutation(api.delinquencies.expiry.staffReturnToActive, { guaranteeId: fx.guaranteeId }),
    ).rejects.toThrow();
  });
});
