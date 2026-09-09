// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { defineSchema, type WithoutSystemFields } from "convex/server";
import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import type { CreditAnalysisAssessmentId } from "../creditAnalysis/domain";
import { assertLeaseAcceptsGuarantee, type Lease, type LeaseId } from "../leases/domain";
import {
  registerContractAggregateComponents,
  seedAgencyWithMembership,
  seedDefaultProduct,
  seedFreshCreditAssessment,
  seedGuaranteeWithLease,
  setupAuthenticatedUser,
} from "../lib/testFixtures";
import type { Result } from "../lib/result";
import { isEffective, isEligible, type Product, type ProductId } from "../products/domain";
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
import { priceGuarantee } from "./pricing";
import { agencySubmittedTenant } from "./tenantIdentity";

// The app schema runs with `schemaValidation: false` (pre-prod reseed window),
// and convex-test skips every validator when that flag is off — an insert with
// `status: "banana"` round-trips untouched. Conformance tests therefore run on
// this strict twin of the same tables, which is the only harness that can
// refuse an out-of-union literal or a wrong-table id.
const strictSchema = defineSchema(schema.tables, { schemaValidation: true });

type Harness = TestConvex<typeof schema>;

function setup(): Harness {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  return t;
}

function setupStrict(): Harness {
  const t = convexTest(strictSchema);
  registerContractAggregateComponents(t);
  return t;
}

// `guarantees.create` hashes the tenant tax ID to find its credit assessment.
beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

const AT = "2026-01-01T00:00:00.000Z";
const CLOSED_AT = "2026-06-01T00:00:00.000Z";
const VALID_CPF = "52998224725";

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

const NO_ELIGIBILITY_RESTRICTION: Product["eligibility"] = {
  agencyIds: null,
  regionUFs: null,
  minTier: null,
  propertyKinds: null,
};

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

const ALL_SCORE_TIERS = ["bom", "regular", "ruim", "negado"] as const;

const ALL_TENANT_APPROVAL_STATUSES = ["aprovado", "pendente", "reprovado"] as const;

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

type NewLease = WithoutSystemFields<Lease>;
type NewGuarantee = WithoutSystemFields<Guarantee>;
type NewProduct = WithoutSystemFields<Product>;

type LeaseSpec = {
  agencyId: AgencyId;
  tenantId: TenantId;
  publicId: string;
  propertyKind?: Lease["propertyKind"];
  rent?: Lease["rent"];
};

function leaseDoc(spec: LeaseSpec): NewLease {
  return {
    agencyId: spec.agencyId,
    publicId: spec.publicId,
    tenantId: spec.tenantId,
    propertyKind: spec.propertyKind ?? "residential",
    property: {
      cep: "01000000",
      streetAndNumber: "Rua Teste, 1",
      neighborhood: "Centro",
      cityUF: "São Paulo/SP",
      complement: "",
    },
    tag: "",
    description: "",
    rent: spec.rent ?? {
      rentCents: 100_000,
      condoCents: 0,
      otherFeesCents: 0,
      totalRentCents: 100_000,
    },
    payer: "tenant",
    openGuaranteeId: null,
  };
}

async function insertLeaseRow(ctx: MutationCtx, spec: LeaseSpec): Promise<LeaseId> {
  return ctx.db.insert("leases", leaseDoc(spec));
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
  underwriting?: Guarantee["underwriting"];
  tenantApproval?: Guarantee["tenantApproval"];
  terms?: GuaranteeTerms;
  capacity?: GuaranteeCapacity;
};

function guaranteeDoc(spec: RawGuaranteeSpec): NewGuarantee {
  return {
    agencyId: spec.agencyId,
    leaseId: spec.leaseId,
    publicId: spec.publicId,
    productId: spec.productId,
    status: spec.status,
    ...(spec.closure ? { closure: spec.closure } : {}),
    activatedAt: spec.activatedAt ?? null,
    nextRenewalDate: spec.nextRenewalDate ?? "2026-12-31",
    underwriting: spec.underwriting ?? { score: 750, tier: "bom" },
    tenantApproval: spec.tenantApproval ?? { status: "pendente", termApprovedAt: null },
    terms: spec.terms ?? { ...BASIC_BOM_TERMS },
    capacity: spec.capacity ?? { ...FULL_CAPACITY },
    documents: [...PENDING_DOCUMENTS],
  };
}

// Deliberately never patches the lease pointer: tests do it explicitly so the
// one-open-per-lease invariant stays visible at the call site.
async function insertGuaranteeRow(ctx: MutationCtx, spec: RawGuaranteeSpec): Promise<GuaranteeId> {
  return ctx.db.insert("guarantees", guaranteeDoc(spec));
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

type ProductSpec = {
  slug: string;
  enabled: boolean;
  isDefault: boolean;
  effectiveTo?: string;
  eligibility?: Product["eligibility"];
};

function productDoc(spec: ProductSpec): NewProduct {
  return {
    slug: spec.slug,
    name: spec.slug,
    enabled: spec.enabled,
    isDefault: spec.isDefault,
    effectiveFrom: AT,
    ...(spec.effectiveTo ? { effectiveTo: spec.effectiveTo } : {}),
    terms: {
      tierRate: { bom: 0.1, regular: 0.13, ruim: 0.16 },
      coverageCeilingMultiplier: 24,
      exitCostMultiplier: 6,
      activationFeeCents: 20_000,
      commissionRate: 0.02,
      prestamistaPremiumCents: 1_500,
      prestamistaCommissionRate: 0.3,
    },
    eligibility: spec.eligibility ?? { ...NO_ELIGIBILITY_RESTRICTION },
  };
}

async function insertProductRow(ctx: MutationCtx, spec: ProductSpec): Promise<ProductId> {
  return ctx.db.insert("products", productDoc(spec));
}

// A valid document with one field overwritten by a value the schema does not
// declare. Only the strict harness can refuse it, which is the point.
// hook-ok: deliberately malformed document to exercise the schema validator
function malformed<T extends object>(valid: T, overrides: Record<string, unknown>): T {
  return { ...valid, ...overrides } as T;
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

function userFields(row: object): string[] {
  return Object.keys(row)
    .filter((k) => !k.startsWith("_"))
    .sort();
}

async function guaranteesOnLease(ctx: MutationCtx, leaseId: LeaseId): Promise<Guarantee[]> {
  return ctx.db
    .query("guarantees")
    .withIndex("by_lease", (q) => q.eq("leaseId", leaseId))
    .collect();
}

async function guaranteesForAgencyStatus(
  ctx: MutationCtx,
  agencyId: AgencyId,
  status: GuaranteeState,
): Promise<Guarantee[]> {
  return ctx.db
    .query("guarantees")
    .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", status))
    .collect();
}

// Guard-then-patch as a mutation would do it: the transition is only written
// when the machine approves it. Returns the guard Result so the test can
// assert on it, and the row as it stands afterwards.
async function transitionRow(
  ctx: MutationCtx,
  guaranteeId: GuaranteeId,
  to: GuaranteeState,
  extra: Partial<Pick<Guarantee, "activatedAt" | "capacity">> = {},
) {
  const stored = await getGuarantee(ctx, guaranteeId);
  const guard = assertTransition(stored.status, to);
  if (guard.success) await ctx.db.patch(guaranteeId, { status: to, ...extra });
  return { guard, row: await getGuarantee(ctx, guaranteeId) };
}

async function closeRow(
  ctx: MutationCtx,
  {
    guaranteeId,
    leaseId,
    reason,
    capacity,
  }: {
    guaranteeId: GuaranteeId;
    leaseId: LeaseId;
    reason: CloseReason;
    capacity?: GuaranteeCapacity;
  },
) {
  const stored = await getGuarantee(ctx, guaranteeId);
  const guard = assertClose(stored.status, reason);
  if (guard.success) {
    await closeGuaranteeRow(ctx, { guaranteeId, leaseId, reason });
    if (capacity) await ctx.db.patch(guaranteeId, { capacity });
  }
  return { guard, row: await getGuarantee(ctx, guaranteeId), lease: await getLease(ctx, leaseId) };
}

type PointerViolation = { lease: string; problem: string };

// Bidirectional form of the one-open-per-lease invariant, reusable by any
// later mutation test: every lease pointer resolves to an open row on that
// same lease, and every lease with an open row is pointed at it.
async function pointerViolations(
  ctx: MutationCtx,
  agencyId: AgencyId,
): Promise<PointerViolation[]> {
  const leases = await ctx.db
    .query("leases")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .collect();
  const violations: PointerViolation[] = [];
  for (const lease of leases) {
    const open = (await guaranteesOnLease(ctx, lease._id)).filter((g) => g.status !== "closed");
    if (lease.openGuaranteeId === null) {
      if (open.length > 0)
        violations.push({ lease: lease.publicId, problem: "open row without pointer" });
      continue;
    }
    const pointed = await ctx.db.get(lease.openGuaranteeId);
    if (!pointed) {
      violations.push({ lease: lease.publicId, problem: "pointer targets a missing guarantee" });
    } else if (pointed.leaseId !== lease._id) {
      violations.push({
        lease: lease.publicId,
        problem: "pointer targets another lease's guarantee",
      });
    } else if (pointed.agencyId !== lease.agencyId) {
      violations.push({
        lease: lease.publicId,
        problem: "pointer targets another agency's guarantee",
      });
    } else if (pointed.status === "closed") {
      violations.push({ lease: lease.publicId, problem: "pointer targets a closed guarantee" });
    } else if (open.length !== 1) {
      violations.push({ lease: lease.publicId, problem: "more than one open guarantee" });
    }
  }
  return violations.sort((a, b) => a.lease.localeCompare(b.lease));
}

async function closureMismatches(ctx: MutationCtx, agencyId: AgencyId): Promise<string[]> {
  const rows: Guarantee[] = [];
  for (const state of ALL_STATES)
    rows.push(...(await guaranteesForAgencyStatus(ctx, agencyId, state)));
  return rows
    .filter((g) => (g.status === "closed") !== (g.closure !== undefined))
    .map((g) => g.publicId)
    .sort();
}

type SeededRow = { state: GuaranteeState; leaseId: LeaseId; guaranteeId: GuaranteeId };

function seededFor(rows: SeededRow[], state: GuaranteeState): SeededRow {
  const row = rows.find((r) => r.state === state);
  if (!row) throw new Error(`no seeded guarantee in state ${state}`);
  return row;
}

// One guarantee per state, each on its own lease; open ones get the pointer.
async function seedOneGuaranteePerState(t: Harness, agencyId: AgencyId): Promise<SeededRow[]> {
  const productId = await seedDefaultProduct(t);
  return t.run(async (ctx) => {
    const tenantId = await insertTenantRow(ctx);
    const seeded: SeededRow[] = [];
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
      seeded.push({ state, leaseId, guaranteeId });
    }
    return seeded;
  });
}

describe("schema conformance — strict harness", () => {
  describe("guarantees table", () => {
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
      expect(declared).toEqual([...GUARANTEE_STATES]);
    });

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
      expect(declared).toEqual([...CLOSE_REASONS]);
    });

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

    test.each(ALL_STATES)(
      "round-trips guarantee state %s through the strict validator with the full field set",
      async (state) => {
        const t = setupStrict();
        const agencyId = await seedAgency(t, "Agency A", "00000000000101");
        const productId = await seedDefaultProduct(t);

        const row = await t.run(async (ctx) => {
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
          return getGuarantee(ctx, guaranteeId);
        });

        expect(row.status).toBe(state);
        expect(row.closure !== undefined).toBe(state === "closed");
        expect(userFields(row)).toEqual([
          "activatedAt",
          "agencyId",
          "capacity",
          ...(state === "closed" ? ["closure"] : []),
          "documents",
          "leaseId",
          "nextRenewalDate",
          "productId",
          "publicId",
          "status",
          "tenantApproval",
          "terms",
          "underwriting",
        ]);
      },
    );

    test.each(ALL_CLOSE_REASONS)(
      "round-trips close reason %s inside closure on a closed row",
      async (reason) => {
        const t = setupStrict();
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
          return (await getGuarantee(ctx, guaranteeId)).closure;
        });

        expect(closure).toEqual({ reason, closedAt: "2026-06-01T00:00:00.000Z", note: "scenario" });
      },
    );

    test.each(ALL_SCORE_TIERS)(
      "round-trips every scoreTier and tenantApproval status literal (tier %s)",
      async (tier) => {
        const t = setupStrict();
        const agencyId = await seedAgency(t, "Agency A", "00000000000101");
        const productId = await seedDefaultProduct(t);

        // A denied tenant never prices, so `negado` only ever lands on a row
        // that was canceled before activation.
        const denied = tier === "negado";
        const underwriting = await t.run(async (ctx) => {
          const tenantId = await insertTenantRow(ctx);
          const leaseId = await insertLeaseRow(ctx, {
            agencyId,
            tenantId,
            publicId: `LSE-${tier}`,
          });
          const guaranteeId = await insertGuaranteeRow(ctx, {
            agencyId,
            leaseId,
            productId,
            publicId: tier,
            status: denied ? "closed" : "drafted",
            ...(denied
              ? { closure: { reason: "canceled_pre_activation" as const, closedAt: CLOSED_AT } }
              : {}),
            underwriting: { score: denied ? 300 : 750, tier },
          });
          return (await getGuarantee(ctx, guaranteeId)).underwriting;
        });

        expect(underwriting).toEqual({ score: denied ? 300 : 750, tier });
      },
    );

    test.each(ALL_TENANT_APPROVAL_STATUSES)(
      "round-trips every scoreTier and tenantApproval status literal (approval %s)",
      async (status) => {
        const t = setupStrict();
        const agencyId = await seedAgency(t, "Agency A", "00000000000101");
        const productId = await seedDefaultProduct(t);

        const tenantApproval = await t.run(async (ctx) => {
          const tenantId = await insertTenantRow(ctx);
          const leaseId = await insertLeaseRow(ctx, {
            agencyId,
            tenantId,
            publicId: `LSE-${status}`,
          });
          const guaranteeId = await insertGuaranteeRow(ctx, {
            agencyId,
            leaseId,
            productId,
            publicId: status,
            status: "drafted",
            tenantApproval: {
              status,
              termApprovedAt: status === "aprovado" ? "2026-02-01T00:00:00.000Z" : null,
            },
          });
          return (await getGuarantee(ctx, guaranteeId)).tenantApproval;
        });

        expect(tenantApproval).toEqual({
          status,
          termApprovedAt: status === "aprovado" ? "2026-02-01T00:00:00.000Z" : null,
        });
      },
    );

    test("round-trips tenantApproval and document status literals through a validated partial patch", async () => {
      const t = setupStrict();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const { guaranteeId } = await seedGuaranteeWithLease(
        t,
        { agencyId, status: "drafted" },
        "S6",
      );

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
    });

    test("a patch with an English document status literal is refused by the validator", async () => {
      const t = setupStrict();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const { guaranteeId } = await seedGuaranteeWithLease(
        t,
        { agencyId, status: "drafted" },
        "S7",
      );

      await expect(
        t.run((ctx) =>
          ctx.db.patch(
            guaranteeId,
            malformed({}, { documents: [{ key: "rentalContract", status: "approved" }] }),
          ),
        ),
      ).rejects.toThrow(/Validator error/);
    });

    test("round-trips underwriting.assessmentId present and absent", async () => {
      const t = setupStrict();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const productId = await seedDefaultProduct(t);

      const { withId, withoutId, assessmentId } = await t.run(async (ctx) => {
        const assessmentId: CreditAnalysisAssessmentId = await ctx.db.insert(
          "creditAnalysisAssessments",
          {
            agencyId,
            subjectType: "tenant",
            subjectHash: "hash-U1",
            policyVersion: "test",
            signalIds: [],
            status: "ok",
            score: 650,
            tier: "regular",
            assessedAt: 1_767_225_600_000,
          },
        );
        const tenantId = await insertTenantRow(ctx);
        const leaseA = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-U1" });
        const leaseB = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-U2" });
        const withIdRow = await insertGuaranteeRow(ctx, {
          agencyId,
          leaseId: leaseA,
          productId,
          publicId: "U1",
          status: "drafted",
          underwriting: { score: 650, tier: "regular", assessmentId },
        });
        const withoutIdRow = await insertGuaranteeRow(ctx, {
          agencyId,
          leaseId: leaseB,
          productId,
          publicId: "U2",
          status: "drafted",
        });
        return {
          withId: (await getGuarantee(ctx, withIdRow)).underwriting,
          withoutId: (await getGuarantee(ctx, withoutIdRow)).underwriting,
          assessmentId,
        };
      });

      expect(withId).toEqual({ score: 650, tier: "regular", assessmentId });
      expect(withoutId).toEqual({ score: 750, tier: "bom" });
    });
  });

  describe("leases, products and guaranteeHistory", () => {
    test("round-trips commercial leases and a pj tenantSnapshot with contactCpf", async () => {
      const t = setupStrict();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");

      const { lease, event } = await t.run(async (ctx) => {
        const tenantId = await ctx.db.insert("tenants", {
          entityType: "pj",
          taxId: "11444777000161",
          fullName: "Tech Solutions Ltda",
          contactCpf: "52998224725",
          email: "contato@techsolutions.example.com",
          phone: "11900000003",
        });
        const leaseId = await insertLeaseRow(ctx, {
          agencyId,
          tenantId,
          publicId: "LSE-COM",
          propertyKind: "commercial",
          rent: {
            rentCents: 500_000,
            condoCents: 80_000,
            otherFeesCents: 20_000,
            totalRentCents: 600_000,
          },
        });
        const eventId = await ctx.db.insert("guaranteeHistory", {
          agencyId,
          guaranteePublicId: "COM",
          at: AT,
          username: "ana",
          message: "Garantia criada",
          tenantSnapshot: {
            entityType: "pj",
            taxId: "11444777000161",
            fullName: "Tech Solutions Ltda",
            email: "contato@techsolutions.example.com",
            phone: "11900000003",
            contactCpf: "52998224725",
          },
        });
        return { lease: await getLease(ctx, leaseId), event: await ctx.db.get(eventId) };
      });

      expect(lease.propertyKind).toBe("commercial");
      expect(lease.rent).toEqual({
        rentCents: 500_000,
        condoCents: 80_000,
        otherFeesCents: 20_000,
        totalRentCents: 600_000,
      });
      expect(event?.tenantSnapshot).toEqual({
        entityType: "pj",
        taxId: "11444777000161",
        fullName: "Tech Solutions Ltda",
        email: "contato@techsolutions.example.com",
        phone: "11900000003",
        contactCpf: "52998224725",
      });
    });

    test("products round-trips effectiveTo and non-null eligibility on every axis", async () => {
      const t = setupStrict();
      const agencyA = await seedAgency(t, "Agency A", "00000000000101");

      const { product, enabledNonDefault } = await t.run(async (ctx) => {
        const productId = await insertProductRow(ctx, {
          slug: "mutav-fianca-sp-commercial",
          enabled: true,
          isDefault: false,
          effectiveTo: "2027-01-01T00:00:00.000Z",
          eligibility: {
            agencyIds: [agencyA],
            regionUFs: ["SP"],
            minTier: "regular",
            propertyKinds: ["commercial"],
          },
        });
        const listed = await ctx.db
          .query("products")
          .withIndex("by_enabled_isDefault", (q) => q.eq("enabled", true).eq("isDefault", false))
          .collect();
        return {
          product: await getProduct(ctx, productId),
          enabledNonDefault: listed.map((p) => p.slug),
        };
      });

      expect(product.effectiveFrom).toBe("2026-01-01T00:00:00.000Z");
      expect(product.effectiveTo).toBe("2027-01-01T00:00:00.000Z");
      expect(product.eligibility).toEqual({
        agencyIds: [agencyA],
        regionUFs: ["SP"],
        minTier: "regular",
        propertyKinds: ["commercial"],
      });
      expect(enabledNonDefault).toEqual(["mutav-fianca-sp-commercial"]);
    });

    const INVALID_LITERALS: {
      table: "guarantees" | "leases" | "products";
      label: string;
      overrides: Record<string, unknown>;
    }[] = [
      { table: "guarantees", label: "guarantees.status ativo", overrides: { status: "ativo" } },
      {
        table: "guarantees",
        label: "guarantees.closure.reason expired",
        overrides: { status: "closed", closure: { reason: "expired", closedAt: CLOSED_AT } },
      },
      {
        table: "guarantees",
        label: "guarantees.documents[].status approved",
        overrides: { documents: [{ key: "rentalContract", status: "approved" }] },
      },
      {
        table: "guarantees",
        label: "guarantees.tenantApproval.status approved",
        overrides: { tenantApproval: { status: "approved", termApprovedAt: null } },
      },
      {
        table: "guarantees",
        label: "guarantees.underwriting.tier excelente",
        overrides: { underwriting: { score: 900, tier: "excelente" } },
      },
      { table: "leases", label: "leases.payer landlord", overrides: { payer: "landlord" } },
      {
        table: "leases",
        label: "leases.propertyKind industrial",
        overrides: { propertyKind: "industrial" },
      },
      {
        table: "products",
        label: "products.eligibility.minTier negado",
        overrides: { eligibility: { ...NO_ELIGIBILITY_RESTRICTION, minTier: "negado" } },
      },
    ];

    test.each(INVALID_LITERALS)(
      "rejects out-of-union literals on guarantees, leases and products ($label)",
      async ({ table, overrides }) => {
        const t = setupStrict();
        const agencyId = await seedAgency(t, "Agency A", "00000000000101");
        const productId = await seedDefaultProduct(t);

        await expect(
          t.run(async (ctx) => {
            const tenantId = await insertTenantRow(ctx);
            if (table === "leases") {
              return ctx.db.insert(
                "leases",
                malformed(leaseDoc({ agencyId, tenantId, publicId: "LSE-BAD" }), overrides),
              );
            }
            if (table === "products") {
              return ctx.db.insert(
                "products",
                malformed(productDoc({ slug: "bad", enabled: true, isDefault: false }), overrides),
              );
            }
            const leaseId = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-BAD" });
            return ctx.db.insert(
              "guarantees",
              malformed(
                guaranteeDoc({ agencyId, leaseId, productId, publicId: "BAD", status: "drafted" }),
                overrides,
              ),
            );
          }),
        ).rejects.toThrow(/Validator error/);
      },
    );

    test("the app schema accepts the same out-of-union literal, which is why conformance runs strict", async () => {
      const t = setup();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const productId = await seedDefaultProduct(t);

      const status = await t.run(async (ctx) => {
        const tenantId = await insertTenantRow(ctx);
        const leaseId = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-LAX" });
        const id = await ctx.db.insert(
          "guarantees",
          malformed(
            guaranteeDoc({ agencyId, leaseId, productId, publicId: "LAX", status: "drafted" }),
            { status: "ativo" },
          ),
        );
        return (await getGuarantee(ctx, id)).status;
      });

      expect(status).toBe("ativo");
    });
  });

  describe("id tables", () => {
    test("rejects an openGuaranteeId or leaseId from the wrong table", async () => {
      const t = setupStrict();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const productId = await seedDefaultProduct(t);

      await expect(
        t.run(async (ctx) => {
          const tenantId = await insertTenantRow(ctx);
          return ctx.db.insert(
            "leases",
            malformed(leaseDoc({ agencyId, tenantId, publicId: "LSE-WRONG" }), {
              openGuaranteeId: agencyId,
            }),
          );
        }),
      ).rejects.toThrow(/Validator error: Expected one of id, null/);

      await expect(
        t.run(async (ctx) => {
          const tenantId = await insertTenantRow(ctx);
          const leaseId = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-OK" });
          return ctx.db.insert(
            "guarantees",
            malformed(
              guaranteeDoc({ agencyId, leaseId, productId, publicId: "WRONG", status: "drafted" }),
              { leaseId: tenantId },
            ),
          );
        }),
      ).rejects.toThrow(/Expected ID for table "leases"/);
    });
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

  test("stores the ruim/plus snapshot for rent 250_000 with capacity ceiling 7_500_000", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "drafted", tier: "ruim", plan: "plus", rentCents: 250_000 },
      "P8",
    );

    const row = await t.run((ctx) => getGuarantee(ctx, guaranteeId));

    expect(row.terms).toEqual({
      productSlug: "mutav-fianca",
      plan: "plus",
      rentCents: 250_000,
      feeCents: 38_780,
      taxaFeeCents: 37_500,
      prestamistaFeeCents: 1_280,
      oneTimeActivationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaCommissionRate: 0.25,
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      coverageCeilingCents: 7_500_000,
      exitCostCapCents: 1_500_000,
      appliedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(row.capacity).toEqual({
      ceilingCents: 7_500_000,
      availableCents: 7_500_000,
      reservedCents: 0,
    });
    expect(row.underwriting).toEqual({ score: 750, tier: "ruim" });
  });

  test("persists regular and ruim underwriting with their own priced ceilings and keeps assessmentId across a patch", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const regular = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "drafted", tier: "regular", rentCents: 200_000 },
      "T-REG",
    );
    const ruim = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "drafted", tier: "ruim", rentCents: 300_000 },
      "T-RUIM",
    );

    const { regularRow, ruimRow, assessmentId } = await t.run(async (ctx) => {
      const assessmentId: CreditAnalysisAssessmentId = await ctx.db.insert(
        "creditAnalysisAssessments",
        {
          agencyId,
          subjectType: "tenant",
          subjectHash: "hash-T-REG",
          policyVersion: "test",
          signalIds: [],
          status: "ok",
          score: 650,
          tier: "regular",
          assessedAt: 1_767_225_600_000,
        },
      );
      await ctx.db.patch(regular.guaranteeId, {
        underwriting: { score: 650, tier: "regular", assessmentId },
      });
      const { guard } = await transitionRow(ctx, regular.guaranteeId, "active", {
        activatedAt: "2026-02-01T00:00:00.000Z",
      });
      if (!guard.success) throw new Error("drafted -> active must be legal");
      return {
        regularRow: await getGuarantee(ctx, regular.guaranteeId),
        ruimRow: await getGuarantee(ctx, ruim.guaranteeId),
        assessmentId,
      };
    });

    expect(regularRow.status).toBe("active");
    expect(regularRow.underwriting).toEqual({ score: 650, tier: "regular", assessmentId });
    expect(regularRow.terms.taxaFeeCents).toBe(24_000);
    expect(regularRow.terms.feeCents).toBe(24_000);
    expect(regularRow.terms.coverageCeilingCents).toBe(6_000_000);
    expect(regularRow.terms.exitCostCapCents).toBe(1_200_000);
    expect(regularRow.capacity).toEqual({
      ceilingCents: 6_000_000,
      availableCents: 6_000_000,
      reservedCents: 0,
    });

    expect(ruimRow.underwriting).toEqual({ score: 750, tier: "ruim" });
    expect(ruimRow.terms.taxaFeeCents).toBe(45_000);
    expect(ruimRow.terms.coverageCeilingCents).toBe(9_000_000);
    expect(ruimRow.terms.exitCostCapCents).toBe(1_800_000);
    expect(ruimRow.capacity).toEqual({
      ceilingCents: 9_000_000,
      availableCents: 9_000_000,
      reservedCents: 0,
    });
  });

  test("prices a commercial lease on rentCents alone while the lease bundle carries condo and fees", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const productId = await seedDefaultProduct(t);

    const { lease, guarantee } = await t.run(async (ctx) => {
      const product = await getProduct(ctx, productId);
      const tenantId = await insertTenantRow(ctx);
      const leaseId = await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-COM",
        propertyKind: "commercial",
        rent: {
          rentCents: 100_000,
          condoCents: 30_000,
          otherFeesCents: 5_000,
          totalRentCents: 135_000,
        },
      });
      const lease = await getLease(ctx, leaseId);
      const priced = priceGuarantee(
        {
          rentCents: lease.rent.rentCents,
          tier: "bom",
          plan: "basic",
          productSlug: product.slug,
          appliedAt: AT,
        },
        product.terms,
      );
      const guaranteeId = await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId,
        productId,
        publicId: "COM",
        status: "drafted",
        terms: priced.terms,
        capacity: priced.capacity,
      });
      await ctx.db.patch(leaseId, { openGuaranteeId: guaranteeId });
      return {
        lease: await getLease(ctx, leaseId),
        guarantee: await getGuarantee(ctx, guaranteeId),
      };
    });

    expect(lease.propertyKind).toBe("commercial");
    expect(lease.rent.totalRentCents).toBe(135_000);
    expect(guarantee.terms.rentCents).toBe(100_000);
    expect(guarantee.terms.taxaFeeCents).toBe(9_000);
    expect(guarantee.terms.coverageCeilingCents).toBe(3_000_000);
    expect(guarantee.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 3_000_000,
      reservedCents: 0,
    });
  });

  test("capacity invariant sweep (fixture guard): every seeded row has available + reserved = ceiling = terms.coverageCeilingCents", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    await seedOneGuaranteePerState(t, agencyId);
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: "cover_committed", availableCents: 10_000 },
      "P4",
    );
    await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: "active",
        tier: "regular",
        rentCents: 200_000,
        availableCents: 5_500_000,
      },
      "P4-REG",
    );

    const rows = await t.run(async (ctx) => {
      const collected: Guarantee[] = [];
      for (const state of ALL_STATES)
        collected.push(...(await guaranteesForAgencyStatus(ctx, agencyId, state)));
      return collected.map((g) => ({
        publicId: g.publicId,
        sumMatchesCeiling:
          g.capacity.availableCents + g.capacity.reservedCents === g.capacity.ceilingCents,
        ceilingMatchesTerms: g.capacity.ceilingCents === g.terms.coverageCeilingCents,
        reservedCents: g.capacity.reservedCents,
      }));
    });

    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.sumMatchesCeiling && r.ceilingMatchesTerms)).toBe(true);
    expect(rows.find((r) => r.publicId === "P4")?.reservedCents).toBe(2_990_000);
    expect(rows.find((r) => r.publicId === "P4-REG")?.reservedCents).toBe(500_000);
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
      const before = await getGuarantee(ctx, guaranteeId);
      await ctx.db.patch(guaranteeId, {
        capacity: {
          ceilingCents: before.capacity.ceilingCents,
          availableCents: before.capacity.availableCents - 300_000,
          reservedCents: before.capacity.reservedCents + 300_000,
        },
      });
      return getGuarantee(ctx, guaranteeId);
    });

    expect(row.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 2_700_000,
      reservedCents: 300_000,
    });
    expect(row.capacity.availableCents + row.capacity.reservedCents).toBe(
      row.capacity.ceilingCents,
    );
    expect(row.terms).toEqual(BASIC_BOM_TERMS);
  });

  test("editing the product after pricing never rewrites an existing guarantee's terms", async () => {
    const t = setup();
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    const sold = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: "2026-01-10T12:00:00.000Z" },
      "P6",
    );

    const { product, soldRow, newRow } = await t.run(async (ctx) => {
      await ctx.db.patch(sold.productId, {
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
      const product = await getProduct(ctx, sold.productId);
      const tenantId = await insertTenantRow(ctx);
      const leaseId = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-P6-NEW" });
      const priced = priceGuarantee(
        {
          rentCents: 100_000,
          tier: "bom",
          plan: "basic",
          productSlug: product.slug,
          appliedAt: "2026-03-01T00:00:00.000Z",
        },
        product.terms,
      );
      const newId = await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId,
        productId: sold.productId,
        publicId: "P6-NEW",
        status: "drafted",
        terms: priced.terms,
        capacity: priced.capacity,
      });
      await ctx.db.patch(leaseId, { openGuaranteeId: newId });
      return {
        product,
        soldRow: await getGuarantee(ctx, sold.guaranteeId),
        newRow: await getGuarantee(ctx, newId),
      };
    });

    expect(product.terms.tierRate.bom).toBe(0.2);
    expect(soldRow.terms).toEqual(BASIC_BOM_TERMS);
    expect(soldRow.capacity.ceilingCents).toBe(3_000_000);
    expect(newRow.productId).toBe(soldRow.productId);
    expect(newRow.terms).toEqual({
      productSlug: "mutav-fianca",
      plan: "basic",
      rentCents: 100_000,
      feeCents: 20_000,
      taxaFeeCents: 20_000,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 50_000,
      commissionRate: 0.05,
      prestamistaCommissionRate: 0.5,
      coverageCeilingMultiplier: 24,
      exitCostMultiplier: 3,
      coverageCeilingCents: 2_400_000,
      exitCostCapCents: 300_000,
      appliedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(newRow.capacity.ceilingCents).toBe(2_400_000);

    // The production reader derives commission from the snapshot, so the sold
    // guarantee still owes 135 (9_000 × 0.015), not 450 at the edited rate.
    const commission = await asUser.query(api.guarantees.useCases.listForCommissionByMonth, {
      agencyId,
      periodMonth: "2026-01",
    });
    expect(commission).toEqual([
      {
        guaranteeId: "P6",
        // Blank: the fixture writes no creation event, so there is no
        // agency-submitted snapshot to take the name from.
        tenantName: "",
        rentCents: 100_000,
        commissionCents: 135,
        installment: "1/12",
        activatedAt: "2026-01-10T12:00:00.000Z",
      },
    ]);
  });

  test("a reprice replaces the terms snapshot and raises the ceiling while carrying the reserved leg forward", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId, productId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: AT },
      "RP1",
    );

    const row = await t.run(async (ctx) => {
      const before = await getGuarantee(ctx, guaranteeId);
      await ctx.db.patch(guaranteeId, {
        capacity: {
          ceilingCents: before.capacity.ceilingCents,
          availableCents: before.capacity.availableCents - 300_000,
          reservedCents: before.capacity.reservedCents + 300_000,
        },
      });
      const reserved = await getGuarantee(ctx, guaranteeId);
      const product = await getProduct(ctx, productId);
      const repriced = priceGuarantee(
        {
          rentCents: 120_000,
          tier: "bom",
          plan: "basic",
          productSlug: product.slug,
          appliedAt: "2027-01-01T00:00:00.000Z",
        },
        product.terms,
      );
      await ctx.db.patch(guaranteeId, {
        terms: repriced.terms,
        capacity: {
          ceilingCents: repriced.capacity.ceilingCents,
          availableCents: repriced.capacity.ceilingCents - reserved.capacity.reservedCents,
          reservedCents: reserved.capacity.reservedCents,
        },
      });
      return getGuarantee(ctx, guaranteeId);
    });

    expect(row.terms).toEqual({
      productSlug: "mutav-fianca",
      plan: "basic",
      rentCents: 120_000,
      feeCents: 10_800,
      taxaFeeCents: 10_800,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaCommissionRate: 0.25,
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      coverageCeilingCents: 3_600_000,
      exitCostCapCents: 720_000,
      appliedAt: "2027-01-01T00:00:00.000Z",
    });
    expect(row.capacity).toEqual({
      ceilingCents: 3_600_000,
      availableCents: 3_300_000,
      reservedCents: 300_000,
    });
    expect(row.status).toBe("active");
    expect(row.activatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(row.leaseId).toBe(leaseId);
    expect(row.productId).toBe(productId);
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
      rows: await guaranteesOnLease(ctx, leaseId),
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
      rows: await guaranteesOnLease(ctx, leaseId),
    }));

    expect(lease.openGuaranteeId).toBe(null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("closed");
    expect(rows[0]?.closure).toEqual({
      reason: "end_of_lease",
      closedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  test("a lease with only closed lives has a null pointer and accepts a new guarantee", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { leaseId, productId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "closed" },
      "O6-1",
    );

    const { rows, lease, accepts } = await t.run(async (ctx) => {
      await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId,
        productId,
        publicId: "O6-2",
        status: "closed",
        closure: { reason: "canceled_pre_activation", closedAt: "2026-07-01T00:00:00.000Z" },
      });
      const lease = await getLease(ctx, leaseId);
      return {
        rows: await guaranteesOnLease(ctx, leaseId),
        lease,
        accepts: assertLeaseAcceptsGuarantee(lease),
      };
    });

    expect(rows.map((r) => r.status)).toEqual(["closed", "closed"]);
    expect(rows.map((r) => r.closure?.reason).sort()).toEqual([
      "canceled_pre_activation",
      "end_of_lease",
    ]);
    expect(lease.openGuaranteeId).toBe(null);
    expect(dataOf(accepts)).toEqual({ leaseId });
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

      const rows = await guaranteesOnLease(ctx, leaseId);
      const lease = await getLease(ctx, leaseId);
      if (lease.openGuaranteeId === null) throw new Error("pointer unexpectedly null");
      const pointed = await getGuarantee(ctx, lease.openGuaranteeId);
      return { rows, lease, pointed, openId };
    });

    expect(rows).toHaveLength(3);
    expect(publicIds(rows.filter((r) => r.status !== "closed"))).toEqual(["O4-3"]);
    expect(
      rows
        .filter((r) => r.status === "closed")
        .map((r) => r.closure?.reason)
        .sort(),
    ).toEqual(["canceled_pre_activation", "end_of_lease"]);
    expect(lease.openGuaranteeId).toBe(openId);
    expect(pointed.publicId).toBe("O4-3");
    expect(pointed.status).toBe("active");
    expect(pointed.leaseId).toBe(leaseId);
    expect(pointed.agencyId).toBe(agencyId);
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

  test("guard-then-insert refuses a second open row while the pointer is set and admits one after close", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId, productId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active" },
      "GI-1",
    );

    const tryInsert = async (ctx: MutationCtx, publicId: string) => {
      const lease = await getLease(ctx, leaseId);
      const guard = assertLeaseAcceptsGuarantee(lease);
      if (guard.success) {
        const id = await insertGuaranteeRow(ctx, {
          agencyId,
          leaseId,
          productId,
          publicId,
          status: "drafted",
        });
        await ctx.db.patch(leaseId, { openGuaranteeId: id });
      }
      return guard;
    };

    const { refused, afterRefusal, admitted, afterAdmission } = await t.run(async (ctx) => {
      const refused = await tryInsert(ctx, "GI-2");
      const afterRefusal = {
        rows: publicIds(await guaranteesOnLease(ctx, leaseId)),
        pointer: (await getLease(ctx, leaseId)).openGuaranteeId,
      };
      await closeGuaranteeRow(ctx, { guaranteeId, leaseId, reason: "end_of_lease" });
      const admitted = await tryInsert(ctx, "GI-3");
      const rows = await guaranteesOnLease(ctx, leaseId);
      const lease = await getLease(ctx, leaseId);
      return {
        refused,
        afterRefusal,
        admitted,
        afterAdmission: {
          rows: publicIds(rows),
          open: publicIds(rows.filter((r) => r.status !== "closed")),
          pointerIsNew: lease.openGuaranteeId === rows.find((r) => r.publicId === "GI-3")?._id,
        },
      };
    });

    expect(errorOf(refused)).toEqual({ code: "LEASE_HAS_OPEN_GUARANTEE" });
    expect(afterRefusal).toEqual({ rows: ["GI-1"], pointer: guaranteeId });
    expect(dataOf(admitted)).toEqual({ leaseId });
    expect(afterAdmission).toEqual({ rows: ["GI-1", "GI-3"], open: ["GI-3"], pointerIsNew: true });
  });

  test("canceling a draft nulls the pointer with activatedAt still null and frees the lease for a new draft", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId, productId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "drafted" },
      "CD-1",
    );

    const { denied, pointerAfterDenied, canceled, accepts, lease, rows } = await t.run(
      async (ctx) => {
        const denied = await closeRow(ctx, { guaranteeId, leaseId, reason: "end_of_lease" });
        const canceled = await closeRow(ctx, {
          guaranteeId,
          leaseId,
          reason: "canceled_pre_activation",
        });
        const accepts = assertLeaseAcceptsGuarantee(canceled.lease);
        if (accepts.success) {
          const nextId = await insertGuaranteeRow(ctx, {
            agencyId,
            leaseId,
            productId,
            publicId: "CD-2",
            status: "drafted",
          });
          await ctx.db.patch(leaseId, { openGuaranteeId: nextId });
        }
        return {
          denied: denied.guard,
          pointerAfterDenied: denied.lease.openGuaranteeId,
          canceled,
          accepts,
          lease: await getLease(ctx, leaseId),
          rows: await guaranteesOnLease(ctx, leaseId),
        };
      },
    );

    expect(errorOf(denied)).toEqual({ code: "REASON_NOT_ALLOWED_FROM_STATE" });
    expect(pointerAfterDenied).toBe(guaranteeId);
    expect(dataOf(canceled.guard)).toEqual({ from: "drafted", reason: "canceled_pre_activation" });
    expect(canceled.row.status).toBe("closed");
    expect(canceled.row.activatedAt).toBe(null);
    expect(canceled.row.closure).toEqual({
      reason: "canceled_pre_activation",
      closedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(canceled.lease.openGuaranteeId).toBe(null);
    expect(dataOf(accepts)).toEqual({ leaseId });
    expect(publicIds(rows)).toEqual(["CD-1", "CD-2"]);
    expect(rows.find((r) => r.publicId === "CD-2")?._id).toBe(lease.openGuaranteeId);
  });

  test("pointer sweep: null iff no non-closed row, and the pointed row is open and on the same lease", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const seeded = await seedOneGuaranteePerState(t, agencyId);
    const twoClosed = await seedGuaranteeWithLease(t, { agencyId, status: "closed" }, "TC-1");

    const { clean, cleanClosure, planted } = await t.run(async (ctx) => {
      await insertGuaranteeRow(ctx, {
        agencyId,
        leaseId: twoClosed.leaseId,
        productId: twoClosed.productId,
        publicId: "TC-2",
        status: "closed",
        closure: { reason: "rescission", closedAt: "2026-07-01T00:00:00.000Z" },
      });
      const clean = await pointerViolations(ctx, agencyId);
      const cleanClosure = await closureMismatches(ctx, agencyId);

      const closed = seededFor(seeded, "closed");
      await ctx.db.patch(closed.leaseId, { openGuaranteeId: closed.guaranteeId });
      await ctx.db.patch(seededFor(seeded, "drafted").leaseId, {
        openGuaranteeId: seededFor(seeded, "active").guaranteeId,
      });
      await ctx.db.patch(seededFor(seeded, "in_arrears").leaseId, { openGuaranteeId: null });
      return { clean, cleanClosure, planted: await pointerViolations(ctx, agencyId) };
    });

    expect(clean).toEqual([]);
    expect(cleanClosure).toEqual([]);
    expect(planted).toEqual([
      { lease: "LSE-closed", problem: "pointer targets a closed guarantee" },
      { lease: "LSE-drafted", problem: "pointer targets another lease's guarantee" },
      { lease: "LSE-in_arrears", problem: "open row without pointer" },
    ]);
  });

  test("every non-null lease pointer resolves to a non-closed guarantee on that same lease and closure presence tracks the closed state", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const seeded = await seedOneGuaranteePerState(t, agencyId);

    const { resolved, mismatchesAfterBadClose } = await t.run(async (ctx) => {
      const leases = await ctx.db
        .query("leases")
        .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
        .collect();
      const resolved: { lease: string; pointsTo: string | null }[] = [];
      for (const lease of leases) {
        const pointed = lease.openGuaranteeId ? await ctx.db.get(lease.openGuaranteeId) : null;
        if (pointed && (pointed.leaseId !== lease._id || pointed.status === "closed")) {
          throw new Error(`lease ${lease.publicId} pointer violates the invariant`);
        }
        resolved.push({ lease: lease.publicId, pointsTo: pointed?.publicId ?? null });
      }
      // A close that forgets the closure block is the drift the sweep exists for.
      await ctx.db.patch(seededFor(seeded, "active").guaranteeId, { status: "closed" });
      return {
        resolved: resolved.sort((a, b) => a.lease.localeCompare(b.lease)),
        mismatchesAfterBadClose: await closureMismatches(ctx, agencyId),
      };
    });

    expect(resolved).toEqual([
      { lease: "LSE-active", pointsTo: "active" },
      { lease: "LSE-closed", pointsTo: null },
      { lease: "LSE-cover_committed", pointsTo: "cover_committed" },
      { lease: "LSE-default_verified", pointsTo: "default_verified" },
      { lease: "LSE-drafted", pointsTo: "drafted" },
      { lease: "LSE-in_arrears", pointsTo: "in_arrears" },
      { lease: "LSE-in_eviction", pointsTo: "in_eviction" },
    ]);
    expect(mismatchesAfterBadClose).toEqual(["active"]);
  });
});

describe("machine + db composition — guard before patch", () => {
  test("applies a legal transition and leaves the row (and its terms) untouched on an illegal one", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId } = await seedGuaranteeWithLease(t, { agencyId, status: "drafted" }, "M1");

    const { legal, illegal, final } = await t.run(async (ctx) => {
      const legal = await transitionRow(ctx, guaranteeId, "active", {
        activatedAt: "2026-02-01T00:00:00.000Z",
      });
      const illegal = await transitionRow(ctx, guaranteeId, "default_verified");
      return { legal: legal.guard, illegal: illegal.guard, final: illegal.row };
    });

    expect(dataOf(legal)).toEqual({ from: "drafted", to: "active" });
    expect(errorOf(illegal)).toEqual({ code: "ILLEGAL_TRANSITION" });
    expect(final.status).toBe("active");
    expect(final.activatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(final.terms).toEqual(BASIC_BOM_TERMS);
    expect(final.capacity).toEqual(FULL_CAPACITY);
  });

  test("a closed row rejects both a transition and a re-close and keeps its original closure", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "closed" },
      "M2",
    );

    const { t1, c1, row, lease, closedBucket, activeBucket } = await t.run(async (ctx) => {
      const t1 = await transitionRow(ctx, guaranteeId, "active", {
        activatedAt: "2026-02-01T00:00:00.000Z",
      });
      const c1 = await closeRow(ctx, { guaranteeId, leaseId, reason: "rescission" });
      return {
        t1: t1.guard,
        c1: c1.guard,
        row: c1.row,
        lease: c1.lease,
        closedBucket: publicIds(await guaranteesForAgencyStatus(ctx, agencyId, "closed")),
        activeBucket: publicIds(await guaranteesForAgencyStatus(ctx, agencyId, "active")),
      };
    });

    expect(errorOf(t1)).toEqual({ code: "TERMINAL_STATE" });
    expect(errorOf(c1)).toEqual({ code: "TERMINAL_STATE" });
    expect(row.status).toBe("closed");
    expect(row.activatedAt).toBe(null);
    expect(row.closure).toEqual({ reason: "end_of_lease", closedAt: "2026-06-01T00:00:00.000Z" });
    expect(lease.openGuaranteeId).toBe(null);
    expect(closedBucket).toEqual(["M2"]);
    expect(activeBucket).toEqual([]);
  });

  test("assertClose gates the reason by the stored state before the close patch lands", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: AT },
      "M3",
    );

    const { denied, allowed } = await t.run(async (ctx) => {
      const denied = await closeRow(ctx, {
        guaranteeId,
        leaseId,
        reason: "canceled_pre_activation",
      });
      const allowed = await closeRow(ctx, { guaranteeId, leaseId, reason: "end_of_lease" });
      return { denied, allowed };
    });

    expect(errorOf(denied.guard)).toEqual({ code: "REASON_NOT_ALLOWED_FROM_STATE" });
    expect(denied.row.status).toBe("active");
    expect(denied.row.closure).toBeUndefined();
    expect(denied.lease.openGuaranteeId).toBe(guaranteeId);
    expect(dataOf(allowed.guard)).toEqual({ from: "active", reason: "end_of_lease" });
    expect(allowed.row.status).toBe("closed");
    expect(allowed.row.closure).toEqual({
      reason: "end_of_lease",
      closedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(allowed.lease.openGuaranteeId).toBe(null);
  });

  test("walks the eviction path end to end: pointer held through every insured state, closure and null pointer only at the terminal close", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "drafted" },
      "EV",
    );

    const { trail, final, lease } = await t.run(async (ctx) => {
      const trail: {
        status: GuaranteeState;
        hasClosure: boolean;
        pointerHeld: boolean;
        reservedCents: number;
      }[] = [];
      const record = async (guard: Result<unknown, unknown>) => {
        if (!guard.success) throw new Error("every hop on the eviction path must be legal");
        const row = await getGuarantee(ctx, guaranteeId);
        const lease = await getLease(ctx, leaseId);
        trail.push({
          status: row.status,
          hasClosure: row.closure !== undefined,
          pointerHeld: lease.openGuaranteeId === guaranteeId,
          reservedCents: row.capacity.reservedCents,
        });
      };

      await record(
        (
          await transitionRow(ctx, guaranteeId, "active", {
            activatedAt: "2026-02-01T00:00:00.000Z",
          })
        ).guard,
      );
      await record((await transitionRow(ctx, guaranteeId, "in_arrears")).guard);
      await record((await transitionRow(ctx, guaranteeId, "default_verified")).guard);
      const beforeCover = await getGuarantee(ctx, guaranteeId);
      await record(
        (
          await transitionRow(ctx, guaranteeId, "cover_committed", {
            capacity: {
              ceilingCents: beforeCover.capacity.ceilingCents,
              availableCents: beforeCover.capacity.availableCents - 300_000,
              reservedCents: beforeCover.capacity.reservedCents + 300_000,
            },
          })
        ).guard,
      );
      await record((await transitionRow(ctx, guaranteeId, "in_eviction")).guard);
      await record((await closeRow(ctx, { guaranteeId, leaseId, reason: "eviction" })).guard);

      return {
        trail,
        final: await getGuarantee(ctx, guaranteeId),
        lease: await getLease(ctx, leaseId),
      };
    });

    expect(trail).toEqual([
      { status: "active", hasClosure: false, pointerHeld: true, reservedCents: 0 },
      { status: "in_arrears", hasClosure: false, pointerHeld: true, reservedCents: 0 },
      { status: "default_verified", hasClosure: false, pointerHeld: true, reservedCents: 0 },
      { status: "cover_committed", hasClosure: false, pointerHeld: true, reservedCents: 300_000 },
      { status: "in_eviction", hasClosure: false, pointerHeld: true, reservedCents: 300_000 },
      { status: "closed", hasClosure: true, pointerHeld: false, reservedCents: 300_000 },
    ]);
    expect(final.closure).toEqual({ reason: "eviction", closedAt: "2026-06-01T00:00:00.000Z" });
    expect(final.activatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(final.terms).toEqual(BASIC_BOM_TERMS);
    expect(final.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 2_700_000,
      reservedCents: 300_000,
    });
    expect(lease.openGuaranteeId).toBe(null);
  });

  test("dispute_reversal close from cover_committed restores the reserved leg to available and nulls the pointer", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const committed = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "cover_committed", activatedAt: AT, availableCents: 2_700_000 },
      "DR-CC",
    );
    const verified = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "default_verified", activatedAt: AT },
      "DR-DV",
    );
    const active = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: AT, availableCents: 2_900_000 },
      "DR-ACT",
    );

    const { fromCommitted, fromVerified, fromActive } = await t.run(async (ctx) => {
      const release = (row: Guarantee): GuaranteeCapacity => ({
        ceilingCents: row.capacity.ceilingCents,
        availableCents: row.capacity.availableCents + row.capacity.reservedCents,
        reservedCents: 0,
      });
      const fromCommitted = await closeRow(ctx, {
        guaranteeId: committed.guaranteeId,
        leaseId: committed.leaseId,
        reason: "dispute_reversal",
        capacity: release(await getGuarantee(ctx, committed.guaranteeId)),
      });
      const fromVerified = await closeRow(ctx, {
        guaranteeId: verified.guaranteeId,
        leaseId: verified.leaseId,
        reason: "dispute_reversal",
        capacity: release(await getGuarantee(ctx, verified.guaranteeId)),
      });
      const fromActive = await closeRow(ctx, {
        guaranteeId: active.guaranteeId,
        leaseId: active.leaseId,
        reason: "dispute_reversal",
        capacity: release(await getGuarantee(ctx, active.guaranteeId)),
      });
      return { fromCommitted, fromVerified, fromActive };
    });

    expect(dataOf(fromCommitted.guard)).toEqual({
      from: "cover_committed",
      reason: "dispute_reversal",
    });
    expect(fromCommitted.row.status).toBe("closed");
    expect(fromCommitted.row.closure).toEqual({
      reason: "dispute_reversal",
      closedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(fromCommitted.row.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 3_000_000,
      reservedCents: 0,
    });
    expect(fromCommitted.lease.openGuaranteeId).toBe(null);

    expect(dataOf(fromVerified.guard)).toEqual({
      from: "default_verified",
      reason: "dispute_reversal",
    });
    expect(fromVerified.row.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 3_000_000,
      reservedCents: 0,
    });
    expect(fromVerified.lease.openGuaranteeId).toBe(null);

    expect(errorOf(fromActive.guard)).toEqual({ code: "REASON_NOT_ALLOWED_FROM_STATE" });
    expect(fromActive.row.status).toBe("active");
    expect(fromActive.row.closure).toBeUndefined();
    expect(fromActive.row.capacity).toEqual({
      ceilingCents: 3_000_000,
      availableCents: 2_900_000,
      reservedCents: 100_000,
    });
    expect(fromActive.lease.openGuaranteeId).toBe(active.guaranteeId);
  });

  test("curing arrears back to active leaves activatedAt, closure and the lease pointer untouched", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const arrears = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "in_arrears", activatedAt: "2026-02-01T00:00:00.000Z" },
      "CURE-1",
    );
    const verified = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "default_verified", activatedAt: "2026-03-01T00:00:00.000Z" },
      "CURE-2",
    );

    const { cured, relapsed, curedFromVerified, lease1, lease2 } = await t.run(async (ctx) => {
      const cured = await transitionRow(ctx, arrears.guaranteeId, "active");
      const relapsed = await transitionRow(ctx, arrears.guaranteeId, "in_arrears");
      const curedFromVerified = await transitionRow(ctx, verified.guaranteeId, "active");
      return {
        cured,
        relapsed,
        curedFromVerified,
        lease1: await getLease(ctx, arrears.leaseId),
        lease2: await getLease(ctx, verified.leaseId),
      };
    });

    expect(dataOf(cured.guard)).toEqual({ from: "in_arrears", to: "active" });
    expect(cured.row.status).toBe("active");
    expect(cured.row.activatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(cured.row.closure).toBeUndefined();
    expect(cured.row.capacity).toEqual(FULL_CAPACITY);
    expect(cured.row.terms).toEqual(BASIC_BOM_TERMS);

    expect(dataOf(relapsed.guard)).toEqual({ from: "active", to: "in_arrears" });
    expect(relapsed.row.status).toBe("in_arrears");
    expect(relapsed.row.activatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(lease1.openGuaranteeId).toBe(arrears.guaranteeId);

    expect(dataOf(curedFromVerified.guard)).toEqual({ from: "default_verified", to: "active" });
    expect(curedFromVerified.row.status).toBe("active");
    expect(curedFromVerified.row.activatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(curedFromVerified.row.closure).toBeUndefined();
    expect(lease2.openGuaranteeId).toBe(verified.guaranteeId);
  });

  test("round-trips tenantApproval reprovado without touching status or the lease pointer", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "drafted" },
      "TA",
    );

    const { row, lease } = await t.run(async (ctx) => {
      await ctx.db.patch(guaranteeId, {
        tenantApproval: { status: "reprovado", termApprovedAt: null },
      });
      return { row: await getGuarantee(ctx, guaranteeId), lease: await getLease(ctx, leaseId) };
    });

    expect(row.tenantApproval).toEqual({ status: "reprovado", termApprovedAt: null });
    expect(row.status).toBe("drafted");
    expect(row.closure).toBeUndefined();
    expect(lease.openGuaranteeId).toBe(guaranteeId);
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

  test("by_status iterated over INSURED_STATES returns exactly the in-force rows and its complement the rest", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    await seedOneGuaranteePerState(t, agencyId);

    const { insured, uninsured } = await t.run(async (ctx) => {
      const forStates = async (states: readonly GuaranteeState[]) => {
        const collected: Guarantee[] = [];
        for (const state of states) {
          collected.push(
            ...(await ctx.db
              .query("guarantees")
              .withIndex("by_status", (q) => q.eq("status", state))
              .collect()),
          );
        }
        return collected;
      };
      const complement = ALL_STATES.filter((s) => !INSURED_STATES.includes(s));
      return { insured: await forStates(INSURED_STATES), uninsured: await forStates(complement) };
    });

    expect([...INSURED_STATES]).toEqual([
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
    ]);
    expect(publicIds(insured)).toEqual([
      "active",
      "cover_committed",
      "default_verified",
      "in_arrears",
      "in_eviction",
    ]);
    expect(publicIds(uninsured)).toEqual(["closed", "drafted"]);
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

    const { active, drafted, closed } = await t.run(async (ctx) => ({
      active: await guaranteesForAgencyStatus(ctx, agencyA, "active"),
      drafted: await guaranteesForAgencyStatus(ctx, agencyA, "drafted"),
      closed: await guaranteesForAgencyStatus(ctx, agencyA, "closed"),
    }));

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

  function renewalWindow(ctx: MutationCtx, agencyId: AgencyId, status: GuaranteeState) {
    return ctx.db
      .query("guarantees")
      .withIndex("by_agency_status_nextRenewalDate", (q) =>
        q
          .eq("agencyId", agencyId)
          .eq("status", status)
          .gte("nextRenewalDate", "2026-03-01")
          .lte("nextRenewalDate", "2026-05-01"),
      )
      .collect();
  }

  test("by_agency_status_nextRenewalDate serves a renewal window in ascending date order", async () => {
    const t = setup();
    const { agencyA } = await seedRenewalFixtures(t);

    const inWindow = await t.run(async (ctx) =>
      (await renewalWindow(ctx, agencyA, "active")).map((r) => r.publicId),
    );

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

  test("by_agency_status and by_agency_status_nextRenewalDate follow a status patch and a renewal-date patch", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const r1 = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: AT, nextRenewalDate: "2026-04-01" },
      "R1",
    );
    const r2 = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", activatedAt: AT, nextRenewalDate: "2026-04-15" },
      "R2",
    );

    const { before, after } = await t.run(async (ctx) => {
      const before = {
        active: publicIds(await guaranteesForAgencyStatus(ctx, agencyId, "active")),
        closed: publicIds(await guaranteesForAgencyStatus(ctx, agencyId, "closed")),
        window: (await renewalWindow(ctx, agencyId, "active")).map((r) => r.publicId),
      };
      await closeRow(ctx, {
        guaranteeId: r1.guaranteeId,
        leaseId: r1.leaseId,
        reason: "end_of_lease",
      });
      await ctx.db.patch(r2.guaranteeId, { nextRenewalDate: "2026-09-01" });
      const after = {
        active: publicIds(await guaranteesForAgencyStatus(ctx, agencyId, "active")),
        closed: publicIds(await guaranteesForAgencyStatus(ctx, agencyId, "closed")),
        window: (await renewalWindow(ctx, agencyId, "active")).map((r) => r.publicId),
        closedWindow: (await renewalWindow(ctx, agencyId, "closed")).map((r) => r.publicId),
      };
      return { before, after };
    });

    expect(before).toEqual({ active: ["R1", "R2"], closed: [], window: ["R1", "R2"] });
    expect(after).toEqual({ active: ["R2"], closed: ["R1"], window: [], closedWindow: ["R1"] });
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

  test("leases.by_publicId under a cross-agency publicId collision returns both rows and .unique() throws", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    const a = await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "L-DUP");
    const b = await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "drafted" }, "L-DUP");

    const matches = await t.run((ctx) =>
      ctx.db
        .query("leases")
        .withIndex("by_publicId", (q) => q.eq("publicId", "LSE-L-DUP"))
        .collect(),
    );

    expect(matches).toHaveLength(2);
    expect(matches.find((l) => l.agencyId === agencyA)?._id).toBe(a.leaseId);
    expect(matches.find((l) => l.agencyId === agencyB)?._id).toBe(b.leaseId);
    await expect(
      t.run((ctx) =>
        ctx.db
          .query("leases")
          .withIndex("by_publicId", (q) => q.eq("publicId", "LSE-L-DUP"))
          .unique(),
      ),
    ).rejects.toThrow();
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

  test("products.by_slug finds the seeded default with today's pricing table and a second row with the slug breaks .unique()", async () => {
    const t = setup();
    await seedDefaultProduct(t);

    const row = await t.run((ctx) =>
      ctx.db
        .query("products")
        .withIndex("by_slug", (q) => q.eq("slug", "mutav-fianca"))
        .unique(),
    );

    expect(row).not.toBeNull();
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

    // The slug is the lookup key `seedDefaultProduct` and the create path
    // resolve through `.unique()`, so a duplicate slug is a data fault.
    await expect(
      t.run(async (ctx) => {
        await insertProductRow(ctx, { slug: "mutav-fianca", enabled: true, isDefault: false });
        return ctx.db
          .query("products")
          .withIndex("by_slug", (q) => q.eq("slug", "mutav-fianca"))
          .unique();
      }),
    ).rejects.toThrow();
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

  test("persists an agency-restricted regional product and isEligible refuses the other agency's subject", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");

    const product = await t.run(async (ctx) => {
      const productId = await insertProductRow(ctx, {
        slug: "mutav-fianca-sp-commercial",
        enabled: true,
        isDefault: false,
        effectiveTo: "2027-01-01T00:00:00.000Z",
        eligibility: {
          agencyIds: [agencyA],
          regionUFs: ["SP"],
          minTier: "regular",
          propertyKinds: ["commercial"],
        },
      });
      return getProduct(ctx, productId);
    });

    expect(product.eligibility).toEqual({
      agencyIds: [agencyA],
      regionUFs: ["SP"],
      minTier: "regular",
      propertyKinds: ["commercial"],
    });
    const spCommercialBom = { uf: "SP", tier: "bom" as const, propertyKind: "commercial" as const };
    expect(isEligible(product, { agencyId: agencyB, ...spCommercialBom })).toBe(false);
    expect(isEligible(product, { agencyId: agencyA, ...spCommercialBom })).toBe(true);
    expect(isEligible(product, { agencyId: agencyA, ...spCommercialBom, tier: "regular" })).toBe(
      true,
    );
    expect(isEligible(product, { agencyId: agencyA, ...spCommercialBom, tier: "ruim" })).toBe(
      false,
    );
    expect(isEligible(product, { agencyId: agencyA, ...spCommercialBom, uf: "RJ" })).toBe(false);
    expect(isEligible(product, { agencyId: agencyA, ...spCommercialBom, uf: null })).toBe(false);
    expect(
      isEligible(product, { agencyId: agencyA, ...spCommercialBom, propertyKind: "residential" }),
    ).toBe(false);
    expect(isEffective(product, "2026-06-01T00:00:00.000Z")).toBe(true);
    expect(isEffective(product, "2027-01-01T00:00:00.000Z")).toBe(false);
    expect(isEffective(product, "2025-12-31T00:00:00.000Z")).toBe(false);
    expect(isEffective({ ...product, enabled: false }, "2026-06-01T00:00:00.000Z")).toBe(false);
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
  });

  async function seedSharedPublicIdHistory(
    t: Harness,
  ): Promise<{ agencyA: AgencyId; agencyB: AgencyId }> {
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");
    await t.run(async (ctx) => {
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
    });
    return { agencyA, agencyB };
  }

  test("guaranteeHistory.by_agency_guarantee disambiguates a shared publicId and round-trips tenantSnapshot", async () => {
    const t = setup();
    const { agencyA, agencyB } = await seedSharedPublicIdHistory(t);

    const { forA, forB } = await t.run(async (ctx) => {
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

  test("guaranteeHistory.by_guarantee is not agency-scoped and returns both agencies' G-DUP events", async () => {
    const t = setup();
    await seedSharedPublicIdHistory(t);

    const usernames = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_guarantee", (q) => q.eq("guaranteePublicId", "G-DUP"))
        .collect();
      return rows.map((r) => r.username).sort();
    });

    expect(usernames).toEqual(["ana", "bruno"]);
  });
});

describe("tenant identity — agencySubmittedTenant", () => {
  test("agencySubmittedTenant returns the owning agency's snapshot by presence, not sort order, and null when none exists", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000102");

    const { firstInIndex, forA, forB, forNone } = await t.run(async (ctx) => {
      await ctx.db.insert("guaranteeHistory", {
        agencyId: agencyA,
        guaranteePublicId: "TI-1",
        at: "2026-01-01T00:00:00.000Z",
        username: "ana",
        message: "Garantia criada",
        tenantSnapshot: {
          entityType: "pf",
          taxId: "11144477735",
          fullName: "Agency A Tenant",
          email: "a-tenant@test.br",
          phone: "11999999999",
          birthDate: "1990-01-01",
        },
      });
      // A later instant written in offset form: "-" sorts before "Z", so this
      // row leads the index even though it happened three hours after creation.
      await ctx.db.insert("guaranteeHistory", {
        agencyId: agencyA,
        guaranteePublicId: "TI-1",
        at: "2026-01-01T00:00:00.000-03:00",
        username: "ana",
        message: "Documento enviado",
      });
      await ctx.db.insert("guaranteeHistory", {
        agencyId: agencyB,
        guaranteePublicId: "TI-1",
        at: "2025-12-01T00:00:00.000Z",
        username: "bruno",
        message: "Garantia criada",
        tenantSnapshot: {
          entityType: "pf",
          taxId: "11144477735",
          fullName: "Agency B Tenant",
          email: "b-tenant@test.br",
          phone: "11888888888",
          birthDate: "1985-05-05",
        },
      });
      await ctx.db.insert("guaranteeHistory", {
        agencyId: agencyA,
        guaranteePublicId: "TI-NONE",
        at: AT,
        username: "ana",
        message: "Garantia criada",
      });
      const firstInIndex = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_agency_guarantee", (q) =>
          q.eq("agencyId", agencyA).eq("guaranteePublicId", "TI-1"),
        )
        .first();
      return {
        firstInIndex: firstInIndex?.message,
        forA: await agencySubmittedTenant(ctx, { agencyId: agencyA, publicId: "TI-1" }),
        forB: await agencySubmittedTenant(ctx, { agencyId: agencyB, publicId: "TI-1" }),
        forNone: await agencySubmittedTenant(ctx, { agencyId: agencyA, publicId: "TI-NONE" }),
      };
    });

    expect(firstInIndex).toBe("Documento enviado");
    expect(forA).toEqual({
      entityType: "pf",
      taxId: "11144477735",
      fullName: "Agency A Tenant",
      birthDate: "1990-01-01",
      email: "a-tenant@test.br",
      phone: "11999999999",
    });
    expect(forB).toEqual({
      entityType: "pf",
      taxId: "11144477735",
      fullName: "Agency B Tenant",
      birthDate: "1985-05-05",
      email: "b-tenant@test.br",
      phone: "11888888888",
    });
    expect(forNone).toBeNull();
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

    const { forA, forB, forC } = await t.run(async (ctx) => ({
      forA: await guaranteesForAgencyStatus(ctx, agencyA, "active"),
      forB: await guaranteesForAgencyStatus(ctx, agencyB, "active"),
      forC: await guaranteesForAgencyStatus(ctx, agencyC, "active"),
    }));

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
  test("the production create and cancelDraft paths leave the agency's contractApplications rows byte-identical", async () => {
    const t = setup();
    await seedDefaultProduct(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 750 });

    const snapshot = () =>
      t.run(async (ctx) => ({
        indexed: await ctx.db
          .query("contractApplications")
          .withIndex("by_agency_subject_time", (q) =>
            q.eq("agencyId", agencyId).eq("subjectHash", "hash-A-1"),
          )
          .collect(),
        total: (await ctx.db.query("contractApplications").collect()).length,
      }));

    await t.run((ctx) =>
      ctx.db.insert("contractApplications", {
        agencyId,
        subjectHash: "hash-A-1",
        entityType: "pf",
        propertyKind: "residential",
        cep: "01000000",
        rentCents: 100_000,
        openedBy: userId,
        openedAt: 1_767_225_600_000,
      }),
    );
    const before = await snapshot();

    const created = await asUser.mutation(api.guarantees.useCases.create, {
      agencyId,
      lease: {
        propertyKind: "residential",
        property: {
          cep: "01000000",
          streetAndNumber: "Rua Teste, 1",
          neighborhood: "Centro",
          cityUF: "São Paulo / SP",
          complement: "",
        },
        tag: "",
        description: "",
        rent: { rentCents: 300_000, condoCents: 0, otherFeesCents: 0 },
      },
      plan: "basic",
      tenant: {
        entityType: "pf",
        fullName: "Maria Silva Santos",
        cpf: VALID_CPF,
        birthDate: "1990-05-12",
        email: "maria@example.com",
        phone: "11900000001",
      },
    });
    const publicId = dataOf(created).publicId;
    const canceled = await asUser.mutation(api.guarantees.useCases.cancelDraft, {
      agencyId,
      publicId,
    });
    expect(canceled.success).toBe(true);

    const after = await snapshot();
    const guarantee = await t.run((ctx) =>
      ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique(),
    );

    expect(before.total).toBe(1);
    expect(after).toEqual(before);
    expect(guarantee?.status).toBe("closed");
    expect(guarantee?.closure?.reason).toBe("canceled_pre_activation");
  });
});
