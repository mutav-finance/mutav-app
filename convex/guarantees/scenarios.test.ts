// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import { assertLeaseAcceptsGuarantee, type Lease, type LeaseId } from "../leases/domain";
import {
  registerContractAggregateComponents,
  seedDefaultProduct,
  seedGuaranteeWithLease,
} from "../lib/testFixtures";
import type { Result } from "../lib/result";
import type { Product, ProductId } from "../products/domain";
import schema from "../schema";
import type { TenantId } from "../tenants/domain";
import {
  assertClose,
  assertTransition,
  CLOSE_REASONS,
  GUARANTEE_STATES,
  INSURED_STATES,
  type CloseReason,
  type Guarantee,
  type GuaranteeCapacity,
  type GuaranteeId,
  type GuaranteeState,
  type GuaranteeTerms,
} from "./domain";

function setup() {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  return t;
}

type Harness = TestConvex<typeof schema>;

const AT = "2026-01-01T00:00:00.000Z";
const CLOSED_AT = "2026-06-01T00:00:00.000Z";

const BASIC_BOM_TERMS: GuaranteeTerms = {
  productSlug: "mutav-fianca",
  plan: "basic",
  rentCents: 100_000,
  feeCents: 9_000,
  taxaFeeCents: 9_000,
  prestamistaFeeCents: 0,
  oneTimeActivationFeeCents: 15_000,
  commissionRate: 0.015,
  prestamistaCommissionRate: 0.25,
  coverageCeilingMultiplier: 30,
  exitCostMultiplier: 6,
  coverageCeilingCents: 3_000_000,
  exitCostCapCents: 600_000,
  appliedAt: AT,
};

const FULL_CAPACITY: GuaranteeCapacity = {
  ceilingCents: 3_000_000,
  availableCents: 3_000_000,
  reservedCents: 0,
};

const PENDING_DOCUMENTS: Guarantee["documents"] = [
  { key: "rentalContract", status: "pendente" },
  { key: "inspection", status: "pendente" },
  { key: "policy", status: "pendente" },
];

const ALL_STATES = [
  "drafted",
  "active",
  "in_arrears",
  "default_verified",
  "cover_committed",
  "in_eviction",
  "closed",
] as const;

const ALL_CLOSE_REASONS = [
  "end_of_lease",
  "rescission",
  "abandonment",
  "eviction",
  "dispute_reversal",
  "canceled_pre_activation",
  "death",
] as const;

async function seedAgency(t: Harness, name: string, cnpj: string): Promise<AgencyId> {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name,
      cnpj,
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: AT,
    }),
  );
}

async function insertTenantRow(ctx: MutationCtx): Promise<TenantId> {
  return ctx.db.insert("tenants", {
    entityType: "pf",
    taxId: "11144477735",
    fullName: "Test Tenant",
    birthDate: "1990-01-01",
    email: "tenant@test.br",
    phone: "11999999999",
  });
}

async function insertLeaseRow(
  ctx: MutationCtx,
  { agencyId, tenantId, publicId }: { agencyId: AgencyId; tenantId: TenantId; publicId: string },
): Promise<LeaseId> {
  return ctx.db.insert("leases", {
    agencyId,
    publicId,
    tenantId,
    propertyKind: "residential",
    property: {
      cep: "01000000",
      streetAndNumber: "Rua Teste, 1",
      neighborhood: "Centro",
      cityUF: "São Paulo/SP",
      complement: "",
    },
    tag: "",
    description: "",
    rent: { rentCents: 100_000, condoCents: 0, otherFeesCents: 0, totalRentCents: 100_000 },
    payer: "tenant",
    openGuaranteeId: null,
  });
}

type RawGuaranteeSpec = {
  agencyId: AgencyId;
  leaseId: LeaseId;
  productId: ProductId;
  publicId: string;
  status: GuaranteeState;
  closure?: { reason: CloseReason; closedAt: string; note?: string };
  nextRenewalDate?: string;
  activatedAt?: string | null;
};

// Deliberately never patches the lease pointer: tests do it explicitly so the
// one-open-per-lease invariant stays visible at the call site.
async function insertGuaranteeRow(ctx: MutationCtx, spec: RawGuaranteeSpec): Promise<GuaranteeId> {
  return ctx.db.insert("guarantees", {
    agencyId: spec.agencyId,
    leaseId: spec.leaseId,
    publicId: spec.publicId,
    productId: spec.productId,
    status: spec.status,
    ...(spec.closure ? { closure: spec.closure } : {}),
    activatedAt: spec.activatedAt ?? null,
    nextRenewalDate: spec.nextRenewalDate ?? "2026-12-31",
    underwriting: { score: 750, tier: "bom" },
    tenantApproval: { status: "pendente", termApprovedAt: null },
    terms: { ...BASIC_BOM_TERMS },
    capacity: { ...FULL_CAPACITY },
    documents: [...PENDING_DOCUMENTS],
  });
}

async function closeGuaranteeRow(
  ctx: MutationCtx,
  {
    guaranteeId,
    leaseId,
    reason,
    closedAt = CLOSED_AT,
  }: { guaranteeId: GuaranteeId; leaseId: LeaseId; reason: CloseReason; closedAt?: string },
): Promise<void> {
  await ctx.db.patch(guaranteeId, { status: "closed", closure: { reason, closedAt } });
  await ctx.db.patch(leaseId, { openGuaranteeId: null });
}

async function insertProductRow(
  ctx: MutationCtx,
  { slug, enabled, isDefault }: { slug: string; enabled: boolean; isDefault: boolean },
): Promise<ProductId> {
  return ctx.db.insert("products", {
    slug,
    name: slug,
    enabled,
    isDefault,
    effectiveFrom: AT,
    terms: {
      tierRate: { bom: 0.1, regular: 0.13, ruim: 0.16 },
      coverageCeilingMultiplier: 24,
      exitCostMultiplier: 6,
      activationFeeCents: 20_000,
      commissionRate: 0.02,
      prestamistaPremiumCents: 1_500,
      prestamistaCommissionRate: 0.3,
    },
    eligibility: { agencyIds: null, regionUFs: null, minTier: null, propertyKinds: null },
  });
}

async function getGuarantee(ctx: MutationCtx, id: GuaranteeId): Promise<Guarantee> {
  const row = await ctx.db.get(id);
  if (!row) throw new Error(`guarantee ${id} not found`);
  return row;
}

async function getLease(ctx: MutationCtx, id: LeaseId): Promise<Lease> {
  const row = await ctx.db.get(id);
  if (!row) throw new Error(`lease ${id} not found`);
  return row;
}

async function getProduct(ctx: MutationCtx, id: ProductId): Promise<Product> {
  const row = await ctx.db.get(id);
  if (!row) throw new Error(`product ${id} not found`);
  return row;
}

function errorOf<E>(result: Result<unknown, E>): E {
  if (result.success) throw new Error("expected a failed Result");
  return result.error;
}

function dataOf<D>(result: Result<D, unknown>): D {
  if (!result.success) throw new Error("expected a successful Result");
  return result.data;
}

function publicIds(rows: { publicId: string }[]): string[] {
  return rows.map((r) => r.publicId).sort();
}

// One guarantee per state, each on its own lease; open ones get the pointer.
async function seedOneGuaranteePerState(t: Harness, agencyId: AgencyId): Promise<void> {
  const productId = await seedDefaultProduct(t);
  await t.run(async (ctx) => {
    const tenantId = await insertTenantRow(ctx);
    for (const state of ALL_STATES) {
      const leaseId = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: `LSE-${state}` });
      const guaranteeId = await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId,
        productId,
        publicId: state,
        status: state,
        ...(state === "closed"
          ? { closure: { reason: "end_of_lease" as const, closedAt: CLOSED_AT } }
          : {}),
      });
      if (state !== "closed") await ctx.db.patch(leaseId, { openGuaranteeId: guaranteeId });
    }
  });
}

describe("schema conformance — guarantees table", () => {
  test("declares the seven guarantee states in lockstep with GUARANTEE_STATES", () => {
    const declared = schema.tables.guarantees.validator.fields.status.members.map((m) => m.value);

    expect(declared).toEqual([
      "drafted",
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
      "closed",
    ]);
    expect([...GUARANTEE_STATES]).toEqual([
      "drafted",
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
      "closed",
    ]);
  });

  test.each(ALL_STATES)(
    "round-trips every guarantee state literal through insert and get",
    async (state) => {
      const t = setup();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const productId = await seedDefaultProduct(t);

      const result = await t.run(async (ctx) => {
        const tenantId = await insertTenantRow(ctx);
        const leaseId = await insertLeaseRow(ctx, {
          agencyId,
          tenantId,
          publicId: `LSE-${state}`,
        });
        const guaranteeId = await insertGuaranteeRow(ctx, {
          agencyId,
          leaseId,
          productId,
          publicId: state,
          status: state,
          ...(state === "closed"
            ? { closure: { reason: "end_of_lease" as const, closedAt: CLOSED_AT } }
            : {}),
        });
        const doc = await getGuarantee(ctx, guaranteeId);
        return { status: doc.status, hasClosure: doc.closure !== undefined };
      });

      expect(result.status).toBe(state);
      expect(result.hasClosure).toBe(state === "closed");
    },
  );

  test("declares the seven close reasons in lockstep with CLOSE_REASONS", () => {
    const declared = schema.tables.guarantees.validator.fields.closure.fields.reason.members.map(
      (m) => m.value,
    );

    expect(declared).toEqual([
      "end_of_lease",
      "rescission",
      "abandonment",
      "eviction",
      "dispute_reversal",
      "canceled_pre_activation",
      "death",
    ]);
    expect([...CLOSE_REASONS]).toEqual([
      "end_of_lease",
      "rescission",
      "abandonment",
      "eviction",
      "dispute_reversal",
      "canceled_pre_activation",
      "death",
    ]);
  });

  test.each(ALL_CLOSE_REASONS)(
    "round-trips every close reason inside closure on a closed row",
    async (reason) => {
      const t = setup();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const productId = await seedDefaultProduct(t);

      const closure = await t.run(async (ctx) => {
        const tenantId = await insertTenantRow(ctx);
        const leaseId = await insertLeaseRow(ctx, {
          agencyId,
          tenantId,
          publicId: `LSE-${reason}`,
        });
        const guaranteeId = await insertGuaranteeRow(ctx, {
          agencyId,
          leaseId,
          productId,
          publicId: reason,
          status: "closed",
          closure: { reason, closedAt: CLOSED_AT, note: "scenario" },
        });
        const doc = await getGuarantee(ctx, guaranteeId);
        return doc.closure;
      });

      expect(closure).toEqual({
        reason,
        closedAt: "2026-06-01T00:00:00.000Z",
        note: "scenario",
      });
    },
  );

  test("declares exactly the six guarantee indexes with their field lists", () => {
    const indexes = schema.tables.guarantees[" indexes"]();

    expect(indexes).toEqual([
      { indexDescriptor: "by_publicId", fields: ["publicId"] },
      { indexDescriptor: "by_status", fields: ["status"] },
      { indexDescriptor: "by_agency_status", fields: ["agencyId", "status"] },
      {
        indexDescriptor: "by_agency_status_nextRenewalDate",
        fields: ["agencyId", "status", "nextRenewalDate"],
      },
      { indexDescriptor: "by_lease", fields: ["leaseId"] },
      { indexDescriptor: "by_product", fields: ["productId"] },
    ]);
  });

  test("round-trips tenantApproval and document status literals through a partial patch", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(t, { agencyId, status: "drafted" }, "S6");

    const row = await t.run(async (ctx) => {
      await ctx.db.patch(guaranteeId, {
        documents: [
          { key: "rentalContract", status: "aprovado" },
          { key: "inspection", status: "enviado" },
          { key: "policy", status: "pendente" },
        ],
        tenantApproval: { status: "aprovado", termApprovedAt: "2026-02-01T00:00:00.000Z" },
      });
      return getGuarantee(ctx, guaranteeId);
    });

    expect(row.documents).toEqual([
      { key: "rentalContract", status: "aprovado" },
      { key: "inspection", status: "enviado" },
      { key: "policy", status: "pendente" },
    ]);
    expect(row.tenantApproval).toEqual({
      status: "aprovado",
      termApprovedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(row.status).toBe("drafted");
    expect(row.activatedAt).toBe(null);
  });
});

describe("pricing snapshot — terms and capacity as persisted", () => {
  test("stores the default-product snapshot as literal terms for rent 100_000 / bom / basic", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, productId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "drafted" },
      "P1",
    );

    const row = await t.run((ctx) => getGuarantee(ctx, guaranteeId));

    expect(row.terms).toEqual({
      productSlug: "mutav-fianca",
      plan: "basic",
      rentCents: 100_000,
      feeCents: 9_000,
      taxaFeeCents: 9_000,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaCommissionRate: 0.25,
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      coverageCeilingCents: 3_000_000,
      exitCostCapCents: 600_000,
      appliedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(row.productId).toBe(productId);
    expect(row.underwriting).toEqual({ score: 750, tier: "bom" });
    expect(row.status).toBe("drafted");
    expect(row.activatedAt).toBe(null);
    expect(row.nextRenewalDate).toBe("2026-12-31");
  });

  test("persists the plus plan with the prestamista premium folded into feeCents and capacity unmoved", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "drafted", plan: "plus" },
      "P2",
    );

    const row = await t.run((ctx) => getGuarantee(ctx, guaranteeId));

    expect(row.terms.plan).toBe("plus");
    expect(row.terms.taxaFeeCents).toBe(9_000);
    expect(row.terms.prestamistaFeeCents).toBe(1_280);
    expect(row.terms.feeCents).toBe(10_280);
    expect(row.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 3_000_000,
      reservedCents: 0,
    });
  });

  test("opens capacity fully available: available + reserved = ceiling with reserved 0", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: AT },
      "P3",
    );

    const capacity = await t.run(async (ctx) => (await getGuarantee(ctx, guaranteeId)).capacity);

    expect(capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 3_000_000,
      reservedCents: 0,
    });
    expect(capacity.availableCents + capacity.reservedCents).toBe(3_000_000);
  });

  test("keeps available + reserved = ceiling when the fixture pre-reserves capacity", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "cover_committed", availableCents: 10_000 },
      "P4",
    );

    const capacity = await t.run(async (ctx) => (await getGuarantee(ctx, guaranteeId)).capacity);

    expect(capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 10_000,
      reservedCents: 2_990_000,
    });
  });

  test("a reservation patch moves cents between legs without touching the ceiling or the terms", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "default_verified" },
      "P5",
    );

    const row = await t.run(async (ctx) => {
      await ctx.db.patch(guaranteeId, {
        capacity: { ceilingCents: 3_000_000, availableCents: 2_700_000, reservedCents: 300_000 },
      });
      return getGuarantee(ctx, guaranteeId);
    });

    expect(row.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 2_700_000,
      reservedCents: 300_000,
    });
    expect(row.terms).toEqual({
      productSlug: "mutav-fianca",
      plan: "basic",
      rentCents: 100_000,
      feeCents: 9_000,
      taxaFeeCents: 9_000,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaCommissionRate: 0.25,
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      coverageCeilingCents: 3_000_000,
      exitCostCapCents: 600_000,
      appliedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("editing the product after pricing never rewrites an existing guarantee's terms", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, productId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active" },
      "P6",
    );

    const { product, guarantee } = await t.run(async (ctx) => {
      await ctx.db.patch(productId, {
        terms: {
          tierRate: { bom: 0.2, regular: 0.25, ruim: 0.3 },
          coverageCeilingMultiplier: 24,
          exitCostMultiplier: 3,
          activationFeeCents: 50_000,
          commissionRate: 0.05,
          prestamistaPremiumCents: 2_000,
          prestamistaCommissionRate: 0.5,
        },
      });
      return {
        product: await getProduct(ctx, productId),
        guarantee: await getGuarantee(ctx, guaranteeId),
      };
    });

    expect(product.terms.tierRate.bom).toBe(0.2);
    expect(product.terms.coverageCeilingMultiplier).toBe(24);
    expect(guarantee.terms).toEqual({
      productSlug: "mutav-fianca",
      plan: "basic",
      rentCents: 100_000,
      feeCents: 9_000,
      taxaFeeCents: 9_000,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaCommissionRate: 0.25,
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      coverageCeilingCents: 3_000_000,
      exitCostCapCents: 600_000,
      appliedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(guarantee.capacity.ceilingCents).toBe(3_000_000);
  });

  test("a status transition patch leaves the terms snapshot byte-identical", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(t, { agencyId, status: "drafted" }, "P7");

    const row = await t.run(async (ctx) => {
      await ctx.db.patch(guaranteeId, {
        status: "active",
        activatedAt: "2026-02-01T00:00:00.000Z",
      });
      return getGuarantee(ctx, guaranteeId);
    });

    expect(row.status).toBe("active");
    expect(row.activatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(row.terms).toEqual({
      productSlug: "mutav-fianca",
      plan: "basic",
      rentCents: 100_000,
      feeCents: 9_000,
      taxaFeeCents: 9_000,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaCommissionRate: 0.25,
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      coverageCeilingCents: 3_000_000,
      exitCostCapCents: 600_000,
      appliedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(row.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 3_000_000,
      reservedCents: 0,
    });
  });
});

describe("one open guarantee per lease", () => {
  test("creation points the lease at its single open guarantee", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active" },
      "O1",
    );

    const { lease, rows } = await t.run(async (ctx) => ({
      lease: await getLease(ctx, leaseId),
      rows: await ctx.db
        .query("guarantees")
        .withIndex("by_lease", (q) => q.eq("leaseId", leaseId))
        .collect(),
    }));

    expect(lease.openGuaranteeId).toBe(guaranteeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe(guaranteeId);
    expect(rows[0]?.status).toBe("active");
  });

  test("a lease whose only guarantee is closed carries a null pointer", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { leaseId } = await seedGuaranteeWithLease(t, { agencyId, status: "closed" }, "O2");

    const { lease, rows } = await t.run(async (ctx) => ({
      lease: await getLease(ctx, leaseId),
      rows: await ctx.db
        .query("guarantees")
        .withIndex("by_lease", (q) => q.eq("leaseId", leaseId))
        .collect(),
    }));

    expect(lease.openGuaranteeId).toBe(null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("closed");
    expect(rows[0]?.closure).toEqual({
      reason: "end_of_lease",
      closedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  test("closing the open guarantee nulls the pointer in the same transaction", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: AT },
      "O3",
    );

    const { guarantee, lease } = await t.run(async (ctx) => {
      await closeGuaranteeRow(ctx, { guaranteeId, leaseId, reason: "rescission" });
      return {
        guarantee: await getGuarantee(ctx, guaranteeId),
        lease: await getLease(ctx, leaseId),
      };
    });

    expect(guarantee.status).toBe("closed");
    expect(guarantee.closure).toEqual({
      reason: "rescission",
      closedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(lease.openGuaranteeId).toBe(null);
  });

  test("re-guaranteeing a lease with two closed lives yields exactly one non-closed row and the pointer follows it", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { leaseId, productId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "closed" },
      "O4-1",
    );

    const { rows, lease, pointed, openId } = await t.run(async (ctx) => {
      await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId,
        productId,
        publicId: "O4-2",
        status: "closed",
        closure: { reason: "canceled_pre_activation", closedAt: "2026-07-01T00:00:00.000Z" },
      });
      const openId = await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId,
        productId,
        publicId: "O4-3",
        status: "active",
        activatedAt: "2026-08-01T00:00:00.000Z",
      });
      await ctx.db.patch(leaseId, { openGuaranteeId: openId });

      const rows = await ctx.db
        .query("guarantees")
        .withIndex("by_lease", (q) => q.eq("leaseId", leaseId))
        .collect();
      const lease = await getLease(ctx, leaseId);
      if (lease.openGuaranteeId === null) throw new Error("pointer unexpectedly null");
      const pointed = await getGuarantee(ctx, lease.openGuaranteeId);
      return { rows, lease, pointed, openId };
    });

    expect(rows).toHaveLength(3);
    expect(publicIds(rows.filter((r) => r.status !== "closed"))).toEqual(["O4-3"]);
    expect(lease.openGuaranteeId).toBe(openId);
    expect(pointed.publicId).toBe("O4-3");
    expect(pointed.status).toBe("active");
  });

  test("assertLeaseAcceptsGuarantee reads the pointer: refuses while set, accepts once the close nulls it", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active" },
      "O5",
    );

    const { before, after } = await t.run(async (ctx) => {
      const before = assertLeaseAcceptsGuarantee(await getLease(ctx, leaseId));
      await closeGuaranteeRow(ctx, { guaranteeId, leaseId, reason: "end_of_lease" });
      const after = assertLeaseAcceptsGuarantee(await getLease(ctx, leaseId));
      return { before, after };
    });

    expect(before.success).toBe(false);
    expect(errorOf(before)).toEqual({ code: "LEASE_HAS_OPEN_GUARANTEE" });
    expect(after.success).toBe(true);
    expect(dataOf(after)).toEqual({ leaseId });
  });
});

describe("machine + db composition — guard before patch", () => {
  test("applies a legal transition and leaves the row untouched on an illegal one", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(t, { agencyId, status: "drafted" }, "M1");

    const { legal, illegal, final } = await t.run(async (ctx) => {
      const legal = assertTransition("drafted", "active");
      if (legal.success) {
        await ctx.db.patch(guaranteeId, {
          status: "active",
          activatedAt: "2026-02-01T00:00:00.000Z",
        });
      }
      const row = await getGuarantee(ctx, guaranteeId);
      const illegal = assertTransition(row.status, "default_verified");
      if (illegal.success) {
        await ctx.db.patch(guaranteeId, { status: "default_verified" });
      }
      return { legal, illegal, final: await getGuarantee(ctx, guaranteeId) };
    });

    expect(legal.success).toBe(true);
    expect(dataOf(legal)).toEqual({ from: "drafted", to: "active" });
    expect(illegal.success).toBe(false);
    expect(errorOf(illegal)).toEqual({ code: "ILLEGAL_TRANSITION" });
    expect(final.status).toBe("active");
    expect(final.activatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  test("a closed row rejects both a transition and a re-close and keeps its original closure", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "closed" },
      "M2",
    );

    const { t1, c1, row, lease } = await t.run(async (ctx) => {
      const stored = await getGuarantee(ctx, guaranteeId);
      const t1 = assertTransition(stored.status, "active");
      const c1 = assertClose(stored.status, "end_of_lease");
      return {
        t1,
        c1,
        row: await getGuarantee(ctx, guaranteeId),
        lease: await getLease(ctx, leaseId),
      };
    });

    expect(errorOf(t1)).toEqual({ code: "TERMINAL_STATE" });
    expect(errorOf(c1)).toEqual({ code: "TERMINAL_STATE" });
    expect(row.status).toBe("closed");
    expect(row.closure).toEqual({ reason: "end_of_lease", closedAt: "2026-06-01T00:00:00.000Z" });
    expect(lease.openGuaranteeId).toBe(null);
  });

  test("assertClose gates the reason by the stored state before the close patch lands", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: AT },
      "M3",
    );

    const { denied, snapshot, allowed, row, lease } = await t.run(async (ctx) => {
      const stored = await getGuarantee(ctx, guaranteeId);
      const denied = assertClose(stored.status, "canceled_pre_activation");
      const afterDenied = await getGuarantee(ctx, guaranteeId);
      const leaseAfterDenied = await getLease(ctx, leaseId);
      const snapshot = { closure: afterDenied.closure, pointer: leaseAfterDenied.openGuaranteeId };
      const allowed = assertClose(afterDenied.status, "end_of_lease");
      if (allowed.success) {
        await closeGuaranteeRow(ctx, { guaranteeId, leaseId, reason: allowed.data.reason });
      }
      return {
        denied,
        snapshot,
        allowed,
        row: await getGuarantee(ctx, guaranteeId),
        lease: await getLease(ctx, leaseId),
      };
    });

    expect(errorOf(denied)).toEqual({ code: "REASON_NOT_ALLOWED_FROM_STATE" });
    expect(snapshot.closure).toBeUndefined();
    expect(snapshot.pointer).toBe(guaranteeId);
    expect(dataOf(allowed)).toEqual({ from: "active", reason: "end_of_lease" });
    expect(row.status).toBe("closed");
    expect(row.closure).toEqual({ reason: "end_of_lease", closedAt: "2026-06-01T00:00:00.000Z" });
    expect(lease.openGuaranteeId).toBe(null);
  });
});

describe("index reads — guarantees", () => {
  test("by_publicId resolves a publicId that repeats across agencies and needs an agencyId filter", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    const a = await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "G-DUP");
    await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "drafted" }, "G-DUP");

    const { matches, forA, miss } = await t.run(async (ctx) => {
      const matches = await ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", "G-DUP"))
        .collect();
      const miss = await ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", "G-NOPE"))
        .unique();
      return { matches, forA: matches.find((r) => r.agencyId === agencyA), miss };
    });

    expect(matches).toHaveLength(2);
    expect(forA?.leaseId).toBe(a.leaseId);
    expect(forA?.status).toBe("active");
    expect(miss).toBeNull();
  });

  test("by_status is platform-wide and returns every agency's rows in that state", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "A-ACT");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "drafted" }, "A-DRF");
    await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "active" }, "B-ACT");

    const { active, inEviction } = await t.run(async (ctx) => ({
      active: await ctx.db
        .query("guarantees")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .collect(),
      inEviction: await ctx.db
        .query("guarantees")
        .withIndex("by_status", (q) => q.eq("status", "in_eviction"))
        .collect(),
    }));

    expect(publicIds(active)).toEqual(["A-ACT", "B-ACT"]);
    expect(inEviction).toHaveLength(0);
  });

  test("by_status iterated over INSURED_STATES returns exactly the in-force rows", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    await seedOneGuaranteePerState(t, agencyId);

    const all = await t.run(async (ctx) => {
      const collected: Guarantee[] = [];
      for (const state of INSURED_STATES) {
        const rows = await ctx.db
          .query("guarantees")
          .withIndex("by_status", (q) => q.eq("status", state))
          .collect();
        collected.push(...rows);
      }
      return collected;
    });

    expect(publicIds(all)).toEqual([
      "active",
      "cover_committed",
      "default_verified",
      "in_arrears",
      "in_eviction",
    ]);
    expect(all).toHaveLength(5);
  });

  test("a single lexical range over by_status cannot stand in for the INSURED_STATES iteration", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    await seedOneGuaranteePerState(t, agencyId);

    const inIndexOrder = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("guarantees")
        .withIndex("by_status", (q) => q.gte("status", "active").lte("status", "in_eviction"))
        .collect();
      return rows.map((r) => r.publicId);
    });

    expect(inIndexOrder).toEqual([
      "active",
      "closed",
      "cover_committed",
      "default_verified",
      "drafted",
      "in_arrears",
      "in_eviction",
    ]);
  });

  test("by_agency_status narrows to one agency and one state", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "A1");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "A2");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "drafted" }, "A3");
    await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "active" }, "B1");

    const { active, drafted, closed } = await t.run(async (ctx) => {
      const forState = (status: GuaranteeState) =>
        ctx.db
          .query("guarantees")
          .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyA).eq("status", status))
          .collect();
      return {
        active: await forState("active"),
        drafted: await forState("drafted"),
        closed: await forState("closed"),
      };
    });

    expect(publicIds(active)).toEqual(["A1", "A2"]);
    expect(publicIds(drafted)).toEqual(["A3"]);
    expect(publicIds(closed)).toEqual([]);
  });

  async function seedRenewalFixtures(
    t: Harness,
  ): Promise<{ agencyA: AgencyId; agencyB: AgencyId }> {
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "active", nextRenewalDate: "2026-09-01" },
      "R-SEP",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "active", nextRenewalDate: "2026-03-15" },
      "R-MAR",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "active", nextRenewalDate: "2026-04-20" },
      "R-APR",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "drafted", nextRenewalDate: "2026-04-01" },
      "D-APR",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyB, status: "active", nextRenewalDate: "2026-04-01" },
      "B-APR",
    );
    return { agencyA, agencyB };
  }

  test("by_agency_status_nextRenewalDate serves a renewal window in ascending date order", async () => {
    const t = setup();
    const { agencyA } = await seedRenewalFixtures(t);

    const inWindow = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("guarantees")
        .withIndex("by_agency_status_nextRenewalDate", (q) =>
          q
            .eq("agencyId", agencyA)
            .eq("status", "active")
            .gte("nextRenewalDate", "2026-03-01")
            .lte("nextRenewalDate", "2026-05-01"),
        )
        .collect();
      return rows.map((r) => r.publicId);
    });

    expect(inWindow).toEqual(["R-MAR", "R-APR"]);
  });

  test("by_agency_status_nextRenewalDate answers an overdue read with a strict upper bound", async () => {
    const t = setup();
    const { agencyA } = await seedRenewalFixtures(t);

    const overdue = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("guarantees")
        .withIndex("by_agency_status_nextRenewalDate", (q) =>
          q.eq("agencyId", agencyA).eq("status", "active").lt("nextRenewalDate", "2026-04-01"),
        )
        .collect();
      return rows.map((r) => r.publicId);
    });

    expect(overdue).toEqual(["R-MAR"]);
  });

  test("by_product groups guarantees by the product that priced them", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const def1 = await seedGuaranteeWithLease(t, { agencyId, status: "active" }, "G-DEF");
    const def2 = await seedGuaranteeWithLease(t, { agencyId, status: "closed" }, "G-CLOSED");

    const { byDefault, bySp } = await t.run(async (ctx) => {
      const spId = await insertProductRow(ctx, {
        slug: "mutav-fianca-sp",
        enabled: true,
        isDefault: false,
      });
      const gid = await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId: def2.leaseId,
        productId: spId,
        publicId: "G-SP",
        status: "drafted",
      });
      await ctx.db.patch(def2.leaseId, { openGuaranteeId: gid });
      return {
        byDefault: await ctx.db
          .query("guarantees")
          .withIndex("by_product", (q) => q.eq("productId", def1.productId))
          .collect(),
        bySp: await ctx.db
          .query("guarantees")
          .withIndex("by_product", (q) => q.eq("productId", spId))
          .collect(),
      };
    });

    expect(publicIds(byDefault)).toEqual(["G-CLOSED", "G-DEF"]);
    expect(publicIds(bySp)).toEqual(["G-SP"]);
  });
});

describe("index reads — leases, products, guaranteeHistory", () => {
  test("leases.by_publicId resolves the fixture's LSE- prefixed id to its tenant and open guarantee", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, tenantId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active" },
      "L1",
    );

    const lease = await t.run((ctx) =>
      ctx.db
        .query("leases")
        .withIndex("by_publicId", (q) => q.eq("publicId", "LSE-L1"))
        .unique(),
    );

    expect(lease).not.toBeNull();
    expect(lease?.tenantId).toBe(tenantId);
    expect(lease?.openGuaranteeId).toBe(guaranteeId);
    expect(lease?.rent).toEqual({
      rentCents: 100_000,
      condoCents: 0,
      otherFeesCents: 0,
      totalRentCents: 100_000,
    });
    expect(lease?.payer).toBe("tenant");
    expect(lease?.propertyKind).toBe("residential");
  });

  test("leases.by_tenant and by_agency_tenant: one tenant renting through two agencies", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    const { tenantId } = await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "active" },
      "L1",
    );

    const { byTenant, byAgencyA, byAgencyB } = await t.run(async (ctx) => {
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId, publicId: "LSE-L2" });
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId, publicId: "LSE-L3" });
      return {
        byTenant: await ctx.db
          .query("leases")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .collect(),
        byAgencyA: await ctx.db
          .query("leases")
          .withIndex("by_agency_tenant", (q) => q.eq("agencyId", agencyA).eq("tenantId", tenantId))
          .collect(),
        byAgencyB: await ctx.db
          .query("leases")
          .withIndex("by_agency_tenant", (q) => q.eq("agencyId", agencyB).eq("tenantId", tenantId))
          .collect(),
      };
    });

    expect(publicIds(byTenant)).toEqual(["LSE-L1", "LSE-L2", "LSE-L3"]);
    expect(publicIds(byAgencyA)).toEqual(["LSE-L1", "LSE-L2"]);
    expect(publicIds(byAgencyB)).toEqual(["LSE-L3"]);
  });

  test("products.by_slug finds the seeded default with today's pricing table and seeding is idempotent", async () => {
    const t = setup();
    const p1 = await seedDefaultProduct(t);
    const p2 = await seedDefaultProduct(t);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("products")
        .withIndex("by_slug", (q) => q.eq("slug", "mutav-fianca"))
        .collect(),
    );

    expect(p2).toBe(p1);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("default product not found");
    expect({
      slug: row.slug,
      name: row.name,
      enabled: row.enabled,
      isDefault: row.isDefault,
      effectiveFrom: row.effectiveFrom,
    }).toEqual({
      slug: "mutav-fianca",
      name: "Mutav Fiança",
      enabled: true,
      isDefault: true,
      effectiveFrom: "2022-01-01T00:00:00.000Z",
    });
    expect(row.terms).toEqual({
      tierRate: { bom: 0.09, regular: 0.12, ruim: 0.15 },
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      activationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaPremiumCents: 1_280,
      prestamistaCommissionRate: 0.25,
    });
    expect(row.eligibility).toEqual({
      agencyIds: null,
      regionUFs: null,
      minTier: null,
      propertyKinds: null,
    });
    expect(row.effectiveTo).toBeUndefined();
  });

  test("products.by_enabled_isDefault picks the enabled default among disabled and non-default siblings", async () => {
    const t = setup();
    await seedDefaultProduct(t);

    const { enabledDefault, disabledDefault, enabledNonDefault } = await t.run(async (ctx) => {
      await insertProductRow(ctx, { slug: "mutav-fianca-legacy", enabled: false, isDefault: true });
      await insertProductRow(ctx, { slug: "mutav-fianca-sp", enabled: true, isDefault: false });
      const slugsFor = async (enabled: boolean, isDefault: boolean) => {
        const rows = await ctx.db
          .query("products")
          .withIndex("by_enabled_isDefault", (q) =>
            q.eq("enabled", enabled).eq("isDefault", isDefault),
          )
          .collect();
        return rows.map((r) => r.slug);
      };
      return {
        enabledDefault: await slugsFor(true, true),
        disabledDefault: await slugsFor(false, true),
        enabledNonDefault: await slugsFor(true, false),
      };
    });

    expect(enabledDefault).toEqual(["mutav-fianca"]);
    expect(disabledDefault).toEqual(["mutav-fianca-legacy"]);
    expect(enabledNonDefault).toEqual(["mutav-fianca-sp"]);
  });

  test("guaranteeHistory.by_guarantee returns one guarantee's events in `at` order", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const { messages, latest } = await t.run(async (ctx) => {
      await ctx.db.insert("guaranteeHistory", {
        agencyId,
        guaranteePublicId: "H1",
        at: "2026-01-03T00:00:00.000Z",
        username: "ana",
        message: "Garantia ativada",
      });
      await ctx.db.insert("guaranteeHistory", {
        agencyId,
        guaranteePublicId: "H1",
        at: "2026-01-01T00:00:00.000Z",
        username: "ana",
        message: "Garantia criada",
      });
      await ctx.db.insert("guaranteeHistory", {
        agencyId,
        guaranteePublicId: "H1",
        at: "2026-01-02T00:00:00.000Z",
        username: "ana",
        message: "Documento enviado",
      });
      await ctx.db.insert("guaranteeHistory", {
        agencyId,
        guaranteePublicId: "H2",
        at: "2026-01-01T00:00:00.000Z",
        username: "ana",
        message: "Garantia criada",
      });
      const rows = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_guarantee", (q) => q.eq("guaranteePublicId", "H1"))
        .collect();
      const latest = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_guarantee", (q) => q.eq("guaranteePublicId", "H1"))
        .order("desc")
        .first();
      return { messages: rows.map((r) => r.message), latest };
    });

    expect(messages).toEqual(["Garantia criada", "Documento enviado", "Garantia ativada"]);
    expect(latest?.message).toBe("Garantia ativada");
    expect(messages).toHaveLength(3);
  });

  test("guaranteeHistory.by_agency_guarantee disambiguates a shared publicId and round-trips tenantSnapshot", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");

    const { forA, forB } = await t.run(async (ctx) => {
      await ctx.db.insert("guaranteeHistory", {
        agencyId: agencyA,
        guaranteePublicId: "G-DUP",
        at: AT,
        username: "ana",
        message: "Garantia criada",
        tenantSnapshot: {
          entityType: "pf",
          taxId: "11144477735",
          fullName: "Test Tenant",
          email: "tenant@test.br",
          phone: "11999999999",
          birthDate: "1990-01-01",
        },
      });
      await ctx.db.insert("guaranteeHistory", {
        agencyId: agencyB,
        guaranteePublicId: "G-DUP",
        at: AT,
        username: "bruno",
        message: "Proposta cancelada",
      });
      const forAgency = (agencyId: AgencyId) =>
        ctx.db
          .query("guaranteeHistory")
          .withIndex("by_agency_guarantee", (q) =>
            q.eq("agencyId", agencyId).eq("guaranteePublicId", "G-DUP"),
          )
          .collect();
      return { forA: await forAgency(agencyA), forB: await forAgency(agencyB) };
    });

    expect(forA).toHaveLength(1);
    expect(forA[0]?.username).toBe("ana");
    expect(forA[0]?.tenantSnapshot).toEqual({
      entityType: "pf",
      taxId: "11144477735",
      fullName: "Test Tenant",
      email: "tenant@test.br",
      phone: "11999999999",
      birthDate: "1990-01-01",
    });
    expect(forB).toHaveLength(1);
    expect(forB[0]?.username).toBe("bruno");
    expect(forB[0]?.tenantSnapshot).toBeUndefined();
  });
});

describe("cross-agency isolation via by_agency_* indexes", () => {
  test("guarantees.by_agency_status shows each agency only its own rows", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    const agencyC = await seedAgency(t, "Agency C", "00000000000103");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "A1");
    await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "active" }, "B1");

    const { forA, forB, forC } = await t.run(async (ctx) => {
      const activeFor = (agencyId: AgencyId) =>
        ctx.db
          .query("guarantees")
          .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", "active"))
          .collect();
      return {
        forA: await activeFor(agencyA),
        forB: await activeFor(agencyB),
        forC: await activeFor(agencyC),
      };
    });

    expect(publicIds(forA)).toEqual(["A1"]);
    expect(publicIds(forB)).toEqual(["B1"]);
    expect(publicIds(forC)).toEqual([]);
  });

  test("guarantees.by_agency_status_nextRenewalDate keeps an identical renewal date in another agency out of the window", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "active", nextRenewalDate: "2026-04-01" },
      "A1",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyB, status: "active", nextRenewalDate: "2026-04-01" },
      "B1",
    );

    const { forA, forB } = await t.run(async (ctx) => {
      const windowFor = (agencyId: AgencyId) =>
        ctx.db
          .query("guarantees")
          .withIndex("by_agency_status_nextRenewalDate", (q) =>
            q
              .eq("agencyId", agencyId)
              .eq("status", "active")
              .gte("nextRenewalDate", "2026-03-01")
              .lte("nextRenewalDate", "2026-05-01"),
          )
          .collect();
      return { forA: await windowFor(agencyA), forB: await windowFor(agencyB) };
    });

    expect(publicIds(forA)).toEqual(["A1"]);
    expect(publicIds(forB)).toEqual(["B1"]);
  });

  test("leases.by_agency lists only the agency's leases", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "A1");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "A2");
    await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "active" }, "B1");

    const { forA, forB } = await t.run(async (ctx) => {
      const leasesFor = (agencyId: AgencyId) =>
        ctx.db
          .query("leases")
          .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
          .collect();
      return { forA: await leasesFor(agencyA), forB: await leasesFor(agencyB) };
    });

    expect(publicIds(forA)).toEqual(["LSE-A1", "LSE-A2"]);
    expect(publicIds(forB)).toEqual(["LSE-B1"]);
  });

  test("leases.by_agency_tenant hides another agency's lease for the same tenant", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    const { tenantId } = await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "active" },
      "A1",
    );

    const { forA, forB } = await t.run(async (ctx) => {
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId, publicId: "LSE-B1" });
      const leasesFor = (agencyId: AgencyId) =>
        ctx.db
          .query("leases")
          .withIndex("by_agency_tenant", (q) => q.eq("agencyId", agencyId).eq("tenantId", tenantId))
          .collect();
      return { forA: await leasesFor(agencyA), forB: await leasesFor(agencyB) };
    });

    expect(publicIds(forA)).toEqual(["LSE-A1"]);
    expect(publicIds(forB)).toEqual(["LSE-B1"]);
  });
});

describe("contractApplications untouched by guarantee writes", () => {
  test("seeding, closing and re-guaranteeing leaves the agency's contractApplications rows byte-identical", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const productId = await seedDefaultProduct(t);

    const before = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        publicId: "user-scn",
        name: "Scenario User",
        email: "scn@mutav.test",
        createdAt: AT,
      });
      const appId = await ctx.db.insert("contractApplications", {
        agencyId,
        subjectHash: "hash-A-1",
        entityType: "pf",
        propertyKind: "residential",
        cep: "01000000",
        rentCents: 100_000,
        openedBy: userId,
        openedAt: 1_767_225_600_000,
      });
      return ctx.db.get(appId);
    });

    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active" },
      "CA1",
    );
    await t.run(async (ctx) => {
      await closeGuaranteeRow(ctx, { guaranteeId, leaseId, reason: "end_of_lease" });
      const nextId = await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId,
        productId,
        publicId: "CA2",
        status: "drafted",
      });
      await ctx.db.patch(leaseId, { openGuaranteeId: nextId });
    });

    const { indexed, total } = await t.run(async (ctx) => ({
      indexed: await ctx.db
        .query("contractApplications")
        .withIndex("by_agency_subject_time", (q) =>
          q.eq("agencyId", agencyId).eq("subjectHash", "hash-A-1"),
        )
        .collect(),
      total: (await ctx.db.query("contractApplications").collect()).length,
    }));

    expect(indexed).toEqual([before]);
    expect(total).toBe(1);
  });
});
