// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import { ativoInsuredCentsPlatform, contractsByStatusPlatform } from "./aggregate";
import { registerContractAggregateComponents } from "../lib/testFixtures";
import { CONTRACT_STATUS, type ContractStatus } from "./domain";
import schema from "../schema";

async function seedAgency(t: ReturnType<typeof convexTest>, cnpj: string): Promise<AgencyId> {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name: `Test ${cnpj}`,
      cnpj,
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    }),
  );
}

type ContractSeed = {
  agencyId: AgencyId;
  status: ContractStatus;
  availableGuaranteeCents: number;
};

async function seedTenantRow(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ctx.db.insert("tenants", {
      entityType: "pf",
      taxId: "11144477735",
      fullName: "Test Tenant",
      birthDate: "1990-01-01",
      email: "tenant@test.br",
      phone: "11999999999",
    }),
  );
}

async function seedContractDirect(
  t: ReturnType<typeof convexTest>,
  spec: ContractSeed,
  publicId: string,
) {
  const tenantId = await seedTenantRow(t);
  return t.run((ctx) =>
    ctx.db.insert("contracts", {
      agencyId: spec.agencyId,
      publicId,
      tenantId,
      tenantApproval: { status: "pendente", termApprovedAt: null },
      status: spec.status,
      activatedAt: null,
      nextRenewalDate: "2026-12-31",
      availableGuaranteeCents: spec.availableGuaranteeCents,
      rental: {
        propertyKind: "residencial",
        plan: "basic",
        rentCents: 100000,
        condoCents: 0,
        otherFeesCents: 0,
        totalRentCents: 100000,
        feeCents: 1500,
        oneTimeActivationFeeCents: 0,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
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
    }),
  );
}

async function platformAtivoCount(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    contractsByStatusPlatform.count(ctx, {
      bounds: {
        lower: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
        upper: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
      },
    }),
  );
}

async function platformInsuredSum(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ativoInsuredCentsPlatform.sum(ctx, {
      bounds: {
        lower: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
        upper: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
      },
    }),
  );
}

describe("backfillPlatformAggregates", () => {
  test("populates platform count and sum aggregates from raw contracts", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000000999");

    await seedContractDirect(
      t,
      { agencyId: agency, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_00 },
      "BF1",
    );
    await seedContractDirect(
      t,
      { agencyId: agency, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 250_00 },
      "BF2",
    );
    await seedContractDirect(
      t,
      { agencyId: agency, status: CONTRACT_STATUS.PENDENTE, availableGuaranteeCents: 999_00 },
      "BF3",
    );

    expect(await platformAtivoCount(t)).toBe(0);
    expect(await platformInsuredSum(t)).toBe(0);

    const first = await t.mutation(internal.contracts.backfill.backfillPlatformAggregates, {});
    expect(first.processed).toBe(3);
    expect(first.done).toBe(true);

    expect(await platformAtivoCount(t)).toBe(2);
    // Exposure per ativo = ceiling + 6x exit (100_000 x 6 = 600_000).
    // Two ativo: (10_000 + 25_000) + 2 x 600_000.
    expect(await platformInsuredSum(t)).toBe(1_235_000);
  });

  test("idempotent — re-running after first pass is a no-op", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000001001");
    await seedContractDirect(
      t,
      { agencyId: agency, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 42_00 },
      "BF4",
    );

    await t.mutation(internal.contracts.backfill.backfillPlatformAggregates, {});
    expect(await platformAtivoCount(t)).toBe(1);
    expect(await platformInsuredSum(t)).toBe(604_200);

    await t.mutation(internal.contracts.backfill.backfillPlatformAggregates, {});
    expect(await platformAtivoCount(t)).toBe(1);
    expect(await platformInsuredSum(t)).toBe(604_200);
  });
});
