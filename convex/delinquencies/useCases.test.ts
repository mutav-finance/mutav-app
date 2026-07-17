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
import { DELINQUENCY_STATUS, type DelinquencyStatus } from "./domain";
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
  return { t, asUser, agencyId, getGuaranteeCents };
}

async function walkStatuses(
  asUser: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  agencyId: AgencyId,
  publicId: string,
  statuses: readonly DelinquencyStatus[],
) {
  for (const status of statuses) {
    const result = await asUser.mutation(api.delinquencies.useCases.updateStatus, {
      agencyId,
      publicId,
      status,
    });
    expect(result.success).toBe(true);
  }
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
  async function openDelinquency(
    asUser: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
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

  test("illegal transitions are rejected and leave state untouched", async () => {
    const { t, asUser, agencyId, getGuaranteeCents } = await setup();
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

    const row = await t.run((ctx) =>
      ctx.db
        .query("delinquencies")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique(),
    );
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

  test("provisioning decrements the guarantee; paying restores it", async () => {
    const { t, asUser, agencyId, getGuaranteeCents } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-U2",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U2", 30_000);

    await walkStatuses(asUser, agencyId, publicId, [DELINQUENCY_STATUS.UNDER_REVIEW]);
    expect(await getGuaranteeCents("CTR-U2")).toBe(100_000);

    await walkStatuses(asUser, agencyId, publicId, [DELINQUENCY_STATUS.PROVISIONED]);
    expect(await getGuaranteeCents("CTR-U2")).toBe(70_000);
    const capacityAfterProvision = await asUser.query(
      api.contracts.useCases.getInsuredCapacityGlobal,
      {},
    );
    expect(capacityAfterProvision.sumInsuredCents).toBe(70_000);

    await walkStatuses(asUser, agencyId, publicId, [DELINQUENCY_STATUS.PAID]);
    expect(await getGuaranteeCents("CTR-U2")).toBe(100_000);
    const capacityAfterPaid = await asUser.query(
      api.contracts.useCases.getInsuredCapacityGlobal,
      {},
    );
    expect(capacityAfterPaid.sumInsuredCents).toBe(100_000);
  });

  test("decrement floors at zero and restore returns only the applied amount", async () => {
    const { t, asUser, agencyId, getGuaranteeCents } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 20_000 },
      "CTR-U3",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U3", 30_000);

    await walkStatuses(asUser, agencyId, publicId, [
      DELINQUENCY_STATUS.UNDER_REVIEW,
      DELINQUENCY_STATUS.PROVISIONED,
    ]);
    expect(await getGuaranteeCents("CTR-U3")).toBe(0);

    const provisioned = await t.run((ctx) =>
      ctx.db
        .query("delinquencies")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique(),
    );
    expect(provisioned?.appliedGuaranteeDecrementCents).toBe(20_000);

    await walkStatuses(asUser, agencyId, publicId, [DELINQUENCY_STATUS.PAID]);
    expect(await getGuaranteeCents("CTR-U3")).toBe(20_000);
  });

  test("non-provisioning transitions leave the guarantee untouched", async () => {
    const { t, asUser, agencyId, getGuaranteeCents } = await setup();
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 50_000 },
      "CTR-U4",
    );
    const publicId = await openDelinquency(asUser, agencyId, "CTR-U4", 10_000);

    await walkStatuses(asUser, agencyId, publicId, [
      DELINQUENCY_STATUS.UNDER_REVIEW,
      DELINQUENCY_STATUS.CLOSED,
    ]);
    expect(await getGuaranteeCents("CTR-U4")).toBe(50_000);

    const row = await t.run((ctx) =>
      ctx.db
        .query("delinquencies")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique(),
    );
    expect(row?.status).toBe(DELINQUENCY_STATUS.CLOSED);
    expect(row?.closedAt).not.toBeNull();
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
      "CTR-L3",
    );

    const first = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-L3",
      amountCents: 10_000,
    });
    const second = await asUser.mutation(api.delinquencies.useCases.open, {
      agencyId,
      contractPublicId: "CTR-L3",
      amountCents: 20_000,
    });
    if (!first.success || !second.success) throw new Error("open failed in fixture");

    await walkStatuses(asUser, agencyId, second.data.publicId, [
      DELINQUENCY_STATUS.UNDER_REVIEW,
      DELINQUENCY_STATUS.PROVISIONED,
    ]);

    const provisioned = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 50, cursor: null },
      status: DELINQUENCY_STATUS.PROVISIONED,
    });
    expect(provisioned.page).toHaveLength(1);
    expect(provisioned.page[0]?.publicId).toBe(second.data.publicId);

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
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_000 },
      "CTR-L4",
    );
    for (const amountCents of [1_000, 2_000, 3_000]) {
      await asUser.mutation(api.delinquencies.useCases.open, {
        agencyId,
        contractPublicId: "CTR-L4",
        amountCents,
      });
    }

    const firstPage = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
  });
});
