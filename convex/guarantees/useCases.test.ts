// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import {
  registerContractAggregateComponents,
  seedAgencyWithMembership,
  seedDefaultProduct,
  seedGuaranteeWithLease,
  setupAuthenticatedUser,
  type SeededUserId,
  seedFreshCreditAssessment,
} from "../lib/testFixtures";
import { GUARANTEE_STATE } from "./domain";
import { DEFAULT_PRICING_TABLE, priceGuarantee, splitCommission } from "./pricing";
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

const ZERO_COUNTS = {
  drafted: 0,
  active: 0,
  in_arrears: 0,
  default_verified: 0,
  cover_committed: 0,
  in_eviction: 0,
  closed: 0,
} as const;

// rentCents 100_000 through the default product → 6x exit cap.
const EXIT_CAP = 600_000;

describe("getStatusCounts", () => {
  test("returns one key per guarantee state, scoped to the agency", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await seedGuaranteeWithLease(t, { agencyId, status: GUARANTEE_STATE.ACTIVE }, "A1");
    await seedGuaranteeWithLease(t, { agencyId, status: GUARANTEE_STATE.ACTIVE }, "A2");
    await seedGuaranteeWithLease(t, { agencyId, status: GUARANTEE_STATE.DRAFTED }, "A3");
    await seedGuaranteeWithLease(t, { agencyId, status: GUARANTEE_STATE.IN_ARREARS }, "A4");

    const counts = await asUser.query(api.guarantees.useCases.getStatusCounts, { agencyId });
    expect(counts).toEqual({ ...ZERO_COUNTS, active: 2, drafted: 1, in_arrears: 1 });
  });
});

describe("getStatusCountsGlobal", () => {
  test("returns platform totals that match the sum of per-agency counts", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyA = await seedAgencyWithMembership(t, userId);
    const agencyB = await seedSecondAgency(t, userId, "00000000000777");

    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: GUARANTEE_STATE.ACTIVE }, "G1");
    await seedGuaranteeWithLease(t, { agencyId: agencyB, status: GUARANTEE_STATE.ACTIVE }, "G2");
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyB, status: GUARANTEE_STATE.COVER_COMMITTED },
      "G3",
    );

    const a = await asUser.query(api.guarantees.useCases.getStatusCounts, { agencyId: agencyA });
    const b = await asUser.query(api.guarantees.useCases.getStatusCounts, { agencyId: agencyB });
    const platform = await asUser.query(api.guarantees.useCases.getStatusCountsGlobal, {});

    expect(platform).toEqual({
      drafted: a.drafted + b.drafted,
      active: a.active + b.active,
      in_arrears: a.in_arrears + b.in_arrears,
      default_verified: a.default_verified + b.default_verified,
      cover_committed: a.cover_committed + b.cover_committed,
      in_eviction: a.in_eviction + b.in_eviction,
      closed: a.closed + b.closed,
    });
    expect(platform.active).toBe(2);
    expect(platform.cover_committed).toBe(1);
  });
});

describe("getInsuredCapacityGlobal", () => {
  test("sums exposure (available capacity + exit cap) over every insured state, not drafts or closed", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, availableCents: 10_000 },
      "C1",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.IN_EVICTION, availableCents: 25_000 },
      "C2",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.DRAFTED, availableCents: 99_900 },
      "C3",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.CLOSED, availableCents: 99_900 },
      "C4",
    );

    const result = await asUser.query(api.guarantees.useCases.getInsuredCapacityGlobal, {});
    // Two insured: (10_000 + 25_000) + 2 x 600_000; draft and closed excluded.
    expect(result.sumInsuredCents).toBe(35_000 + 2 * EXIT_CAP);
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

  async function seedBoundSubject(t: ReturnType<typeof convexTest>, document: string) {
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await asUser.mutation(api.guarantees.useCases.openContractApplication, {
      agencyId,
      document,
      entityType: document.replace(/\D/g, "").length === 14 ? "pj" : "pf",
      propertyKind: "residential",
      cep: "01310-100",
      rentCents: 250_000,
    });
    return { asUser, agencyId };
  }

  test("scheduling a CPF makes the score readable via getCachedCreditScore after actions run", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, agencyId } = await seedBoundSubject(t, "12345678901");

    const req = await asUser.mutation(api.guarantees.useCases.requestCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(req.status).toBe("fetching");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const cached = await asUser.query(api.guarantees.useCases.getCachedCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(cached).not.toBeNull();
    expect(cached?.tier).toBeDefined();
  });

  test("returns cached status when a fresh assessment already exists", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, agencyId } = await seedBoundSubject(t, "12345678901");

    const first = await asUser.mutation(api.guarantees.useCases.requestCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(first.status).toBe("fetching");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const second = await asUser.mutation(api.guarantees.useCases.requestCreditScore, {
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

    const result = await asUser.mutation(api.guarantees.useCases.requestCreditScore, {
      agencyId,
      document: "123",
    });
    expect(result.status).toBe("invalid");
  });

  test("getCachedCreditScore refuses the cache once no application binds the agency to the subject", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, agencyId } = await seedBoundSubject(t, "12345678901");

    await asUser.mutation(api.guarantees.useCases.requestCreditScore, {
      agencyId,
      document: "12345678901",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const whileBound = await asUser.query(api.guarantees.useCases.getCachedCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(whileBound).not.toBeNull();

    // Drop the art. 15 declaration but keep the assessment. A cache read that
    // still answers would tell an unbound caller that this subject was pulled
    // and what it scored — the leak the precondition on the cache path closes.
    await t.run(async (ctx) => {
      const applications = await ctx.db.query("contractApplications").collect();
      for (const application of applications) await ctx.db.delete(application._id);
    });

    const whileUnbound = await asUser.query(api.guarantees.useCases.getCachedCreditScore, {
      agencyId,
      document: "12345678901",
    });
    expect(whileUnbound).toBeNull();
  });

  test("CNPJ (14-digit) also routes through creditAnalysis and yields a cached score", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, agencyId } = await seedBoundSubject(t, "12345678000190");

    const req = await asUser.mutation(api.guarantees.useCases.requestCreditScore, {
      agencyId,
      document: "12345678000190",
    });
    expect(req.status).toBe("fetching");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const cached = await asUser.query(api.guarantees.useCases.getCachedCreditScore, {
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
    const closedISOThisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15),
    ).toISOString();

    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, activatedAt: activatedISOThisMonth },
      "T1",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, activatedAt: activatedISOPrior },
      "T2",
    );
    await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: GUARANTEE_STATE.CLOSED,
        closeReason: "canceled_pre_activation",
        activatedAt: activatedISOPrior,
        closedAt: closedISOThisMonth,
      },
      "T3",
    );
    await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: GUARANTEE_STATE.CLOSED,
        closeReason: "end_of_lease",
        activatedAt: activatedISOPrior,
        closedAt: closedISOThisMonth,
      },
      "T4",
    );

    const buckets = await asUser.query(api.guarantees.useCases.getActivityByPeriod, {
      scope: { kind: "agency", agencyId },
      granularity: "month",
    });

    expect(buckets).toHaveLength(12);
    const last = buckets[buckets.length - 1];
    expect(last.period).toBe(thisMonth);
    expect(last.activated).toBe(1);
    expect(last.cancelled).toBe(1);
    expect(last.expired).toBe(1);
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

    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: GUARANTEE_STATE.ACTIVE, activatedAt: activatedISO },
      "P1",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyB, status: GUARANTEE_STATE.ACTIVE, activatedAt: activatedISO },
      "P2",
    );

    const buckets = await asUser.query(api.guarantees.useCases.getActivityByPeriod, {
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

    const buckets = await asUser.query(api.guarantees.useCases.getActivityByPeriod, {
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

describe("listByAgency / getGuaranteeTabCounts (urgency)", () => {
  const REFERENCE_DATE = "2026-07-18";
  const EXPIRING_10_DAYS = "2026-07-28";
  const CRITICAL_45_DAYS = "2026-09-01";
  const OK_200_DAYS = "2027-02-03";

  async function seedUrgencyBook(t: ReturnType<typeof convexTest>, agencyId: AgencyId) {
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, nextRenewalDate: EXPIRING_10_DAYS },
      "U1",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, nextRenewalDate: CRITICAL_45_DAYS },
      "U2",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, nextRenewalDate: OK_200_DAYS },
      "U3",
    );
    await seedGuaranteeWithLease(t, { agencyId, status: GUARANTEE_STATE.DRAFTED }, "U4");
    await seedGuaranteeWithLease(t, { agencyId, status: GUARANTEE_STATE.CLOSED }, "U5");
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.IN_ARREARS, nextRenewalDate: EXPIRING_10_DAYS },
      "U6",
    );
  }

  test("tab 'expiring' returns only the active rows inside [today, today+60], each carrying urgency", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedUrgencyBook(t, agencyId);

    const page = await asUser.query(api.guarantees.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
      tab: "expiring",
      referenceDate: REFERENCE_DATE,
    });

    const ids = new Set(page.page.map((row) => row.id));
    expect(ids).toEqual(new Set(["U1", "U2"]));
    for (const row of page.page) {
      expect(row.urgency).toBeDefined();
    }
  });

  test("a state tab returns only rows in that state", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedUrgencyBook(t, agencyId);

    const active = await asUser.query(api.guarantees.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
      tab: "active",
      referenceDate: REFERENCE_DATE,
    });
    expect(new Set(active.page.map((row) => row.id))).toEqual(new Set(["U1", "U2", "U3"]));
    for (const row of active.page) {
      expect(row.status).toBe(GUARANTEE_STATE.ACTIVE);
    }

    const inArrears = await asUser.query(api.guarantees.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
      tab: "in_arrears",
      referenceDate: REFERENCE_DATE,
    });
    expect(inArrears.page.map((row) => row.id)).toEqual(["U6"]);
    expect(inArrears.page[0].urgency).toBe("expiring");
  });

  test("tab undefined returns every guarantee", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedUrgencyBook(t, agencyId);

    const page = await asUser.query(api.guarantees.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
      referenceDate: REFERENCE_DATE,
    });

    expect(new Set(page.page.map((row) => row.id))).toEqual(
      new Set(["U1", "U2", "U3", "U4", "U5", "U6"]),
    );
  });

  test("a closed row projects availableCapacityCents = 0 while its capacity invariant stays intact", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedUrgencyBook(t, agencyId);

    const page = await asUser.query(api.guarantees.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
      referenceDate: REFERENCE_DATE,
    });
    const byId = new Map(page.page.map((row) => [row.id, row]));
    expect(byId.get("U5")?.status).toBe(GUARANTEE_STATE.CLOSED);
    expect(byId.get("U5")?.availableCapacityCents).toBe(0);
    // Default seed: R$ 1.000,00 rent x 30 = R$ 30.000,00 ceiling, untouched.
    expect(byId.get("U1")?.availableCapacityCents).toBe(3_000_000);
    expect(byId.get("U4")?.availableCapacityCents).toBe(3_000_000);

    const closedRow = await t.run((ctx) =>
      ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", "U5"))
        .unique(),
    );
    expect(closedRow?.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 3_000_000,
      reservedCents: 0,
    });
  });

  test("getGuaranteeTabCounts: expiring === 2 with one bucket per state", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedUrgencyBook(t, agencyId);

    const counts = await asUser.query(api.guarantees.useCases.getGuaranteeTabCounts, {
      agencyId,
      referenceDate: REFERENCE_DATE,
    });

    expect(counts).toEqual({
      ...ZERO_COUNTS,
      all: 6,
      expiring: 2,
      active: 3,
      in_arrears: 1,
      drafted: 1,
      closed: 1,
    });
  });
});

describe("create (lease + drafted guarantee)", () => {
  const VALID_CPF = "52998224725";
  const VALID_CNPJ = "11444777000161";

  function createArgs(overrides: object = {}) {
    return {
      lease: {
        propertyKind: "residential" as const,
        property: {
          cep: "01000000",
          streetAndNumber: "Rua Teste, 1",
          neighborhood: "Centro",
          cityUF: "São Paulo / SP",
          complement: "",
        },
        tag: "",
        description: "",
        rent: { rentCents: 300000, condoCents: 0, otherFeesCents: 0 },
      },
      plan: "basic" as const,
      tenant: {
        entityType: "pf" as const,
        fullName: "Maria Silva Santos",
        cpf: VALID_CPF,
        cnpj: undefined,
        birthDate: "1990-05-12",
        email: "maria@example.com",
        phone: "11900000001",
      },
      ...overrides,
    };
  }

  const PJ_TENANT = {
    entityType: "pj" as const,
    fullName: "Tech Solutions Ltda",
    cpf: VALID_CPF,
    cnpj: VALID_CNPJ,
    birthDate: "",
    email: "contato@techsolutions.example.com",
    phone: "11900000003",
  };

  async function setup(t: ReturnType<typeof convexTest>) {
    registerContractAggregateComponents(t);
    await seedDefaultProduct(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    return { asUser, agencyId };
  }

  test("writes a lease, a drafted guarantee with a terms snapshot from the product, and the lease pointer", async () => {
    const t = convexTest(schema);
    const { asUser, agencyId } = await setup(t);
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 750 });

    const result = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...createArgs(),
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const guarantee = await t.run((ctx) =>
      ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(guarantee).not.toBeNull();
    if (!guarantee) return;

    expect(guarantee.status).toBe("drafted");
    expect(guarantee.activatedAt).toBeNull();
    expect(guarantee.underwriting.score).toBe(750);
    expect(guarantee.underwriting.tier).toBe("regular");
    expect(guarantee.tenantApproval).toEqual({ status: "pendente", termApprovedAt: null });

    const product = await t.run((ctx) => ctx.db.get(guarantee.productId));
    expect(product?.slug).toBe("mutav-fianca");
    const expected = priceGuarantee(
      {
        rentCents: 300000,
        tier: "regular",
        plan: "basic",
        productSlug: "mutav-fianca",
        appliedAt: guarantee.terms.appliedAt,
      },
      DEFAULT_PRICING_TABLE,
    );
    expect(guarantee.terms).toEqual(expected.terms);
    expect(guarantee.capacity).toEqual(expected.capacity);
    expect(guarantee.capacity.availableCents + guarantee.capacity.reservedCents).toBe(
      guarantee.capacity.ceilingCents,
    );

    const lease = await t.run((ctx) => ctx.db.get(guarantee.leaseId));
    expect(lease).toMatchObject({
      agencyId,
      publicId: result.data.leasePublicId,
      propertyKind: "residential",
      rent: { rentCents: 300000, condoCents: 0, otherFeesCents: 0, totalRentCents: 300000 },
      payer: "tenant",
      openGuaranteeId: guarantee._id,
    });
    if (!lease) return;

    const tenant = await t.run((ctx) => ctx.db.get(lease.tenantId));
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
        .query("guaranteeHistory")
        .withIndex("by_guarantee", (q) => q.eq("guaranteePublicId", result.data.publicId))
        .collect(),
    );
    const creationEvent = history.find((h) => h.tenantSnapshot !== undefined);
    expect(creationEvent?.tenantSnapshot).toMatchObject({
      entityType: "pf",
      taxId: VALID_CPF,
      fullName: "Maria Silva Santos",
      email: "maria@example.com",
      phone: "11900000001",
    });

    const audit = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
    expect(audit.map((entry) => entry.action)).toEqual(["lease.created", "guarantee.created"]);
  });

  test("persists the chosen plan in the terms snapshot", async () => {
    const t = convexTest(schema);
    const { asUser, agencyId } = await setup(t);
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 750 });

    const result = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...createArgs({ plan: "plus" as const }),
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const guarantee = await t.run((ctx) =>
      ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(guarantee?.terms.plan).toBe("plus");
    expect(guarantee?.terms.prestamistaFeeCents).toBe(1_280);
  });

  test("rejects a non-positive rent before any write", async () => {
    const t = convexTest(schema);
    const { asUser, agencyId } = await setup(t);

    const args = createArgs();
    const result = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...args,
      lease: { ...args.lease, rent: { rentCents: 0, condoCents: 0, otherFeesCents: 0 } },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_RENT");

    expect(await t.run((ctx) => ctx.db.query("guarantees").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("leases").collect())).toHaveLength(0);
  });

  test("rejects a denied credit tier (negado) before any write", async () => {
    const t = convexTest(schema);
    const { asUser, agencyId } = await setup(t);
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 200 });

    const result = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...createArgs(),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("TENANT_DENIED");

    expect(await t.run((ctx) => ctx.db.query("guarantees").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("leases").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("tenants").collect())).toHaveLength(0);
  });

  test("refuses when no enabled default product exists", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 750 });

    const result = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...createArgs(),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(await t.run((ctx) => ctx.db.query("leases").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("tenants").collect())).toHaveLength(0);
  });

  test("getByPublicId round-trips both tenant variants, joins the lease, and listByAgency joins the tenant name", async () => {
    const t = convexTest(schema);
    const { asUser, agencyId } = await setup(t);
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 750 });
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CNPJ, score: 650 });

    const pf = await asUser.mutation(api.guarantees.useCases.create, { agencyId, ...createArgs() });
    expect(pf.success).toBe(true);
    if (!pf.success) return;

    const pj = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...createArgs({ tenant: PJ_TENANT }),
    });
    expect(pj.success).toBe(true);
    if (!pj.success) return;

    const pfGuarantee = await asUser.query(api.guarantees.useCases.getByPublicId, {
      publicId: pf.data.publicId,
    });
    expect(pfGuarantee?.tenant).toMatchObject({
      entityType: "pf",
      taxId: VALID_CPF,
      birthDate: "1990-05-12",
      approvalStatus: "pendente",
    });
    expect(pfGuarantee?.lease).toMatchObject({
      id: pf.data.leasePublicId,
      propertyKind: "residential",
      rent: { rentCents: 300000, totalRentCents: 300000 },
    });
    expect(pfGuarantee?.terms.productSlug).toBe("mutav-fianca");
    expect(pfGuarantee?.status).toBe("drafted");

    const pjGuarantee = await asUser.query(api.guarantees.useCases.getByPublicId, {
      publicId: pj.data.publicId,
    });
    expect(pjGuarantee?.tenant).toMatchObject({
      entityType: "pj",
      taxId: VALID_CNPJ,
      contactCpf: VALID_CPF,
    });
    expect(pjGuarantee?.tenant).not.toHaveProperty("birthDate");

    const page = await asUser.query(api.guarantees.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const names = new Set(page.page.map((row) => row.tenantName));
    expect(names.has("Maria Silva Santos")).toBe(true);
    expect(names.has("Tech Solutions Ltda")).toBe(true);
  });

  test("second create with the same CPF reuses the registry row but opens its own lease", async () => {
    const t = convexTest(schema);
    const { asUser, agencyId } = await setup(t);
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 750 });

    const first = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...createArgs(),
    });
    const second = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...createArgs(),
    });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const tenants = await t.run((ctx) => ctx.db.query("tenants").collect());
    expect(tenants).toHaveLength(1);

    const leases = await t.run((ctx) => ctx.db.query("leases").collect());
    expect(leases).toHaveLength(2);
    expect(leases[0].tenantId).toBe(tenants[0]._id);
    expect(leases[1].tenantId).toBe(tenants[0]._id);

    const guarantees = await t.run((ctx) => ctx.db.query("guarantees").collect());
    expect(guarantees).toHaveLength(2);
    expect(new Set(guarantees.map((g) => g.leaseId))).toEqual(
      new Set(leases.map((lease) => lease._id)),
    );
  });

  test("pj create resolves the registry row from the CNPJ", async () => {
    const t = convexTest(schema);
    const { asUser, agencyId } = await setup(t);
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 750 });
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CNPJ, score: 650 });

    const result = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      ...createArgs({ tenant: PJ_TENANT }),
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
    const { asUser, agencyId } = await setup(t);

    const result = await asUser.mutation(api.guarantees.useCases.create, {
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
        },
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_TAX_ID");

    expect(await t.run((ctx) => ctx.db.query("guarantees").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("leases").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("tenants").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("mutavAuditLog").collect())).toHaveLength(0);
  });
});

describe("cancelDraft", () => {
  test("closes a draft with canceled_pre_activation and releases the lease pointer", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.DRAFTED },
      "D1",
    );

    const result = await asUser.mutation(api.guarantees.useCases.cancelDraft, {
      agencyId,
      publicId: "D1",
    });
    expect(result).toMatchObject({ success: true, data: { canceled: true } });

    const guarantee = await t.run((ctx) => ctx.db.get(guaranteeId));
    expect(guarantee?.status).toBe("closed");
    expect(guarantee?.closure?.reason).toBe("canceled_pre_activation");
    expect(guarantee?.closure?.closedAt).toBeDefined();

    const lease = await t.run((ctx) => ctx.db.get(leaseId));
    expect(lease?.openGuaranteeId).toBeNull();

    const counts = await asUser.query(api.guarantees.useCases.getStatusCounts, { agencyId });
    expect(counts).toEqual({ ...ZERO_COUNTS, closed: 1 });

    const audit = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
    expect(audit.map((entry) => entry.action)).toEqual(["guarantee.transitioned"]);
  });

  test("refuses to cancel a guarantee that is no longer a draft", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE },
      "D2",
    );

    const result = await asUser.mutation(api.guarantees.useCases.cancelDraft, {
      agencyId,
      publicId: "D2",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOT_DRAFTED");

    expect((await t.run((ctx) => ctx.db.get(guaranteeId)))?.status).toBe("active");
    expect((await t.run((ctx) => ctx.db.get(leaseId)))?.openGuaranteeId).toBe(guaranteeId);
  });

  test("returns NOT_FOUND for another agency's draft without revealing it", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const mine = await seedAgencyWithMembership(t, userId);
    const theirs = await seedSecondAgency(t, userId, "00000000000999");
    await seedGuaranteeWithLease(t, { agencyId: theirs, status: GUARANTEE_STATE.DRAFTED }, "D3");

    const result = await asUser.mutation(api.guarantees.useCases.cancelDraft, {
      agencyId: mine,
      publicId: "D3",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOT_FOUND");

    const theirCounts = await asUser.query(api.guarantees.useCases.getStatusCounts, {
      agencyId: theirs,
    });
    expect(theirCounts.drafted).toBe(1);
  });
});

describe("listForCommissionByMonth", () => {
  test("returns commissionCents from the stored terms split at the product's rates for each in-force guarantee", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const periodMonth = "2026-01";
    const activatedAt = "2026-01-10T12:00:00.000Z";

    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, activatedAt, rentCents: 300_000, plan: "basic" },
      "guarantee-basic",
    );
    await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: GUARANTEE_STATE.IN_ARREARS,
        activatedAt,
        rentCents: 500_000,
        plan: "plus",
      },
      "guarantee-plus",
    );
    await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: GUARANTEE_STATE.CLOSED,
        activatedAt: "2025-01-10T12:00:00.000Z",
        closedAt: "2025-12-01T00:00:00.000Z",
        rentCents: 400_000,
      },
      "guarantee-closed-before",
    );

    const rows = await asUser.query(api.guarantees.useCases.listForCommissionByMonth, {
      agencyId,
      periodMonth,
    });

    expect(rows).toHaveLength(2);

    const seededList = await t.run((ctx) => ctx.db.query("guarantees").collect());
    const seededByPublicId = new Map(seededList.map((g) => [g.publicId, g]));

    for (const row of rows) {
      const seeded = seededByPublicId.get(row.guaranteeId);
      if (!seeded) throw new Error(`missing seed for ${row.guaranteeId}`);
      expect(row.commissionCents).toBe(splitCommission(seeded.terms).commissionCents);
      expect(row.rentCents).toBe(seeded.terms.rentCents);
    }

    const basicRow = rows.find((r) => r.guaranteeId === "guarantee-basic");
    const plusRow = rows.find((r) => r.guaranteeId === "guarantee-plus");
    if (!basicRow || !plusRow) throw new Error("expected both rows present");
    // basic: taxa 27_000 x 1.5% = 405. plus: taxa 45_000 x 1.5% = 675 + 1_280 x 25% = 320.
    expect(basicRow.commissionCents).toBe(405);
    expect(plusRow.commissionCents).toBe(995);
    expect(basicRow.installment).toBe("1/12");
  });
});
