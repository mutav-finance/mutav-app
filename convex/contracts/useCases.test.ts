// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import {
  registerContractAggregateComponents,
  seedAgencyWithMembership,
  setupAuthenticatedUser,
  type SeededUserId,
} from "../lib/testFixtures";
import { insertContractAggregates } from "./aggregateWrites";
import { CONTRACT_STATUS, type ContractStatus } from "./domain";
import schema from "../schema";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

async function seedSecondAgency(
  t: ReturnType<typeof convexTest>,
  userId: SeededUserId,
  cnpj: string,
): Promise<AgencyId> {
  return t.run(async (ctx) => {
    const agencyId = await ctx.db.insert("agencies", {
      name: `Test Agency ${cnpj}`,
      cnpj,
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    });
    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: "owner",
      joinedAt: new Date().toISOString(),
    });
    return agencyId;
  });
}

type ContractSeed = {
  agencyId: AgencyId;
  status: ContractStatus;
  availableGuaranteeCents: number;
  activatedAt?: string | null;
  deactivatedAt?: string | null;
};

async function seedAndIndexContract(
  t: ReturnType<typeof convexTest>,
  spec: ContractSeed,
  publicId: string,
) {
  await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      entityType: "pf",
      taxId: "11144477735",
      fullName: "Test Tenant",
      birthDate: "1990-01-01",
      email: "tenant@test.br",
      phone: "11999999999",
    });
    const id = await ctx.db.insert("contracts", {
      agencyId: spec.agencyId,
      publicId,
      tenantId,
      tenantApproval: { status: "pendente", termApprovedAt: null },
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
    });
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("seed lost");
    await insertContractAggregates(ctx, doc);
  });
}

describe("getStatusCounts", () => {
  test("returns per-agency status counts", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_00 },
      "A1",
    );
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 200_00 },
      "A2",
    );
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.PENDENTE, availableGuaranteeCents: 50_00 },
      "A3",
    );

    const counts = await asUser.query(api.contracts.useCases.getStatusCounts, { agencyId });
    expect(counts).toEqual({ ativo: 2, pendente: 1, encerrado: 0, cancelado: 0 });
  });
});

describe("getStatusCountsGlobal", () => {
  test("returns platform totals that match the sum of per-agency counts", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyA = await seedAgencyWithMembership(t, userId);
    const agencyB = await seedSecondAgency(t, userId, "00000000000777");

    await seedAndIndexContract(
      t,
      { agencyId: agencyA, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_00 },
      "G1",
    );
    await seedAndIndexContract(
      t,
      { agencyId: agencyB, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 200_00 },
      "G2",
    );
    await seedAndIndexContract(
      t,
      { agencyId: agencyB, status: CONTRACT_STATUS.PENDENTE, availableGuaranteeCents: 50_00 },
      "G3",
    );

    const a = await asUser.query(api.contracts.useCases.getStatusCounts, { agencyId: agencyA });
    const b = await asUser.query(api.contracts.useCases.getStatusCounts, { agencyId: agencyB });
    const platform = await asUser.query(api.contracts.useCases.getStatusCountsGlobal, {});

    expect(platform).toEqual({
      ativo: a.ativo + b.ativo,
      pendente: a.pendente + b.pendente,
      encerrado: a.encerrado + b.encerrado,
      cancelado: a.cancelado + b.cancelado,
    });
  });
});

describe("getInsuredCapacityGlobal", () => {
  test("sums availableGuaranteeCents over ativo contracts only", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 100_00 },
      "C1",
    );
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.ATIVO, availableGuaranteeCents: 250_00 },
      "C2",
    );
    await seedAndIndexContract(
      t,
      { agencyId, status: CONTRACT_STATUS.PENDENTE, availableGuaranteeCents: 999_00 },
      "C3",
    );

    const result = await asUser.query(api.contracts.useCases.getInsuredCapacityGlobal, {});
    expect(result.sumInsuredCents).toBe(350_00);
    expect(result.maxCapacityCents).toBeGreaterThan(0);
  });
});

describe("requestCreditScore / getCachedCreditScore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("scheduling a CPF makes the score readable via getCachedCreditScore after actions run", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const req = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(req.status).toBe("fetching");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const cached = await asUser.query(api.contracts.useCases.getCachedCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(cached).not.toBeNull();
    expect(cached?.tier).toBeDefined();
  });

  test("returns cached status when a fresh assessment already exists", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const first = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(first.status).toBe("fetching");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const second = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(second.status).toBe("cached");
  });

  test("returns invalid for a malformed document string", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const result = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: "123",
    });
    expect(result.status).toBe("invalid");
  });

  test("CNPJ (14-digit) also routes through creditAnalysis and yields a cached score", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const req = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: "12345678000190",
    });
    expect(req.status).toBe("fetching");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const cached = await asUser.query(api.contracts.useCases.getCachedCreditScore, {
      agencyId,
      document: "12345678000190",
    });
    expect(cached).not.toBeNull();
    expect(cached?.score).toBeGreaterThan(0);
  });
});

describe("getActivityByPeriod", () => {
  test("agency scope, monthly granularity — buckets activated/cancelled/expired/netActive", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const activatedISOThisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5),
    ).toISOString();
    const activatedISOPrior = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1),
    ).toISOString();
    const deactivatedISOThisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15),
    ).toISOString();

    await seedAndIndexContract(
      t,
      {
        agencyId,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 1,
        activatedAt: activatedISOThisMonth,
      },
      "T1",
    );
    await seedAndIndexContract(
      t,
      {
        agencyId,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 1,
        activatedAt: activatedISOPrior,
      },
      "T2",
    );
    await seedAndIndexContract(
      t,
      {
        agencyId,
        status: CONTRACT_STATUS.CANCELADO,
        availableGuaranteeCents: 1,
        activatedAt: activatedISOPrior,
        deactivatedAt: deactivatedISOThisMonth,
      },
      "T3",
    );

    const buckets = await asUser.query(api.contracts.useCases.getActivityByPeriod, {
      scope: { kind: "agency", agencyId },
      granularity: "month",
    });

    expect(buckets).toHaveLength(12);
    const last = buckets[buckets.length - 1];
    expect(last.period).toBe(thisMonth);
    expect(last.activated).toBe(1);
    expect(last.cancelled).toBe(1);
    expect(last.expired).toBe(0);
    expect(last.netActive).toBe(2);
  });

  test("platform scope aggregates across agencies", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyA = await seedAgencyWithMembership(t, userId);
    const agencyB = await seedSecondAgency(t, userId, "00000000000888");

    const now = new Date();
    const activatedISO = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2),
    ).toISOString();

    await seedAndIndexContract(
      t,
      {
        agencyId: agencyA,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 1,
        activatedAt: activatedISO,
      },
      "P1",
    );
    await seedAndIndexContract(
      t,
      {
        agencyId: agencyB,
        status: CONTRACT_STATUS.ATIVO,
        availableGuaranteeCents: 1,
        activatedAt: activatedISO,
      },
      "P2",
    );

    const buckets = await asUser.query(api.contracts.useCases.getActivityByPeriod, {
      scope: { kind: "platform" },
      granularity: "month",
    });
    expect(buckets).toHaveLength(12);
    const last = buckets[buckets.length - 1];
    expect(last.activated).toBe(2);
    expect(last.netActive).toBe(2);
  });

  test("weekly granularity returns 52 buckets with ISO Monday period keys", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const buckets = await asUser.query(api.contracts.useCases.getActivityByPeriod, {
      scope: { kind: "agency", agencyId },
      granularity: "week",
    });

    expect(buckets).toHaveLength(52);
    for (const bucket of buckets) {
      expect(bucket.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const [year, month, day] = bucket.period.split("-").map(Number);
      const d = new Date(Date.UTC(year, month - 1, day));
      expect(d.getUTCDay()).toBe(1);
    }
  });
});

describe("create (tenant registry, narrow phase)", () => {
  const VALID_CPF = "52998224725";
  const VALID_CNPJ = "11444777000161";

  function createArgs(tenantOverrides: Record<string, never> | object = {}) {
    return {
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo / SP",
      },
      optional: { complement: "", tag: "", description: "" },
      propertyKind: "residencial" as const,
      rentCents: 300000,
      condoCents: 0,
      otherFeesCents: 0,
      tenant: {
        entityType: "pf" as const,
        fullName: "Maria Silva Santos",
        cpf: VALID_CPF,
        cnpj: undefined,
        birthDate: "1990-05-12",
        email: "maria@example.com",
        phone: "11900000001",
        score: 750,
      },
      ...tenantOverrides,
    };
  }

  test("registry-only: no embedded tenant/tenantCpf, top-level score, tenantId links a matching registry row", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const result = await asUser.mutation(api.contracts.useCases.create, {
      agencyId,
      ...createArgs(),
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const contract = await t.run((ctx) =>
      ctx.db
        .query("contracts")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(contract).not.toBeNull();
    if (!contract) return;

    const keys = Object.keys(contract);
    expect(keys).not.toContain("tenant");
    expect(keys).not.toContain("tenantCpf");
    expect(contract.score).toBe(750);
    expect(contract.tenantApproval).toEqual({ status: "pendente", termApprovedAt: null });

    const tenant = await t.run((ctx) => ctx.db.get(contract.tenantId));
    expect(tenant).toMatchObject({
      entityType: "pf",
      taxId: VALID_CPF,
      fullName: "Maria Silva Santos",
      birthDate: "1990-05-12",
      email: "maria@example.com",
      phone: "11900000001",
    });

    const history = await t.run((ctx) =>
      ctx.db
        .query("contractHistory")
        .withIndex("by_contract", (q) => q.eq("contractPublicId", result.data.publicId))
        .collect(),
    );
    const creationEvent = history.find((h) => h.message === "Contrato criado");
    expect(creationEvent?.tenantSnapshot).toMatchObject({
      entityType: "pf",
      taxId: VALID_CPF,
      fullName: "Maria Silva Santos",
      email: "maria@example.com",
      phone: "11900000001",
    });
  });

  test("getByPublicId round-trips both variants and listByAgency joins the tenant name", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const pf = await asUser.mutation(api.contracts.useCases.create, { agencyId, ...createArgs() });
    expect(pf.success).toBe(true);
    if (!pf.success) return;

    const pjArgs = createArgs({
      tenant: {
        entityType: "pj" as const,
        fullName: "Tech Solutions Ltda",
        cpf: VALID_CPF,
        cnpj: VALID_CNPJ,
        birthDate: "",
        email: "contato@techsolutions.example.com",
        phone: "11900000003",
        score: 650,
      },
    });
    const pj = await asUser.mutation(api.contracts.useCases.create, { agencyId, ...pjArgs });
    expect(pj.success).toBe(true);
    if (!pj.success) return;

    const pfContract = await asUser.query(api.contracts.useCases.getByPublicId, {
      publicId: pf.data.publicId,
    });
    expect(pfContract?.tenant).toMatchObject({
      entityType: "pf",
      taxId: VALID_CPF,
      birthDate: "1990-05-12",
      approvalStatus: "pendente",
    });

    const pjContract = await asUser.query(api.contracts.useCases.getByPublicId, {
      publicId: pj.data.publicId,
    });
    expect(pjContract?.tenant).toMatchObject({
      entityType: "pj",
      taxId: VALID_CNPJ,
      contactCpf: VALID_CPF,
    });
    expect(pjContract?.tenant).not.toHaveProperty("birthDate");

    const page = await asUser.query(api.contracts.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const names = new Set(page.page.map((row) => row.tenantName));
    expect(names.has("Maria Silva Santos")).toBe(true);
    expect(names.has("Tech Solutions Ltda")).toBe(true);
  });

  test("second create with the same CPF reuses the same registry row", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const first = await asUser.mutation(api.contracts.useCases.create, {
      agencyId,
      ...createArgs(),
    });
    const second = await asUser.mutation(api.contracts.useCases.create, {
      agencyId,
      ...createArgs(),
    });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const tenants = await t.run((ctx) => ctx.db.query("tenants").collect());
    expect(tenants).toHaveLength(1);

    const contracts = await t.run((ctx) => ctx.db.query("contracts").collect());
    expect(contracts).toHaveLength(2);
    expect(contracts[0].tenantId).toBe(tenants[0]._id);
    expect(contracts[1].tenantId).toBe(tenants[0]._id);
  });

  test("pj create resolves the registry row from the CNPJ", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const result = await asUser.mutation(api.contracts.useCases.create, {
      agencyId,
      ...createArgs({
        tenant: {
          entityType: "pj" as const,
          fullName: "Tech Solutions Ltda",
          cpf: VALID_CPF,
          cnpj: VALID_CNPJ,
          birthDate: "",
          email: "contato@techsolutions.example.com",
          phone: "11900000003",
          score: 650,
        },
      }),
    });
    expect(result.success).toBe(true);

    const tenants = await t.run((ctx) => ctx.db.query("tenants").collect());
    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({
      entityType: "pj",
      taxId: VALID_CNPJ,
      contactCpf: VALID_CPF,
    });
  });

  test("checksum-invalid CPF returns an error Result and writes nothing", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const result = await asUser.mutation(api.contracts.useCases.create, {
      agencyId,
      ...createArgs({
        tenant: {
          entityType: "pf" as const,
          fullName: "Maria Silva Santos",
          cpf: "11111111111",
          cnpj: undefined,
          birthDate: "1990-05-12",
          email: "maria@example.com",
          phone: "11900000001",
          score: 750,
        },
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_TAX_ID");

    const contracts = await t.run((ctx) => ctx.db.query("contracts").collect());
    const tenants = await t.run((ctx) => ctx.db.query("tenants").collect());
    const audit = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
    expect(contracts).toHaveLength(0);
    expect(tenants).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });
});
