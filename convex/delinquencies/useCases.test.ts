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
import { insertContractAggregates } from "../contracts/aggregateWrites";
import { CONTRACT_STATUS, type ContractStatus } from "../contracts/domain";
import {
  DELINQUENCY_RESOLUTION,
  DELINQUENCY_STATUS,
  type DelinquencyResolution,
  type DelinquencyStatus,
} from "./domain";
import schema from "../schema";

type ContractSeed = {
  agencyId: AgencyId;
  status: ContractStatus;
  availableGuaranteeCents: number;
  tenantFullName?: string;
};

async function seedAndIndexContract(
  t: ReturnType<typeof convexTest>,
  spec: ContractSeed,
  publicId: string,
) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("contracts", {
      agencyId: spec.agencyId,
      publicId,
      status: spec.status,
      activatedAt: null,
      nextRenewalDate: "2026-12-31",
      availableGuaranteeCents: spec.availableGuaranteeCents,
      rental: {
        propertyKind: "residencial",
        rentCents: 100000,
        condoCents: 0,
        otherFeesCents: 0,
        totalRentCents: 100000,
        feeCents: 1500,
        oneTimeActivationFeeCents: 0,
        setupInstallments: 1,
        exitCostMultiplier: "5x",
        rentMultiplier: "30x",
        payer: "inquilino",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "pendente" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: spec.tenantFullName ?? "Test Tenant",
        cpf: "11144477735",
        birthDate: "1990-01-01",
        email: "tenant@test.br",
        phone: "11999999999",
        termApprovedAt: null,
      },
    });
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("seed lost");
    await insertContractAggregates(ctx, doc);
    return id;
  });
}

async function setup() {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  const { asUser, userId } = await setupAuthenticatedUser(t);
  const agencyId = await seedAgencyWithMembership(t, userId);
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
  return { t, asUser, agencyId, getGuaranteeCents, getDelinquencyRow };
}

type Actor = ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;

async function advance(
  asUser: Actor,
  agencyId: AgencyId,
  publicId: string,
  status: DelinquencyStatus,
  resolution?: DelinquencyResolution,
) {
  const result = await asUser.mutation(api.delinquencies.useCases.updateStatus, {
    agencyId,
    publicId,
    status,
    ...(resolution === undefined ? {} : { resolution }),
  });
  expect(result.success).toBe(true);
  return result;
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
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-D7",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-D7", 10_000);
    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.PROVISIONED);

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
    await advance(
      asUser,
      agencyId,
      publicId,
      DELINQUENCY_STATUS.CLOSED,
      DELINQUENCY_RESOLUTION.CURED,
    );

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

describe("updateStatus", () => {
  test("illegal transitions are rejected and leave state untouched", async () => {
    const { t, asUser, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-U1",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U1", 30_000);

    const result = await asUser.mutation(api.delinquencies.useCases.updateStatus, {
      agencyId,
      publicId,
      status: DELINQUENCY_STATUS.PROVISIONED,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });

    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.OPEN);
    expect(await getGuaranteeCents("CTR-U1")).toBe(100_000);
  });

  test("unknown publicId → NOT_FOUND", async () => {
    const { asUser, agencyId } = await setup();
    const result = await asUser.mutation(api.delinquencies.useCases.updateStatus, {
      agencyId,
      publicId: "DLQ-NOPE",
      status: DELINQUENCY_STATUS.UNDER_REVIEW,
    });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  test("provisioning decrements the guarantee; paying keeps the decrement", async () => {
    const { t, asUser, agencyId, getGuaranteeCents } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-U2",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U2", 30_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    expect(await getGuaranteeCents("CTR-U2")).toBe(100_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.PROVISIONED);
    expect(await getGuaranteeCents("CTR-U2")).toBe(70_000);
    const capacityAfterProvision = await asUser.query(
      api.contracts.useCases.getInsuredCapacityGlobal,
      {},
    );
    expect(capacityAfterProvision.sumInsuredCents).toBe(70_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.PAID);
    expect(await getGuaranteeCents("CTR-U2")).toBe(70_000);
    const capacityAfterPaid = await asUser.query(
      api.contracts.useCases.getInsuredCapacityGlobal,
      {},
    );
    expect(capacityAfterPaid.sumInsuredCents).toBe(70_000);
  });

  test("decrement floors at zero and paid keeps the applied decrement", async () => {
    const { t, asUser, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 20_000 },
      "CTR-U3",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U3", 20_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.PROVISIONED);
    expect(await getGuaranteeCents("CTR-U3")).toBe(0);

    const provisioned = await getDelinquencyRow(publicId);
    expect(provisioned?.appliedGuaranteeDecrementCents).toBe(20_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.PAID);
    expect(await getGuaranteeCents("CTR-U3")).toBe(0);
    const paid = await getDelinquencyRow(publicId);
    expect(paid?.appliedGuaranteeDecrementCents).toBe(20_000);
  });

  test("provisioned → closed releases the earmark and records resolution 'denied'", async () => {
    const { t, asUser, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-U5",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U5", 30_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.PROVISIONED);
    expect(await getGuaranteeCents("CTR-U5")).toBe(70_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.CLOSED);
    expect(await getGuaranteeCents("CTR-U5")).toBe(100_000);
    const capacity = await asUser.query(api.contracts.useCases.getInsuredCapacityGlobal, {});
    expect(capacity.sumInsuredCents).toBe(100_000);

    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.CLOSED);
    expect(row?.resolution).toBe(DELINQUENCY_RESOLUTION.DENIED);
    expect(row?.closedAt).not.toBeNull();
  });

  test("paid → closed records resolution 'paid_out' and keeps the decrement", async () => {
    const { t, asUser, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-U6",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U6", 30_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.PROVISIONED);
    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.PAID);
    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.CLOSED);

    expect(await getGuaranteeCents("CTR-U6")).toBe(70_000);
    const row = await getDelinquencyRow(publicId);
    expect(row?.resolution).toBe(DELINQUENCY_RESOLUTION.PAID_OUT);
  });

  test.each([DELINQUENCY_RESOLUTION.CURED, DELINQUENCY_RESOLUTION.DENIED])(
    "closing from open with caller-supplied '%s' records it",
    async (resolution) => {
      const { t, asUser, agencyId, getDelinquencyRow } = await setup();
      await seedAndIndexContract(
        t,
        { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
        "CTR-U7",
      );
      const publicId = await openDelinquency(asUser, agencyId, "CTR-U7", 10_000);

      await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.CLOSED, resolution);
      const row = await getDelinquencyRow(publicId);
      expect(row?.status).toBe(DELINQUENCY_STATUS.CLOSED);
      expect(row?.resolution).toBe(resolution);
    },
  );

  test("closing from under_review with 'cured' records it and leaves the guarantee untouched", async () => {
    const { t, asUser, agencyId, getGuaranteeCents, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 50_000 },
      "CTR-U8",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U8", 10_000);

    await advance(asUser, agencyId, publicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await advance(
      asUser,
      agencyId,
      publicId,
      DELINQUENCY_STATUS.CLOSED,
      DELINQUENCY_RESOLUTION.CURED,
    );
    expect(await getGuaranteeCents("CTR-U8")).toBe(50_000);

    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.CLOSED);
    expect(row?.resolution).toBe(DELINQUENCY_RESOLUTION.CURED);
    expect(row?.closedAt).not.toBeNull();
  });

  test("closing from open without a resolution is rejected", async () => {
    const { t, asUser, agencyId, getDelinquencyRow } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-U9",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U9", 10_000);

    const result = await asUser.mutation(api.delinquencies.useCases.updateStatus, {
      agencyId,
      publicId,
      status: DELINQUENCY_STATUS.CLOSED,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });
    const row = await getDelinquencyRow(publicId);
    expect(row?.status).toBe(DELINQUENCY_STATUS.OPEN);
  });

  test("closing from open with caller-supplied 'paid_out' is rejected", async () => {
    const { t, asUser, agencyId } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-U10",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U10", 10_000);

    const result = await asUser.mutation(api.delinquencies.useCases.updateStatus, {
      agencyId,
      publicId,
      status: DELINQUENCY_STATUS.CLOSED,
      resolution: DELINQUENCY_RESOLUTION.PAID_OUT,
    });
    expect(result).toMatchObject({ success: false, error: { code: "ILLEGAL_TRANSITION" } });
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
    const { t, asUser, agencyId } = await setup();
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

    await advance(asUser, agencyId, secondPublicId, DELINQUENCY_STATUS.UNDER_REVIEW);
    await advance(asUser, agencyId, secondPublicId, DELINQUENCY_STATUS.PROVISIONED);

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
