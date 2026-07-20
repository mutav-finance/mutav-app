// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  registerContractAggregateComponents,
  seedAgencyWithMembership,
  seedForeignAgency,
  setupAuthenticatedUser,
} from "../lib/testFixtures";
import { CONTRACT_STATUS } from "../contracts/domain";
import { DELINQUENCY_RESOLUTION, DELINQUENCY_STATUS } from "./domain";
import {
  STAFF_ADMIN_SUBJECT,
  seedAndIndexContract,
  seedStaffActor,
  staffAdvance,
} from "./testSupport";
import schema from "../schema";

async function setup() {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  const { asUser, userId } = await setupAuthenticatedUser(t);
  const agencyId = await seedAgencyWithMembership(t, userId);
  const { asStaff, userId: staffUserId } = await seedStaffActor(t, STAFF_ADMIN_SUBJECT, ["admin"]);
  const getGuaranteeCents = (contractPublicId: string): Promise<number> =>
    t.run(async (ctx) => {
      const contract = await ctx.db
        .query("contracts")
        .withIndex("by_publicId", (q) => q.eq("publicId", contractPublicId))
        .unique();
      if (!contract) throw new Error("contract missing");
      return contract.availableGuaranteeCents;
    });
  const getDelinquencyRow = (publicId: string) =>
    t.run((ctx) =>
      ctx.db
        .query("delinquencies")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique(),
    );
  return { t, asUser, asStaff, staffUserId, agencyId, getGuaranteeCents, getDelinquencyRow };
}

type SetupResult = Awaited<ReturnType<typeof setup>>;

async function openDelinquency(
  { t, asUser, agencyId }: Pick<SetupResult, "t" | "asUser" | "agencyId">,
  contractPublicId: string,
  amountCents: number,
): Promise<string> {
  await seedAndIndexContract(
    t,
    { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
    contractPublicId,
  );
  const result = await asUser.mutation(api.delinquencies.useCases.open, {
    agencyId,
    contractPublicId,
    amountCents,
  });
  if (!result.success) throw new Error("open failed in fixture");
  return result.data.publicId;
}

describe("authorization — agency members are rejected", () => {
  test("an agency member (non-staff) cannot call any staff transition", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A1", 10_000);

    await expect(
      ctx.asUser.mutation(api.delinquencies.adminUseCases.startReview, { publicId }),
    ).rejects.toThrow();
    await expect(
      ctx.asUser.mutation(api.delinquencies.adminUseCases.provision, { publicId }),
    ).rejects.toThrow();
    await expect(
      ctx.asUser.mutation(api.delinquencies.adminUseCases.markPaid, { publicId }),
    ).rejects.toThrow();
    await expect(
      ctx.asUser.mutation(api.delinquencies.adminUseCases.closeAsDenied, { publicId }),
    ).rejects.toThrow();
  });
});

describe("authorization — role ladder", () => {
  test("support cannot start a review (needs compliance)", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A2", 10_000);
    const { asStaff: asSupport } = await seedStaffActor(ctx.t, "auth0|staff-support", ["support"]);

    await expect(
      asSupport.mutation(api.delinquencies.adminUseCases.startReview, { publicId }),
    ).rejects.toThrow();
  });

  test("compliance can start a review but cannot provision, pay, or deny", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A3", 10_000);
    const { asStaff: asCompliance } = await seedStaffActor(ctx.t, "auth0|staff-compliance", [
      "compliance",
    ]);

    const review = await asCompliance.mutation(api.delinquencies.adminUseCases.startReview, {
      publicId,
    });
    expect(review.success).toBe(true);

    await expect(
      asCompliance.mutation(api.delinquencies.adminUseCases.provision, { publicId }),
    ).rejects.toThrow();
    await expect(
      asCompliance.mutation(api.delinquencies.adminUseCases.markPaid, { publicId }),
    ).rejects.toThrow();
    await expect(
      asCompliance.mutation(api.delinquencies.adminUseCases.closeAsDenied, { publicId }),
    ).rejects.toThrow();
  });

  test("treasury (off-ladder) never satisfies a staff transition gate", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A4", 10_000);
    const { asStaff: asTreasury } = await seedStaffActor(ctx.t, "auth0|staff-treasury", [
      "treasury",
    ]);

    await expect(
      asTreasury.mutation(api.delinquencies.adminUseCases.startReview, { publicId }),
    ).rejects.toThrow();
    await expect(
      asTreasury.mutation(api.delinquencies.adminUseCases.provision, { publicId }),
    ).rejects.toThrow();
  });
});

describe("staff happy path", () => {
  test("full lifecycle: review → provision decrements → paid keeps the decrement", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A5", 30_000);

    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    expect(await ctx.getGuaranteeCents("CTR-A5")).toBe(100_000);

    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.PROVISIONED);
    expect(await ctx.getGuaranteeCents("CTR-A5")).toBe(70_000);
    const provisioned = await ctx.getDelinquencyRow(publicId);
    expect(provisioned?.appliedGuaranteeDecrementCents).toBe(30_000);
    const capacityAfterProvision = await ctx.asUser.query(
      api.contracts.useCases.getInsuredCapacityGlobal,
      {},
    );
    expect(capacityAfterProvision.sumInsuredCents).toBe(70_000);

    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.PAID);
    expect(await ctx.getGuaranteeCents("CTR-A5")).toBe(70_000);
    const paid = await ctx.getDelinquencyRow(publicId);
    expect(paid?.status).toBe(DELINQUENCY_STATUS.PAID);
    expect(paid?.appliedGuaranteeDecrementCents).toBe(30_000);
    const capacityAfterPaid = await ctx.asUser.query(
      api.contracts.useCases.getInsuredCapacityGlobal,
      {},
    );
    expect(capacityAfterPaid.sumInsuredCents).toBe(70_000);
  });

  test("decrement floors at zero when the guarantee is exhausted", async () => {
    const ctx = await setup();
    await seedAndIndexContract(
      ctx.t,
      { agencyId: ctx.agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 20_000 },
      "CTR-A13",
    );
    const opened = await ctx.asUser.mutation(api.delinquencies.useCases.open, {
      agencyId: ctx.agencyId,
      contractPublicId: "CTR-A13",
      amountCents: 20_000,
    });
    if (!opened.success) throw new Error("open failed in fixture");
    const publicId = opened.data.publicId;

    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.PROVISIONED);
    expect(await ctx.getGuaranteeCents("CTR-A13")).toBe(0);

    const provisioned = await ctx.getDelinquencyRow(publicId);
    expect(provisioned?.appliedGuaranteeDecrementCents).toBe(20_000);

    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.PAID);
    expect(await ctx.getGuaranteeCents("CTR-A13")).toBe(0);
    const paid = await ctx.getDelinquencyRow(publicId);
    expect(paid?.appliedGuaranteeDecrementCents).toBe(20_000);
  });

  test("closeAsDenied from provisioned releases the earmark and records 'denied'", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A6", 30_000);

    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.PROVISIONED);
    expect(await ctx.getGuaranteeCents("CTR-A6")).toBe(70_000);

    const result = await ctx.asStaff.mutation(api.delinquencies.adminUseCases.closeAsDenied, {
      publicId,
    });
    expect(result.success).toBe(true);
    expect(await ctx.getGuaranteeCents("CTR-A6")).toBe(100_000);
    const capacity = await ctx.asUser.query(api.contracts.useCases.getInsuredCapacityGlobal, {});
    expect(capacity.sumInsuredCents).toBe(100_000);

    const row = await ctx.getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.CLOSED);
    expect(row?.resolution).toBe(DELINQUENCY_RESOLUTION.DENIED);
    expect(row?.closedAt).not.toBeNull();
  });

  test("closeAsDenied from open and under_review records 'denied' with no guarantee change", async () => {
    const ctx = await setup();
    const openPublicId = await openDelinquency(ctx, "CTR-A7", 10_000);
    const reviewPublicId = await openDelinquency(ctx, "CTR-A8", 10_000);
    await staffAdvance(ctx.asStaff, reviewPublicId, DELINQUENCY_STATUS.UNDER_REVIEW);

    for (const publicId of [openPublicId, reviewPublicId]) {
      const result = await ctx.asStaff.mutation(api.delinquencies.adminUseCases.closeAsDenied, {
        publicId,
      });
      expect(result.success).toBe(true);
      const row = await ctx.getDelinquencyRow(publicId);
      expect(row?.resolution).toBe(DELINQUENCY_RESOLUTION.DENIED);
    }
    expect(await ctx.getGuaranteeCents("CTR-A7")).toBe(100_000);
    expect(await ctx.getGuaranteeCents("CTR-A8")).toBe(100_000);
  });

  test("staff transitions write audit entries attributed to the staff user", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A9", 10_000);

    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);

    const entries = await ctx.t.run((c) =>
      c.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "delinquencies").eq("resourceId", publicId),
        )
        .collect(),
    );
    const statusEntries = entries.filter((e) => e.action === "delinquency.status_updated");
    expect(statusEntries.length).toBe(1);
    expect(statusEntries[0]?.actor).toEqual({ kind: "user", userId: ctx.staffUserId });
  });
});

describe("wrong-state guards", () => {
  test("provision on an open row → ILLEGAL_TRANSITION, state untouched", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A10", 10_000);

    const result = await ctx.asStaff.mutation(api.delinquencies.adminUseCases.provision, {
      publicId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });
    const row = await ctx.getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.OPEN);
    expect(await ctx.getGuaranteeCents("CTR-A10")).toBe(100_000);
  });

  test("markPaid on an open row → ILLEGAL_TRANSITION", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A11", 10_000);

    const result = await ctx.asStaff.mutation(api.delinquencies.adminUseCases.markPaid, {
      publicId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });
  });

  test("closeAsDenied on a paid row → ILLEGAL_TRANSITION (paid closure is not a denial)", async () => {
    const ctx = await setup();
    const publicId = await openDelinquency(ctx, "CTR-A12", 10_000);
    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.PROVISIONED);
    await staffAdvance(ctx.asStaff, publicId, DELINQUENCY_STATUS.PAID);

    const result = await ctx.asStaff.mutation(api.delinquencies.adminUseCases.closeAsDenied, {
      publicId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });
    const row = await ctx.getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.PAID);
  });

  test("unknown publicId → NOT_FOUND Result", async () => {
    const ctx = await setup();
    const result = await ctx.asStaff.mutation(api.delinquencies.adminUseCases.startReview, {
      publicId: "DLQ-NOPE",
    });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });
});

describe("cross-agency reach", () => {
  test("staff can transition a delinquency in any agency without membership", async () => {
    const ctx = await setup();
    const foreignAgencyId = await seedForeignAgency(ctx.t);
    const foreignContractId = await seedAndIndexContract(
      ctx.t,
      {
        agencyId: foreignAgencyId,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 100_000,
      },
      "CTR-FOREIGN-A",
    );
    await ctx.t.run(async (c) => {
      await c.db.insert("delinquencies", {
        contractId: foreignContractId,
        agencyId: foreignAgencyId,
        publicId: "DLQ-FOREIGN-A",
        status: DELINQUENCY_STATUS.OPEN,
        amountCents: 15_000,
        openedAt: new Date().toISOString(),
        closedAt: null,
        appliedGuaranteeDecrementCents: null,
        resolution: null,
      });
    });

    const result = await ctx.asStaff.mutation(api.delinquencies.adminUseCases.startReview, {
      publicId: "DLQ-FOREIGN-A",
    });
    expect(result.success).toBe(true);
    const row = await ctx.getDelinquencyRow("DLQ-FOREIGN-A");
    expect(row?.status).toBe(DELINQUENCY_STATUS.UNDER_REVIEW);
  });
});
