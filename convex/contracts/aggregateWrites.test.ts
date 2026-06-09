// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  ativoInsuredCentsPlatform,
  contractsByStatus,
  contractsByStatusPlatform,
} from "./aggregate";
import {
  deleteContractAggregates,
  insertContractAggregates,
  replaceContractAggregates,
} from "./aggregateWrites";
import { registerContractAggregateComponents } from "../lib/testFixtures";
import { CONTRACT_STATUS, type ContractStatus } from "./domain";
import schema from "../schema";

type SeedAgency = Id<"agencies">;

async function seedAgency(t: ReturnType<typeof convexTest>, cnpj: string): Promise<SeedAgency> {
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
  agencyId: SeedAgency;
  status: ContractStatus;
  availableGuaranteeCents: number;
  activatedAt?: string | null;
  deactivatedAt?: string | null;
};

async function seedContract(
  t: ReturnType<typeof convexTest>,
  spec: ContractSeed,
  publicId: string,
): Promise<Id<"contracts">> {
  return t.run((ctx) =>
    ctx.db.insert("contracts", {
      agencyId: spec.agencyId,
      publicId,
      status: spec.status,
      activatedAt: spec.activatedAt ?? null,
      deactivatedAt: spec.deactivatedAt,
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
        fullName: "Test Tenant",
        cpf: "11144477735",
        birthDate: "1990-01-01",
        email: "tenant@test.br",
        phone: "11999999999",
        termApprovedAt: null,
      },
    }),
  );
}

async function ativoCountFor(t: ReturnType<typeof convexTest>, agencyId: SeedAgency) {
  return t.run((ctx) =>
    contractsByStatus.count(ctx, {
      namespace: agencyId,
      bounds: {
        lower: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
        upper: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
      },
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

describe("insertContractAggregates", () => {
  test("keeps per-agency, platform, and sum-insured aggregates in lockstep", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agencyA = await seedAgency(t, "00000000000111");
    const agencyB = await seedAgency(t, "00000000000222");

    const docs = [
      { agencyId: agencyA, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_00 },
      { agencyId: agencyA, status: CONTRACT_STATUS.PENDENTE, availableGuaranteeCents: 200_00 },
      { agencyId: agencyB, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 300_00 },
    ] as const;

    for (let i = 0; i < docs.length; i++) {
      const id = await seedContract(t, docs[i], `CTR-INS${i}`);
      await t.run(async (ctx) => {
        const doc = await ctx.db.get(id);
        if (!doc) throw new Error("seed lost");
        await insertContractAggregates(ctx, doc);
      });
    }

    const ativoA = await ativoCountFor(t, agencyA);
    const ativoB = await ativoCountFor(t, agencyB);
    const ativoPlatform = await platformAtivoCount(t);
    expect(ativoA + ativoB).toBe(ativoPlatform);
    expect(ativoPlatform).toBe(2);

    const sum = await platformInsuredSum(t);
    expect(sum).toBe(100_00 + 300_00);
  });
});

describe("replaceContractAggregates", () => {
  test("flips counts and sum when pendente becomes ativo", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000000333");
    const id = await seedContract(
      t,
      { agencyId: agency, status: CONTRACT_STATUS.PENDENTE, availableGuaranteeCents: 500_00 },
      "CTR-REP1",
    );
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(id);
      if (!doc) throw new Error("seed lost");
      await insertContractAggregates(ctx, doc);
    });

    expect(await platformInsuredSum(t)).toBe(0);
    expect(await platformAtivoCount(t)).toBe(0);

    await t.run(async (ctx) => {
      const before = await ctx.db.get(id);
      if (!before) throw new Error("missing before");
      await ctx.db.patch(id, { status: CONTRACT_STATUS.ATIVO });
      const after = await ctx.db.get(id);
      if (!after) throw new Error("missing after");
      await replaceContractAggregates(ctx, before, after);
    });

    expect(await platformAtivoCount(t)).toBe(1);
    expect(await ativoCountFor(t, agency)).toBe(1);
    expect(await platformInsuredSum(t)).toBe(500_00);
  });
});

describe("deleteContractAggregates", () => {
  test("removes the contract from every aggregate", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000000444");
    const id = await seedContract(
      t,
      { agencyId: agency, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 700_00 },
      "CTR-DEL1",
    );
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(id);
      if (!doc) throw new Error("seed lost");
      await insertContractAggregates(ctx, doc);
    });

    expect(await platformAtivoCount(t)).toBe(1);
    expect(await platformInsuredSum(t)).toBe(700_00);

    await t.run(async (ctx) => {
      const doc = await ctx.db.get(id);
      if (!doc) throw new Error("missing doc");
      await deleteContractAggregates(ctx, doc);
      await ctx.db.delete(id);
    });

    expect(await platformAtivoCount(t)).toBe(0);
    expect(await ativoCountFor(t, agency)).toBe(0);
    expect(await platformInsuredSum(t)).toBe(0);
  });
});
