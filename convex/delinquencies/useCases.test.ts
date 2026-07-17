// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import {
  registerContractAggregateComponents,
  seedAgencyWithMembership,
  seedForeignAgency,
  setupAuthenticatedUser,
} from "../lib/testFixtures";
import { CONTRACT_STATUS } from "../contracts/domain";
import { DELINQUENCY_RESOLUTION, DELINQUENCY_STATUS } from "./domain";
import { applyDelinquencyTransition } from "./transitions";
import {
  STAFF_ADMIN_SUBJECT,
  seedAndIndexContract,
  seedStaffActor,
  staffAdvance,
  type Actor,
} from "./testSupport";
import schema from "../schema";

async function setup() {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  const { asUser, userId } = await setupAuthenticatedUser(t);
  const agencyId = await seedAgencyWithMembership(t, userId);
  const { asStaff } = await seedStaffActor(t, STAFF_ADMIN_SUBJECT, ["admin"]);
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
  return { t, asUser, asStaff, agencyId, getGuaranteeCents, getDelinquencyRow };
}

async function openDelinquency(
  asUser: Actor,
  agencyId: AgencyId,
  contractPublicId: string,
  amountCents: number,
): Promise<string> {
  const result = await asUser.mutation(api.delinquencies.useCases.open, {
    agencyId,
    contractPublicId,
    amountCents,
  });
  if (!result.success) throw new Error("open failed in fixture");
  return result.data.publicId;
}

describe("open", () => {
  test("happy path — active contract, positive amount", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-D1",
    );

    const result = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-D1",
      amountCents: 30_000,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publicId).toMatch(/^DLQ-/);
    expect(result.data.status).toBe(DELINQUENCY_STATUS.OPEN);

    const row = await t.run(async (ctx) => {
      return ctx.db
        .query("delinquencies")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique();
    });
    expect(row).not.toBeNull();
    expect(row?.status).toBe(DELINQUENCY_STATUS.OPEN);
    expect(row?.agencyId).toBe(agencyId);
    expect(row?.amountCents).toBe(30_000);
    expect(row?.closedAt).toBeNull();
    expect(row?.appliedGuaranteeDecrementCents).toBeNull();
    expect(row?.resolution).toBeNull();
    expect(new Date(row?.openedAt ?? "").getTime()).not.toBeNaN();
  });

  test("appends an audit entry", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-D2",
    );

    await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-D2",
      amountCents: 5_000,
    });

    const entries = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
    expect(entries.some((e) => e.action === "delinquency.opened")).toBe(true);
  });

  test("rejects a non-active contract", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.PENDENTE, availableGuaranteeCents: 100_000 },
      "CTR-D3",
    );

    const result = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-D3",
      amountCents: 30_000,
    });
    expect(result).toMatchObject({ success: false, error: { code: "CONTRACT_NOT_ACTIVE" } });
  });

  test("rejects non-positive and non-integer amounts", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-D4",
    );

    for (const amountCents of [0, -1, 10.5]) {
      const result = await asUser.mutation(api.delinquencies.useCases.open, {
        agencyId,
        contractPublicId: "CTR-D4",
        amountCents,
      });
      expect(result).toMatchObject({ success: false, error: { code: "INVALID_AMOUNT" } });
    }
  });

  test("rejects an amount above the available guarantee; boundary amount succeeds", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-D5",
    );

    const above = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-D5",
      amountCents: 100_001,
    });
    expect(above).toMatchObject({ success: false, error: { code: "AMOUNT_EXCEEDS_GUARANTEE" } });

    const boundary = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-D5",
      amountCents: 100_000,
    });
    expect(boundary.success).toBe(true);
  });

  test("second open while a delinquency is still open → DELINQUENCY_ALREADY_OPEN", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-D6",
    );
    await openDelinquency(asUser, agencyId, "CTR-D6", 10_000);

    const second = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-D6",
      amountCents: 5_000,
    });
    expect(second).toMatchObject({ success: false, error: { code: "DELINQUENCY_ALREADY_OPEN" } });
  });

  test("second open while a delinquency is provisioned → DELINQUENCY_ALREADY_OPEN", async () => {
    const { t, asUser, asStaff, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-D7",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-D7", 10_000);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.PROVISIONED);

    const second = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-D7",
      amountCents: 5_000,
    });
    expect(second).toMatchObject({ success: false, error: { code: "DELINQUENCY_ALREADY_OPEN" } });
  });

  test("reopening after the previous delinquency closed succeeds", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-D8",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-D8", 10_000);
    const closed = await asUser.mutation(api.delinquencies.useCases.closeAsCured, {
      agencyId,
      publicId,
    });
    expect(closed.success).toBe(true);

    const reopened = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-D8",
      amountCents: 5_000,
    });
    expect(reopened.success).toBe(true);
  });

  test("unknown contract publicId → NOT_FOUND", async () => {
    const { asUser, agencyId } = await setup();
    const result = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-NOPE",
      amountCents: 30_000,
    });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  test("foreign-agency contract → NOT_FOUND (no existence leak)", async () => {
    const { t, asUser, agencyId } = await setup();
    const foreignAgencyId = await seedForeignAgency(t);
    await seedAndIndexContract(
      t,
      {
        agencyId: foreignAgencyId,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 100_000,
      },
      "CTR-FOREIGN",
    );

    const result = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-FOREIGN",
      amountCents: 30_000,
    });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  test("cross-agency scope rejected by the wrapper", async () => {
    const { t, asUser } = await setup();
    const foreignAgencyId = await seedForeignAgency(t);
    await seedAndIndexContract(
      t,
      {
        agencyId: foreignAgencyId,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 100_000,
      },
      "CTR-F2",
    );

    await expect(
      asUser.mutation(api.delinquencies.useCases.open, {
        agencyId: foreignAgencyId,
        contractPublicId: "CTR-F2",
        amountCents: 30_000,
      }),
    ).rejects.toThrow();
  });
});

describe("closeAsCured", () => {
  test("succeeds from open — resolution 'cured', closedAt set, guarantee untouched", async () => {
    const { t, asUser, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-C1",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-C1", 10_000);

    const result = await asUser.mutation(api.delinquencies.useCases.closeAsCured, {
      agencyId,
      publicId,
    });
    expect(result.success).toBe(true);
    expect(await getGuaranteeCents("CTR-C1")).toBe(100_000);

    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.CLOSED);
    expect(row?.resolution).toBe(DELINQUENCY_RESOLUTION.CURED);
    expect(row?.closedAt).not.toBeNull();
  });

  test("succeeds from under_review — resolution 'cured', guarantee untouched", async () => {
    const { t, asUser, asStaff, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 50_000 },
      "CTR-C2",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-C2", 10_000);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);

    const result = await asUser.mutation(api.delinquencies.useCases.closeAsCured, {
      agencyId,
      publicId,
    });
    expect(result.success).toBe(true);
    expect(await getGuaranteeCents("CTR-C2")).toBe(50_000);

    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.CLOSED);
    expect(row?.resolution).toBe(DELINQUENCY_RESOLUTION.CURED);
  });

  test("appends a status-updated audit entry", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-C3",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-C3", 10_000);
    await asUser.mutation(api.delinquencies.useCases.closeAsCured, { agencyId, publicId });

    const entries = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
    expect(entries.some((e) => e.action === "delinquency.status_updated")).toBe(true);
  });

  test("on a provisioned row → ILLEGAL_TRANSITION and the earmark is NOT released", async () => {
    const { t, asUser, asStaff, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-C4",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-C4", 30_000);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.PROVISIONED);
    expect(await getGuaranteeCents("CTR-C4")).toBe(70_000);

    const result = await asUser.mutation(api.delinquencies.useCases.closeAsCured, {
      agencyId,
      publicId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });
    expect(await getGuaranteeCents("CTR-C4")).toBe(70_000);
    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.PROVISIONED);
  });

  test("on a paid row → ILLEGAL_TRANSITION", async () => {
    const { t, asUser, asStaff, agencyId, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-C5",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-C5", 10_000);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.PROVISIONED);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.PAID);

    const result = await asUser.mutation(api.delinquencies.useCases.closeAsCured, {
      agencyId,
      publicId,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });
    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.PAID);
  });

  test("unknown publicId → NOT_FOUND", async () => {
    const { asUser, agencyId } = await setup();
    const result = await asUser.mutation(api.delinquencies.useCases.closeAsCured, {
      agencyId,
      publicId: "DLQ-NOPE",
    });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  test("foreign-agency delinquency → NOT_FOUND (no existence leak)", async () => {
    const { t, asUser, agencyId } = await setup();
    const foreignAgencyId = await seedForeignAgency(t);
    const foreignContractId = await seedAndIndexContract(
      t,
      {
        agencyId: foreignAgencyId,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 100_000,
      },
      "CTR-C6",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("delinquencies", {
        contractId: foreignContractId,
        agencyId: foreignAgencyId,
        publicId: "DLQ-FOREIGN-C",
        status: DELINQUENCY_STATUS.OPEN,
        amountCents: 9_000,
        openedAt: new Date().toISOString(),
        closedAt: null,
        appliedGuaranteeDecrementCents: null,
        resolution: null,
      });
    });

    const result = await asUser.mutation(api.delinquencies.useCases.closeAsCured, {
      agencyId,
      publicId: "DLQ-FOREIGN-C",
    });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });
});

describe("transitions (direct) — paths with no public surface yet", () => {
  test("paid → closed records resolution 'paid_out' and keeps the decrement", async () => {
    const { t, asUser, asStaff, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-T1",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-T1", 30_000);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.PROVISIONED);
    await staffAdvance(asStaff, publicId, DELINQUENCY_STATUS.PAID);

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("delinquencies")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique();
      if (!row) throw new Error("row missing");
      const result = await applyDelinquencyTransition(ctx, {
        row,
        toStatus: DELINQUENCY_STATUS.CLOSED,
      });
      if (!result.success) throw new Error("direct close failed");
    });

    expect(await getGuaranteeCents("CTR-T1")).toBe(70_000);
    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.CLOSED);
    expect(row?.resolution).toBe(DELINQUENCY_RESOLUTION.PAID_OUT);
  });

  test("closing from open with 'paid_out' is rejected by the state machine", async () => {
    const { t, asUser, agencyId, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-T2",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-T2", 10_000);

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("delinquencies")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique();
      if (!row) throw new Error("row missing");
      const result = await applyDelinquencyTransition(ctx, {
        row,
        toStatus: DELINQUENCY_STATUS.CLOSED,
        resolution: DELINQUENCY_RESOLUTION.PAID_OUT,
      });
      expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });
    });
    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.OPEN);
  });
});

describe("listByAgency", () => {
  test("returns only the caller agency's rows with tenant + contract projection", async () => {
    const { t, asUser, agencyId } = await setup();
    const foreignAgencyId = await seedForeignAgency(t);
    await seedAndIndexContract(
      t,
      {
        agencyId,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 100_000,
        tenantFullName: "Maria Silva",
      },
      "CTR-L1",
    );
    const foreignContractId = await seedAndIndexContract(
      t,
      {
        agencyId: foreignAgencyId,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 100_000,
      },
      "CTR-L2",
    );

    const own = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-L1",
      amountCents: 15_000,
    });
    expect(own.success).toBe(true);

    await t.run(async (ctx) => {
      await ctx.db.insert("delinquencies", {
        contractId: foreignContractId,
        agencyId: foreignAgencyId,
        publicId: "DLQ-FOREIGN",
        status: "open",
        amountCents: 99_000,
        openedAt: new Date().toISOString(),
        closedAt: null,
        appliedGuaranteeDecrementCents: null,
        resolution: null,
      });
    });

    const result = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
      status: DELINQUENCY_STATUS.OPEN,
      amountCents: 15_000,
      contractPublicId: "CTR-L1",
      tenantFullName: "Maria Silva",
    });
  });

  test("status filter returns only matching rows", async () => {
    const { t, asUser, asStaff, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-L3A",
    );
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-L3B",
    );

    await openDelinquency(asUser, agencyId, "CTR-L3A", 10_000);
    const secondPublicId = await openDelinquency(asUser, agencyId, "CTR-L3B", 20_000);

    await staffAdvance(asStaff, secondPublicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await staffAdvance(asStaff, secondPublicId, DELINQUENCY_STATUS.PROVISIONED);

    const provisioned = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 50, cursor: null },
      status: DELINQUENCY_STATUS.PROVISIONED,
    });
    expect(provisioned.page).toHaveLength(1);
    expect(provisioned.page[0]?.publicId).toBe(secondPublicId);

    const all = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(all.page).toHaveLength(2);
  });

  test("cross-agency scope rejected by the wrapper", async () => {
    const { t, asUser } = await setup();
    const foreignAgencyId = await seedForeignAgency(t);

    await expect(
      asUser.query(api.delinquencies.useCases.listByAgency, {
        agencyId: foreignAgencyId,
        paginationOpts: { numItems: 50, cursor: null },
      }),
    ).rejects.toThrow();
  });

  test("respects paginationOpts numItems", async () => {
    const { t, asUser, agencyId } = await setup();
    for (const [publicId, amountCents] of [
      ["CTR-L4A", 1_000],
      ["CTR-L4B", 2_000],
      ["CTR-L4C", 3_000],
    ] as const) {
      await seedAndIndexContract(
        t,
        { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
        publicId,
      );
      await openDelinquency(asUser, agencyId, publicId, amountCents);
    }

    const firstPage = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
  });
});
