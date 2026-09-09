// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { defineSchema, type WithoutSystemFields } from "convex/server";
import { describe, expect, test } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import type { Guarantee, GuaranteeId } from "../guarantees/domain";
import { registerContractAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import schema from "../schema";
import type { TenantId } from "../tenants/domain";
import {
  assertLeaseAcceptsGuarantee,
  buildLeaseRent,
  DEFAULT_PAYER,
  isValidRentInput,
  PROPERTY_KIND,
  ufFromCityUF,
  type Lease,
  type LeaseId,
} from "./domain";

// The app schema runs with `schemaValidation: false` (pre-prod reseed window),
// and convex-test skips every validator when that flag is off. Conformance
// tests therefore run on this strict twin of the same tables — the only
// harness that can refuse a missing required field or a wrong-table id.
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

const AT = "2026-01-01T00:00:00.000Z";
const CLOSED_AT = "2026-06-01T00:00:00.000Z";
const TENANT_T_TAX_ID = "52998224725";
const TENANT_U_TAX_ID = "11144477735";

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

async function insertTenantRow(ctx: MutationCtx, taxId = TENANT_U_TAX_ID): Promise<TenantId> {
  return ctx.db.insert("tenants", {
    entityType: "pf",
    taxId,
    fullName: "Test Tenant",
    birthDate: "1990-01-01",
    email: "tenant@test.br",
    phone: "11999999999",
  });
}

type NewLease = WithoutSystemFields<Lease>;

type LeaseSpec = {
  agencyId: AgencyId;
  tenantId: TenantId;
  publicId: string;
  propertyKind?: Lease["propertyKind"];
  rent?: Lease["rent"];
  cityUF?: string;
  complement?: string;
};

function leaseDoc(spec: LeaseSpec): NewLease {
  return {
    agencyId: spec.agencyId,
    publicId: spec.publicId,
    tenantId: spec.tenantId,
    propertyKind: spec.propertyKind ?? PROPERTY_KIND.RESIDENTIAL,
    property: {
      cep: "01000000",
      streetAndNumber: "Rua Teste, 1",
      neighborhood: "Centro",
      cityUF: spec.cityUF ?? "São Paulo/SP",
      complement: spec.complement ?? "",
    },
    tag: "",
    description: "",
    rent: spec.rent ?? {
      rentCents: 100_000,
      condoCents: 0,
      otherFeesCents: 0,
      totalRentCents: 100_000,
    },
    payer: DEFAULT_PAYER,
    openGuaranteeId: null,
  };
}

async function insertLeaseRow(ctx: MutationCtx, spec: LeaseSpec): Promise<LeaseId> {
  return ctx.db.insert("leases", leaseDoc(spec));
}

// A valid document with one field overwritten by a value the schema does not
// declare. Only the strict harness can refuse it, which is the point.
// hook-ok: deliberately malformed document to exercise the schema validator
function malformed<T extends object>(valid: T, overrides: Record<string, unknown>): T {
  return { ...valid, ...overrides } as T;
}

// A valid document with one required key dropped entirely (not set to
// undefined), so the validator sees a missing field rather than a bad value.
// hook-ok: deliberately incomplete document to exercise the schema validator
function withoutKey<T extends object>(valid: T, key: keyof T & string): T {
  return Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key)) as T;
}

async function getLease(ctx: MutationCtx, id: LeaseId): Promise<Lease> {
  const row = await ctx.db.get(id);
  if (!row) throw new Error(`lease ${id} not found`);
  return row;
}

async function leasesByAgency(ctx: MutationCtx, agencyId: AgencyId): Promise<Lease[]> {
  return ctx.db
    .query("leases")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .collect();
}

async function leasesByTenant(ctx: MutationCtx, tenantId: TenantId): Promise<Lease[]> {
  return ctx.db
    .query("leases")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

async function leasesByAgencyTenant(
  ctx: MutationCtx,
  agencyId: AgencyId,
  tenantId: TenantId,
): Promise<Lease[]> {
  return ctx.db
    .query("leases")
    .withIndex("by_agency_tenant", (q) => q.eq("agencyId", agencyId).eq("tenantId", tenantId))
    .collect();
}

function publicIds(rows: Lease[]): string[] {
  return rows.map((row) => row.publicId);
}

function byPublicId(rows: Lease[]): Lease[] {
  return [...rows].sort((a, b) => a.publicId.localeCompare(b.publicId));
}

type LeaseProblem = { lease: string; problem: string };

function sortProblems(problems: LeaseProblem[]): LeaseProblem[] {
  return [...problems].sort(
    (a, b) => a.lease.localeCompare(b.lease) || a.problem.localeCompare(b.problem),
  );
}

// The rent invariant no validator enforces: every leg is an integer, the total
// is the sum of the legs, and the legs pass the domain's input rule.
function rentProblems(rows: Lease[]): LeaseProblem[] {
  const problems: LeaseProblem[] = [];
  for (const row of rows) {
    const { rentCents, condoCents, otherFeesCents, totalRentCents } = row.rent;
    const legs = [rentCents, condoCents, otherFeesCents, totalRentCents];
    if (!legs.every((leg) => Number.isInteger(leg))) {
      problems.push({ lease: row.publicId, problem: "non-integer rent leg" });
    }
    if (totalRentCents !== rentCents + condoCents + otherFeesCents) {
      problems.push({ lease: row.publicId, problem: "total does not equal the sum of the legs" });
    }
    if (!isValidRentInput(row.rent)) {
      problems.push({ lease: row.publicId, problem: "rejected by isValidRentInput" });
    }
  }
  return sortProblems(problems);
}

async function guaranteesByLease(ctx: MutationCtx, leaseId: LeaseId): Promise<Guarantee[]> {
  return ctx.db
    .query("guarantees")
    .withIndex("by_lease", (q) => q.eq("leaseId", leaseId))
    .collect();
}

// Lease-side reading of the one-open-guarantee rule: a set pointer must name a
// non-closed guarantee on this lease in this agency, and a lease whose rows
// are all closed keeps a null pointer. Walks `by_agency` and `by_lease` only.
async function leasePointerProblems(ctx: MutationCtx, agencyId: AgencyId): Promise<LeaseProblem[]> {
  const problems: LeaseProblem[] = [];
  for (const lease of await leasesByAgency(ctx, agencyId)) {
    const rows = await guaranteesByLease(ctx, lease._id);
    const openRows = rows.filter((row) => row.status !== "closed");
    if (lease.openGuaranteeId !== null) {
      const target = await ctx.db.get(lease.openGuaranteeId);
      if (!target) {
        problems.push({ lease: lease.publicId, problem: "pointer targets a missing guarantee" });
      } else if (target.agencyId !== lease.agencyId) {
        problems.push({
          lease: lease.publicId,
          problem: "pointer targets another agency's guarantee",
        });
      } else if (target.leaseId !== lease._id) {
        problems.push({
          lease: lease.publicId,
          problem: "pointer targets another lease's guarantee",
        });
      } else if (target.status === "closed") {
        problems.push({ lease: lease.publicId, problem: "pointer targets a closed guarantee" });
      }
    } else if (openRows.length === 1) {
      problems.push({ lease: lease.publicId, problem: "open row without pointer" });
    }
    if (openRows.length > 1) {
      problems.push({ lease: lease.publicId, problem: "more than one open guarantee" });
    }
  }
  return sortProblems(problems);
}

describe("schema conformance — leases table (strict harness)", () => {
  test("declares exactly the four lease indexes with their field lists", () => {
    const indexes = schema.tables.leases[" indexes"]();

    expect(indexes).toEqual([
      { indexDescriptor: "by_publicId", fields: ["publicId"] },
      { indexDescriptor: "by_agency", fields: ["agencyId"] },
      { indexDescriptor: "by_tenant", fields: ["tenantId"] },
      { indexDescriptor: "by_agency_tenant", fields: ["agencyId", "tenantId"] },
    ]);
  });

  test("round-trips a residential and a commercial lease with every field as a literal", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const { tenantId, residentialId, commercialId, residential, commercial } = await t.run(
      async (ctx) => {
        const tenantId = await insertTenantRow(ctx);
        const residentialId = await ctx.db.insert("leases", {
          agencyId,
          publicId: "LSE-RES",
          tenantId,
          propertyKind: "residential",
          property: {
            cep: "90010150",
            streetAndNumber: "Rua dos Andradas, 1001",
            neighborhood: "Centro Histórico",
            cityUF: "Porto Alegre/RS",
            complement: "Apto 402",
          },
          tag: "Unidade 402",
          description: "Dois dormitórios",
          rent: {
            rentCents: 250_000,
            condoCents: 45_000,
            otherFeesCents: 12_000,
            totalRentCents: 307_000,
          },
          payer: "tenant",
          openGuaranteeId: null,
        });
        const commercialId = await ctx.db.insert("leases", {
          agencyId,
          publicId: "LSE-COM",
          tenantId,
          propertyKind: "commercial",
          property: {
            cep: "01310100",
            streetAndNumber: "Av. Paulista, 1578",
            neighborhood: "Bela Vista",
            cityUF: "São Paulo/SP",
            complement: "Loja 3",
          },
          tag: "Loja",
          description: "Ponto comercial",
          rent: {
            rentCents: 1_200_000,
            condoCents: 300_000,
            otherFeesCents: 0,
            totalRentCents: 1_500_000,
          },
          payer: "tenant",
          openGuaranteeId: null,
        });
        return {
          tenantId,
          residentialId,
          commercialId,
          residential: await getLease(ctx, residentialId),
          commercial: await getLease(ctx, commercialId),
        };
      },
    );

    expect(residential).toEqual({
      _id: residentialId,
      _creationTime: expect.any(Number),
      agencyId,
      publicId: "LSE-RES",
      tenantId,
      propertyKind: "residential",
      property: {
        cep: "90010150",
        streetAndNumber: "Rua dos Andradas, 1001",
        neighborhood: "Centro Histórico",
        cityUF: "Porto Alegre/RS",
        complement: "Apto 402",
      },
      tag: "Unidade 402",
      description: "Dois dormitórios",
      rent: {
        rentCents: 250_000,
        condoCents: 45_000,
        otherFeesCents: 12_000,
        totalRentCents: 307_000,
      },
      payer: "tenant",
      openGuaranteeId: null,
    });
    expect(commercial).toEqual({
      _id: commercialId,
      _creationTime: expect.any(Number),
      agencyId,
      publicId: "LSE-COM",
      tenantId,
      propertyKind: "commercial",
      property: {
        cep: "01310100",
        streetAndNumber: "Av. Paulista, 1578",
        neighborhood: "Bela Vista",
        cityUF: "São Paulo/SP",
        complement: "Loja 3",
      },
      tag: "Loja",
      description: "Ponto comercial",
      rent: {
        rentCents: 1_200_000,
        condoCents: 300_000,
        otherFeesCents: 0,
        totalRentCents: 1_500_000,
      },
      payer: "tenant",
      openGuaranteeId: null,
    });
  });

  test("round-trips a populated and an empty-string complement and refuses a missing one — complement is a required string, not optional", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const { tenantId, populated, empty } = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      const populatedId = await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-C1",
        complement: "Bloco B, apto 12",
      });
      const emptyId = await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-C2",
        complement: "",
      });
      return {
        tenantId,
        populated: await getLease(ctx, populatedId),
        empty: await getLease(ctx, emptyId),
      };
    });

    expect(populated.property).toEqual({
      cep: "01000000",
      streetAndNumber: "Rua Teste, 1",
      neighborhood: "Centro",
      cityUF: "São Paulo/SP",
      complement: "Bloco B, apto 12",
    });
    expect(empty.property.complement).toBe("");

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          malformed(leaseDoc({ agencyId, tenantId, publicId: "LSE-C3" }), {
            property: {
              cep: "01000000",
              streetAndNumber: "Rua Teste, 1",
              neighborhood: "Centro",
              cityUF: "São Paulo/SP",
            },
          }),
        ),
      ),
    ).rejects.toThrow(/complement/);
  });

  test("round-trips openGuaranteeId as null and as an Id<guarantees> and refuses an omitted pointer", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const pointed = await seedGuaranteeWithLease(t, { agencyId, status: "active" }, "P1");
    const released = await seedGuaranteeWithLease(t, { agencyId, status: "closed" }, "P2");

    const { pointedLease, releasedLease } = await t.run(async (ctx) => ({
      pointedLease: await getLease(ctx, pointed.leaseId),
      releasedLease: await getLease(ctx, released.leaseId),
    }));

    expect(pointedLease.openGuaranteeId).toBe(pointed.guaranteeId);
    expect(releasedLease.openGuaranteeId).toBe(null);

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          withoutKey(
            leaseDoc({ agencyId, tenantId: pointed.tenantId, publicId: "LSE-P3" }),
            "openGuaranteeId",
          ),
        ),
      ),
    ).rejects.toThrow(/openGuaranteeId/);
  });

  test("refuses a tenantId from the agencies table and an agencyId from the tenants table", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const tenantId = await t.run((ctx) => insertTenantRow(ctx));

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          // hook-ok: deliberately wrong-table id for a validator test
          malformed(leaseDoc({ agencyId, tenantId, publicId: "LSE-WRONG-T" }), {
            tenantId: agencyId,
          }),
        ),
      ),
    ).rejects.toThrow(/Expected ID for table "tenants"/);

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          // hook-ok: deliberately wrong-table id for a validator test
          malformed(leaseDoc({ agencyId, tenantId, publicId: "LSE-WRONG-A" }), {
            agencyId: tenantId,
          }),
        ),
      ),
    ).rejects.toThrow(/Expected ID for table "agencies"/);
  });
});

describe("rent bundle — totals as persisted", () => {
  test("persists buildLeaseRent output and the stored totalRentCents equals the literal sum for each row", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const rents = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-R1",
        rent: buildLeaseRent({ rentCents: 250_000, condoCents: 45_000, otherFeesCents: 12_000 }),
      });
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-R2",
        rent: buildLeaseRent({ rentCents: 100_000, condoCents: 0, otherFeesCents: 0 }),
      });
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-R3",
        rent: buildLeaseRent({ rentCents: 1, condoCents: 0, otherFeesCents: 0 }),
      });
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-R4",
        rent: buildLeaseRent({ rentCents: 12_345_678, condoCents: 987_654, otherFeesCents: 321 }),
      });
      return byPublicId(await leasesByAgency(ctx, agencyId)).map((row) => row.rent);
    });

    expect(rents).toEqual([
      { rentCents: 250_000, condoCents: 45_000, otherFeesCents: 12_000, totalRentCents: 307_000 },
      { rentCents: 100_000, condoCents: 0, otherFeesCents: 0, totalRentCents: 100_000 },
      { rentCents: 1, condoCents: 0, otherFeesCents: 0, totalRentCents: 1 },
      {
        rentCents: 12_345_678,
        condoCents: 987_654,
        otherFeesCents: 321,
        totalRentCents: 13_333_653,
      },
    ]);
  });

  test("rent sweep (fixture guard): every persisted lease has integer legs, a total equal to the sum, and passes isValidRentInput", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");
    await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "F1");
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "drafted", rentCents: 250_000 },
      "F2",
    );
    await seedGuaranteeWithLease(
      t,
      { agencyId: agencyB, status: "closed", rentCents: 1_500_000 },
      "F3",
    );

    const { problems, rowCount } = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, {
        agencyId: agencyA,
        tenantId,
        publicId: "LSE-H1",
        rent: buildLeaseRent({ rentCents: 80_000, condoCents: 20_000, otherFeesCents: 5_000 }),
      });
      await insertLeaseRow(ctx, {
        agencyId: agencyB,
        tenantId,
        publicId: "LSE-H2",
        rent: buildLeaseRent({ rentCents: 300_000, condoCents: 0, otherFeesCents: 1 }),
      });
      const rows = [
        ...(await leasesByAgency(ctx, agencyA)),
        ...(await leasesByAgency(ctx, agencyB)),
      ];
      return { problems: rentProblems(rows), rowCount: rows.length };
    });

    expect(problems).toEqual([]);
    expect(rowCount).toBe(5);
  });

  test("a partial rent patch leaves a stale totalRentCents the sweep catches; rebuilding through buildLeaseRent clears it", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const leaseId = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      return insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-STALE",
        rent: buildLeaseRent({ rentCents: 100_000, condoCents: 0, otherFeesCents: 0 }),
      });
    });

    const stale = await t.run(async (ctx) => {
      await ctx.db.patch(leaseId, {
        rent: {
          rentCents: 100_000,
          condoCents: 50_000,
          otherFeesCents: 0,
          totalRentCents: 100_000,
        },
      });
      const lease = await getLease(ctx, leaseId);
      return { rent: lease.rent, problems: rentProblems([lease]) };
    });

    expect(stale.rent.totalRentCents).toBe(100_000);
    expect(stale.problems).toEqual([
      { lease: "LSE-STALE", problem: "total does not equal the sum of the legs" },
    ]);

    const rebuilt = await t.run(async (ctx) => {
      await ctx.db.patch(leaseId, {
        rent: buildLeaseRent({ rentCents: 100_000, condoCents: 50_000, otherFeesCents: 0 }),
      });
      const lease = await getLease(ctx, leaseId);
      return { rent: lease.rent, problems: rentProblems([lease]) };
    });

    expect(rebuilt.rent).toEqual({
      rentCents: 100_000,
      condoCents: 50_000,
      otherFeesCents: 0,
      totalRentCents: 150_000,
    });
    expect(rebuilt.problems).toEqual([]);
  });

  test("the strict schema accepts a float and a negative rentCents; isValidRentInput refuses both on read-back", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const validity = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-FLOAT",
        rent: { rentCents: 1000.5, condoCents: 0, otherFeesCents: 0, totalRentCents: 1000.5 },
      });
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-NEG",
        rent: { rentCents: -100, condoCents: 0, otherFeesCents: 0, totalRentCents: -100 },
      });
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-ZERO",
        rent: { rentCents: 0, condoCents: 0, otherFeesCents: 0, totalRentCents: 0 },
      });
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-OK",
        rent: buildLeaseRent({ rentCents: 1, condoCents: 0, otherFeesCents: 0 }),
      });
      const rows = byPublicId(await leasesByAgency(ctx, agencyId));
      return {
        order: publicIds(rows),
        valid: rows.map((row) => isValidRentInput(row.rent)),
      };
    });

    expect(validity.order).toEqual(["LSE-FLOAT", "LSE-NEG", "LSE-OK", "LSE-ZERO"]);
    expect(validity.valid).toEqual([false, false, true, false]);
  });
});

describe("property — ufFromCityUF over persisted cityUF", () => {
  test("derives the UF from every well-formed Cidade/UF variant persisted on a lease", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const ufs = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      const variants = [
        "Porto Alegre/RS",
        "Porto Alegre / RS",
        "porto alegre/rs",
        "Rio de Janeiro/RJ",
        "/RS",
        "Santana/Livramento/RS",
      ];
      for (const [i, cityUF] of variants.entries()) {
        await insertLeaseRow(ctx, { agencyId, tenantId, publicId: `LSE-U${i + 1}`, cityUF });
      }
      return byPublicId(await leasesByAgency(ctx, agencyId)).map((row) =>
        ufFromCityUF(row.property.cityUF),
      );
    });

    expect(ufs).toEqual(["RS", "RS", "RS", "RJ", "RS", "RS"]);
  });

  test("returns null for malformed persisted cityUF so region-restricted products cannot match a garbage token", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const ufs = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      const variants = [
        "Brasília",
        "Porto Alegre/",
        "Porto Alegre/RSS",
        "Porto Alegre/1A",
        "",
        "Porto Alegre/R S",
      ];
      for (const [i, cityUF] of variants.entries()) {
        await insertLeaseRow(ctx, { agencyId, tenantId, publicId: `LSE-M${i + 1}`, cityUF });
      }
      return byPublicId(await leasesByAgency(ctx, agencyId)).map((row) =>
        ufFromCityUF(row.property.cityUF),
      );
    });

    expect(ufs).toEqual([null, null, null, null, null, null]);
  });
});

describe("field mutability — patches in place", () => {
  test("patches tag, description, complement and propertyKind in place without touching rent, payer, tenantId or the pointer", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId, tenantId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active" },
      "E1",
    );

    const patched = await t.run(async (ctx) => {
      const existing = await getLease(ctx, leaseId);
      await ctx.db.patch(leaseId, {
        tag: "Cobertura",
        description: "Reformado em 2025",
        propertyKind: "commercial",
        property: { ...existing.property, complement: "Sala 12" },
      });
      return getLease(ctx, leaseId);
    });

    expect(patched).toEqual({
      _id: leaseId,
      _creationTime: expect.any(Number),
      agencyId,
      publicId: "LSE-E1",
      tenantId,
      propertyKind: "commercial",
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo/SP",
        complement: "Sala 12",
      },
      tag: "Cobertura",
      description: "Reformado em 2025",
      rent: { rentCents: 100_000, condoCents: 0, otherFeesCents: 0, totalRentCents: 100_000 },
      payer: "tenant",
      openGuaranteeId: guaranteeId,
    });
  });
});

describe("index reads — leases", () => {
  test("by_publicId resolves one lease with .unique() and returns null for an unknown publicId", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const { leaseBId, hit, miss } = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-A" });
      const leaseBId = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-B" });
      await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-C" });
      return {
        leaseBId,
        hit: await ctx.db
          .query("leases")
          .withIndex("by_publicId", (q) => q.eq("publicId", "LSE-B"))
          .unique(),
        miss: await ctx.db
          .query("leases")
          .withIndex("by_publicId", (q) => q.eq("publicId", "LSE-ZZZ"))
          .unique(),
      };
    });

    expect(hit?.publicId).toBe("LSE-B");
    expect(hit?._id).toBe(leaseBId);
    expect(miss).toBe(null);
  });

  test("by_agency returns the agency's leases in insertion order and an empty list for an agency without leases", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");

    const { forA, forB } = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId, publicId: "LSE-1" });
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId, publicId: "LSE-2" });
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId, publicId: "LSE-3" });
      return {
        forA: publicIds(await leasesByAgency(ctx, agencyA)),
        forB: publicIds(await leasesByAgency(ctx, agencyB)),
      };
    });

    expect(forA).toEqual(["LSE-1", "LSE-2", "LSE-3"]);
    expect(forB).toEqual([]);
  });

  test("by_tenant vs by_agency_tenant: one tenant with three leases across two agencies, a second tenant's lease in the same agency excluded from both", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");

    const result = await t.run(async (ctx) => {
      const tenantT = await insertTenantRow(ctx, TENANT_T_TAX_ID);
      const tenantU = await insertTenantRow(ctx, TENANT_U_TAX_ID);
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId: tenantT, publicId: "LSE-T1" });
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId: tenantT, publicId: "LSE-T2" });
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId: tenantT, publicId: "LSE-T3" });
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId: tenantU, publicId: "LSE-U1" });
      const byTenantT = await leasesByTenant(ctx, tenantT);
      return {
        byTenantT: publicIds(byTenantT),
        byTenantTAgencies: byTenantT.map((row) => row.agencyId),
        byTenantU: publicIds(await leasesByTenant(ctx, tenantU)),
        aT: publicIds(await leasesByAgencyTenant(ctx, agencyA, tenantT)),
        bT: publicIds(await leasesByAgencyTenant(ctx, agencyB, tenantT)),
        aU: publicIds(await leasesByAgencyTenant(ctx, agencyA, tenantU)),
        bU: publicIds(await leasesByAgencyTenant(ctx, agencyB, tenantU)),
      };
    });

    expect(result.byTenantT).toEqual(["LSE-T1", "LSE-T2", "LSE-T3"]);
    expect(result.byTenantTAgencies).toEqual([agencyA, agencyB, agencyB]);
    expect(result.byTenantU).toEqual(["LSE-U1"]);
    expect(result.aT).toEqual(["LSE-T1"]);
    expect(result.bT).toEqual(["LSE-T2", "LSE-T3"]);
    expect(result.aU).toEqual(["LSE-U1"]);
    expect(result.bU).toEqual([]);
  });

  test("by_agency_tenant queried on the agencyId prefix alone returns the same rows as by_agency", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");

    const { prefixIds, prefixRowIds, byAgencyRowIds } = await t.run(async (ctx) => {
      const tenantT = await insertTenantRow(ctx, TENANT_T_TAX_ID);
      const tenantU = await insertTenantRow(ctx, TENANT_U_TAX_ID);
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId: tenantT, publicId: "LSE-T1" });
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId: tenantU, publicId: "LSE-U1" });
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId: tenantT, publicId: "LSE-T2" });
      const prefix = await ctx.db
        .query("leases")
        .withIndex("by_agency_tenant", (q) => q.eq("agencyId", agencyA))
        .collect();
      const byAgency = await leasesByAgency(ctx, agencyA);
      return {
        prefixIds: publicIds(prefix),
        prefixRowIds: prefix.map((row) => row._id).sort(),
        byAgencyRowIds: byAgency.map((row) => row._id).sort(),
      };
    });

    expect(prefixIds).toEqual(["LSE-T1", "LSE-T2", "LSE-U1"]);
    expect(prefixRowIds).toEqual(byAgencyRowIds);
    expect(prefixRowIds).toHaveLength(3);
  });

  test("by_tenant and by_agency_tenant follow a tenantId patch on a lease", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");

    const result = await t.run(async (ctx) => {
      const tenantT = await insertTenantRow(ctx, TENANT_T_TAX_ID);
      const tenantU = await insertTenantRow(ctx, TENANT_U_TAX_ID);
      const leaseId = await insertLeaseRow(ctx, {
        agencyId: agencyA,
        tenantId: tenantT,
        publicId: "LSE-SWAP",
      });
      await ctx.db.patch(leaseId, { tenantId: tenantU });
      return {
        byTenantT: publicIds(await leasesByTenant(ctx, tenantT)),
        byTenantU: publicIds(await leasesByTenant(ctx, tenantU)),
        aT: publicIds(await leasesByAgencyTenant(ctx, agencyA, tenantT)),
        aU: publicIds(await leasesByAgencyTenant(ctx, agencyA, tenantU)),
      };
    });

    expect(result.byTenantT).toEqual([]);
    expect(result.aT).toEqual([]);
    expect(result.byTenantU).toEqual(["LSE-SWAP"]);
    expect(result.aU).toEqual(["LSE-SWAP"]);
  });
});

describe("cross-agency isolation via ctx.db", () => {
  test("by_agency returns only the agency's own row when another agency holds a lease with the identical publicId", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");

    const { forA, forB, collisions } = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId, publicId: "LSE-DUP" });
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId, publicId: "LSE-DUP" });
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId, publicId: "LSE-ONLY-B" });
      return {
        forA: await leasesByAgency(ctx, agencyA),
        forB: await leasesByAgency(ctx, agencyB),
        collisions: await ctx.db
          .query("leases")
          .withIndex("by_publicId", (q) => q.eq("publicId", "LSE-DUP"))
          .collect(),
      };
    });

    expect(forA).toHaveLength(1);
    expect(forA[0]?.agencyId).toBe(agencyA);
    expect(forA[0]?.publicId).toBe("LSE-DUP");
    expect(publicIds(forB)).toEqual(["LSE-DUP", "LSE-ONLY-B"]);
    for (const row of forB) expect(row.agencyId).toBe(agencyB);
    expect(collisions).toHaveLength(2);
  });

  test("by_tenant is platform-wide across agencies while by_agency_tenant hides the foreign agency's lease for the same tenant", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");
    const { tenantId } = await seedGuaranteeWithLease(
      t,
      { agencyId: agencyA, status: "active", tenantTaxId: TENANT_T_TAX_ID },
      "X1",
    );

    const result = await t.run(async (ctx) => {
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId, publicId: "LSE-X2" });
      const byTenant = await leasesByTenant(ctx, tenantId);
      return {
        byTenantAgencies: byTenant.map((row) => row.agencyId).sort(),
        aT: publicIds(await leasesByAgencyTenant(ctx, agencyA, tenantId)),
        bT: publicIds(await leasesByAgencyTenant(ctx, agencyB, tenantId)),
      };
    });

    expect(result.byTenantAgencies).toHaveLength(2);
    expect(result.byTenantAgencies).toEqual([agencyA, agencyB].sort());
    expect(result.aT).toEqual(["LSE-X1"]);
    expect(result.bT).toEqual(["LSE-X2"]);
  });

  test("by_agency_tenant for an agency the tenant never rented through returns an empty list, not the other agency's rows", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");

    const result = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx, TENANT_T_TAX_ID);
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId, publicId: "LSE-B1" });
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId, publicId: "LSE-B2" });
      return {
        aT: publicIds(await leasesByAgencyTenant(ctx, agencyA, tenantId)),
        bT: publicIds(await leasesByAgencyTenant(ctx, agencyB, tenantId)),
      };
    });

    expect(result.aT).toEqual([]);
    expect(result.bT).toEqual(["LSE-B1", "LSE-B2"]);
  });
});

describe("one-open-guarantee rule — lease side", () => {
  test("assertLeaseAcceptsGuarantee returns the complete literal Result for a fresh lease and for a pointed lease", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const pointed = await seedGuaranteeWithLease(t, { agencyId, status: "active" }, "G1");
    const fresh = await seedGuaranteeWithLease(t, { agencyId, status: "closed" }, "G2");

    const { freshResult, pointedResult } = await t.run(async (ctx) => ({
      freshResult: assertLeaseAcceptsGuarantee(await getLease(ctx, fresh.leaseId)),
      pointedResult: assertLeaseAcceptsGuarantee(await getLease(ctx, pointed.leaseId)),
    }));

    expect(freshResult).toEqual({
      success: true,
      data: { leaseId: fresh.leaseId },
      message: "Lease accepts a new guarantee.",
    });
    expect(pointedResult).toEqual({
      success: false,
      error: { code: "LEASE_HAS_OPEN_GUARANTEE" },
      message: `Lease ${pointed.leaseId} already has an open guarantee (${pointed.guaranteeId}).`,
    });
  });

  test("lease-side pointer sweep across two agencies is clean and every pointer state matches the guarantee state it was seeded with", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");
    const seeded = [
      await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "S1"),
      await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "drafted" }, "S2"),
      await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "closed" }, "S3"),
      await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "in_arrears" }, "S4"),
      await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "closed" }, "S5"),
    ];

    const { problemsA, problemsB, pointsAtOwnGuarantee, closedPointers } = await t.run(
      async (ctx) => {
        const leases = await Promise.all(seeded.map((s) => getLease(ctx, s.leaseId)));
        return {
          problemsA: await leasePointerProblems(ctx, agencyA),
          problemsB: await leasePointerProblems(ctx, agencyB),
          pointsAtOwnGuarantee: leases.map(
            (lease, i) => lease.openGuaranteeId === seeded[i]?.guaranteeId,
          ),
          closedPointers: [leases[2]?.openGuaranteeId, leases[4]?.openGuaranteeId],
        };
      },
    );

    expect(problemsA).toEqual([]);
    expect(problemsB).toEqual([]);
    expect(pointsAtOwnGuarantee).toEqual([true, true, false, true, false]);
    expect(closedPointers).toEqual([null, null]);
  });

  type PlantedDefect = {
    problem: string;
    plantedLease: string;
    plant: (
      ctx: MutationCtx,
      ids: {
        leaseD1: LeaseId;
        leaseD2: LeaseId;
        leaseD3: LeaseId;
        guaranteeD1: GuaranteeId;
        guaranteeD2: GuaranteeId;
        guaranteeD3: GuaranteeId;
        guaranteeD4: GuaranteeId;
      },
    ) => Promise<void>;
  };

  const PLANTED_DEFECTS: PlantedDefect[] = [
    {
      problem: "pointer targets another agency's guarantee",
      plantedLease: "LSE-D1",
      plant: (ctx, ids) => ctx.db.patch(ids.leaseD1, { openGuaranteeId: ids.guaranteeD4 }),
    },
    {
      problem: "pointer targets another lease's guarantee",
      plantedLease: "LSE-D1",
      plant: (ctx, ids) => ctx.db.patch(ids.leaseD1, { openGuaranteeId: ids.guaranteeD2 }),
    },
    {
      problem: "pointer targets a closed guarantee",
      plantedLease: "LSE-D3",
      plant: (ctx, ids) => ctx.db.patch(ids.leaseD3, { openGuaranteeId: ids.guaranteeD3 }),
    },
    {
      problem: "open row without pointer",
      plantedLease: "LSE-D1",
      plant: (ctx, ids) => ctx.db.patch(ids.leaseD1, { openGuaranteeId: null }),
    },
    {
      problem: "pointer targets a missing guarantee",
      plantedLease: "LSE-D1",
      plant: (ctx, ids) => ctx.db.delete(ids.guaranteeD1),
    },
    {
      // Re-parenting D2's guarantee onto D1 also releases D2's pointer, so the
      // sweep sees exactly one defect: two open rows on D1.
      problem: "more than one open guarantee",
      plantedLease: "LSE-D1",
      plant: async (ctx, ids) => {
        await ctx.db.patch(ids.guaranteeD2, { leaseId: ids.leaseD1 });
        await ctx.db.patch(ids.leaseD2, { openGuaranteeId: null });
      },
    },
  ];

  test.each(PLANTED_DEFECTS)(
    "planted pointer defects are each reported with their literal problem ($problem)",
    async ({ problem, plantedLease, plant }) => {
      const t = setup();
      const agencyA = await seedAgency(t, "Agency A", "00000000000101");
      const agencyB = await seedAgency(t, "Agency B", "00000000000202");
      const d1 = await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "D1");
      const d2 = await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "D2");
      const d3 = await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "closed" }, "D3");
      const d4 = await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "active" }, "D4");

      const problems = await t.run(async (ctx) => {
        await plant(ctx, {
          leaseD1: d1.leaseId,
          leaseD2: d2.leaseId,
          leaseD3: d3.leaseId,
          guaranteeD1: d1.guaranteeId,
          guaranteeD2: d2.guaranteeId,
          guaranteeD3: d3.guaranteeId,
          guaranteeD4: d4.guaranteeId,
        });
        return leasePointerProblems(ctx, agencyA);
      });

      expect(problems).toEqual([{ lease: plantedLease, problem }]);
    },
  );

  test("a pointer left set after the guarantee closed makes the guard refuse and the sweep flag it — the pointer, not the rows, is the guard's source of truth", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active" },
      "ST1",
    );

    const before = await t.run(async (ctx) => {
      await ctx.db.patch(guaranteeId, {
        status: "closed",
        closure: { reason: "end_of_lease", closedAt: CLOSED_AT },
      });
      return {
        guard: assertLeaseAcceptsGuarantee(await getLease(ctx, leaseId)),
        sweep: await leasePointerProblems(ctx, agencyId),
      };
    });

    expect(before.guard.success).toBe(false);
    expect(before.guard.error).toEqual({ code: "LEASE_HAS_OPEN_GUARANTEE" });
    expect(before.sweep).toEqual([
      { lease: "LSE-ST1", problem: "pointer targets a closed guarantee" },
    ]);

    const after = await t.run(async (ctx) => {
      await ctx.db.patch(leaseId, { openGuaranteeId: null });
      return {
        guard: assertLeaseAcceptsGuarantee(await getLease(ctx, leaseId)),
        sweep: await leasePointerProblems(ctx, agencyId),
      };
    });

    expect(after.guard).toEqual({
      success: true,
      data: { leaseId },
      message: "Lease accepts a new guarantee.",
    });
    expect(after.sweep).toEqual([]);
  });

  test("a null pointer with an open guarantee row is accepted by the guard and flagged by the sweep — the two checks are complementary", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { leaseId } = await seedGuaranteeWithLease(t, { agencyId, status: "drafted" }, "NP1");

    const { guard, sweep, rows } = await t.run(async (ctx) => {
      await ctx.db.patch(leaseId, { openGuaranteeId: null });
      return {
        guard: assertLeaseAcceptsGuarantee(await getLease(ctx, leaseId)),
        sweep: await leasePointerProblems(ctx, agencyId),
        rows: await guaranteesByLease(ctx, leaseId),
      };
    });

    expect(guard).toEqual({
      success: true,
      data: { leaseId },
      message: "Lease accepts a new guarantee.",
    });
    expect(sweep).toEqual([{ lease: "LSE-NP1", problem: "open row without pointer" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("drafted");
  });
});
