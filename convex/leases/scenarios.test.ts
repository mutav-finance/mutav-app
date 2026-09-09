// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { defineSchema, type WithoutSystemFields } from "convex/server";
import { describe, expect, test } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import {
  CLOSE_REASONS,
  GUARANTEE_STATES,
  type CloseReason,
  type Guarantee,
  type GuaranteeId,
  type GuaranteeState,
} from "../guarantees/domain";
import { registerContractAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import { isEligible, type ProductEligibility } from "../products/domain";
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

  test("round-trips an openGuaranteeId the test writes as null and as an Id<guarantees>, and refuses an id from the leases, agencies or tenants table", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    // The fixture supplies a real guarantee row to point at; the pointer itself
    // is written by this test so the union validator, not the fixture, is what
    // accepts the Id. The lease↔guarantee relationship is the sweep's concern.
    const { guaranteeId, tenantId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "closed" },
      "P0",
    );

    const { setId, nullId, pointers } = await t.run(async (ctx) => {
      const setId = await ctx.db.insert("leases", {
        ...leaseDoc({ agencyId, tenantId, publicId: "LSE-P-SET" }),
        openGuaranteeId: guaranteeId,
      });
      const nullId = await ctx.db.insert("leases", {
        ...leaseDoc({ agencyId, tenantId, publicId: "LSE-P-NULL" }),
        openGuaranteeId: null,
      });
      const set = await getLease(ctx, setId);
      const nul = await getLease(ctx, nullId);
      return {
        setId,
        nullId,
        pointers: [
          { publicId: set.publicId, openGuaranteeId: set.openGuaranteeId },
          { publicId: nul.publicId, openGuaranteeId: nul.openGuaranteeId },
        ],
      };
    });

    expect(setId).not.toBe(nullId);
    expect(pointers).toEqual([
      { publicId: "LSE-P-SET", openGuaranteeId: guaranteeId },
      { publicId: "LSE-P-NULL", openGuaranteeId: null },
    ]);

    // Inside `v.union(v.id("guarantees"), v.null())` the per-branch message is
    // swallowed; the validator reports the union's member types instead.
    for (const wrongTable of [setId, agencyId, tenantId]) {
      await expect(
        t.run((ctx) =>
          ctx.db.insert(
            "leases",
            // hook-ok: deliberately wrong-table id for a validator test
            malformed(leaseDoc({ agencyId, tenantId, publicId: "LSE-P-WRONG" }), {
              openGuaranteeId: wrongTable,
            }),
          ),
        ),
      ).rejects.toThrow(/Expected one of id, null/);
    }
  });

  test("refuses a propertyKind outside residential|commercial and a payer other than tenant", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const tenantId = await t.run((ctx) => insertTenantRow(ctx));

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          malformed(leaseDoc({ agencyId, tenantId, publicId: "LSE-KIND" }), {
            propertyKind: "industrial",
          }),
        ),
      ),
    ).rejects.toThrow(/Expected one of literal, literal, got `"industrial"`/);

    for (const payer of ["landlord", "agency"]) {
      await expect(
        t.run((ctx) =>
          ctx.db.insert(
            "leases",
            malformed(leaseDoc({ agencyId, tenantId, publicId: "LSE-PAYER" }), { payer }),
          ),
        ),
      ).rejects.toThrow(new RegExp(`Expected \`tenant\`, got \`${payer}\``));
    }

    const persisted = await t.run(async (ctx) => publicIds(await leasesByAgency(ctx, agencyId)));
    expect(persisted).toEqual([]);
  });

  test("refuses embedded tenant fields and unknown keys inside property and rent — tenantId is the only tenant reference", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const tenantId = await t.run((ctx) => insertTenantRow(ctx));
    const valid = leaseDoc({ agencyId, tenantId, publicId: "LSE-EXTRA" });

    await expect(
      t.run((ctx) => ctx.db.insert("leases", malformed(valid, { tenantCpf: "52998224725" }))),
    ).rejects.toThrow(/Unexpected field `tenantCpf` in object/);

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          malformed(valid, { tenant: { cpf: "52998224725", fullName: "Embedded Tenant" } }),
        ),
      ),
    ).rejects.toThrow(/Unexpected field `tenant` in object/);

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          malformed(valid, { property: { ...valid.property, city: "São Paulo" } }),
        ),
      ),
    ).rejects.toThrow(/Unexpected field `city` in object/);

    await expect(
      t.run((ctx) =>
        ctx.db.insert("leases", malformed(valid, { rent: { ...valid.rent, iptuCents: 0 } })),
      ),
    ).rejects.toThrow(/Unexpected field `iptuCents` in object/);

    const persisted = await t.run(async (ctx) => publicIds(await leasesByAgency(ctx, agencyId)));
    expect(persisted).toEqual([]);
  });

  test("refuses a wrong-typed tag, cep and rentCents and a rent object missing totalRentCents (the 3-field input shape)", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const tenantId = await t.run((ctx) => insertTenantRow(ctx));
    const valid = leaseDoc({ agencyId, tenantId, publicId: "LSE-TYPES" });

    await expect(
      t.run((ctx) => ctx.db.insert("leases", malformed(valid, { tag: 402 }))),
    ).rejects.toThrow(/Expected `string`, got `402`/);

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          malformed(valid, { property: { ...valid.property, cep: 1000000 } }),
        ),
      ),
    ).rejects.toThrow(/Expected `string`, got `1000000`/);

    await expect(
      t.run((ctx) =>
        ctx.db.insert("leases", malformed(valid, { rent: { ...valid.rent, rentCents: "100000" } })),
      ),
    ).rejects.toThrow(/Expected `number`, got `100000`/);

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "leases",
          malformed(valid, { rent: { rentCents: 100_000, condoCents: 0, otherFeesCents: 0 } }),
        ),
      ),
    ).rejects.toThrow(/Missing required field `totalRentCents` in object/);

    const persisted = await t.run(async (ctx) => publicIds(await leasesByAgency(ctx, agencyId)));
    expect(persisted).toEqual([]);
  });

  const REQUIRED_TOP_LEVEL_KEYS: (keyof NewLease)[] = [
    "agencyId",
    "publicId",
    "tenantId",
    "propertyKind",
    "property",
    "tag",
    "description",
    "rent",
    "payer",
    "openGuaranteeId",
  ];

  test.each(REQUIRED_TOP_LEVEL_KEYS)(
    "refuses a lease missing the required top-level field `%s`",
    async (key) => {
      const t = setupStrict();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const tenantId = await t.run((ctx) => insertTenantRow(ctx));

      await expect(
        t.run((ctx) =>
          ctx.db.insert(
            "leases",
            withoutKey(leaseDoc({ agencyId, tenantId, publicId: "LSE-MISSING" }), key),
          ),
        ),
      ).rejects.toThrow(new RegExp(`Missing required field \`${key}\` in object`));
    },
  );

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

    // Planted rows prove every branch of the oracle fires, so the empty list
    // above is evidence rather than a silent no-op. Agency B stays clean.
    const planted = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx, TENANT_T_TAX_ID);
      await insertLeaseRow(ctx, {
        agencyId: agencyA,
        tenantId,
        publicId: "LSE-FLOAT",
        rent: { rentCents: 1000.5, condoCents: 0, otherFeesCents: 0, totalRentCents: 1000.5 },
      });
      await insertLeaseRow(ctx, {
        agencyId: agencyA,
        tenantId,
        publicId: "LSE-ZERO",
        rent: { rentCents: 0, condoCents: 0, otherFeesCents: 0, totalRentCents: 0 },
      });
      await insertLeaseRow(ctx, {
        agencyId: agencyA,
        tenantId,
        publicId: "LSE-NEGFEES",
        rent: { rentCents: 1000, condoCents: 0, otherFeesCents: -5, totalRentCents: 1000 },
      });
      return {
        problemsA: rentProblems(await leasesByAgency(ctx, agencyA)),
        problemsB: rentProblems(await leasesByAgency(ctx, agencyB)),
      };
    });

    expect(planted.problemsA).toEqual([
      { lease: "LSE-FLOAT", problem: "non-integer rent leg" },
      { lease: "LSE-FLOAT", problem: "rejected by isValidRentInput" },
      { lease: "LSE-NEGFEES", problem: "rejected by isValidRentInput" },
      { lease: "LSE-NEGFEES", problem: "total does not equal the sum of the legs" },
      { lease: "LSE-ZERO", problem: "rejected by isValidRentInput" },
    ]);
    expect(planted.problemsB).toEqual([]);
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

  test("the strict schema persists a float, a negative and a zero rentCents unchanged — v.number() enforces neither integrality nor sign, so isValidRentInput is the only guard", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const rents = await t.run(async (ctx) => {
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
      return byPublicId(await leasesByAgency(ctx, agencyId)).map((row) => ({
        publicId: row.publicId,
        rent: row.rent,
      }));
    });

    expect(rents).toEqual([
      {
        publicId: "LSE-FLOAT",
        rent: { rentCents: 1000.5, condoCents: 0, otherFeesCents: 0, totalRentCents: 1000.5 },
      },
      {
        publicId: "LSE-NEG",
        rent: { rentCents: -100, condoCents: 0, otherFeesCents: 0, totalRentCents: -100 },
      },
      {
        publicId: "LSE-OK",
        rent: { rentCents: 1, condoCents: 0, otherFeesCents: 0, totalRentCents: 1 },
      },
      {
        publicId: "LSE-ZERO",
        rent: { rentCents: 0, condoCents: 0, otherFeesCents: 0, totalRentCents: 0 },
      },
    ]);
  });
});

describe("property — persisted cityUF drives product eligibility", () => {
  // The path `guarantees.create` takes: read the lease, derive the UF from the
  // persisted `cityUF`, and hand it to `isEligible` as the subject. The
  // eligibility objects are literals — products are not this domain's table.
  const OPEN: ProductEligibility = {
    agencyIds: null,
    regionUFs: null,
    minTier: null,
    propertyKinds: null,
  };
  const RS_ONLY: ProductEligibility = { ...OPEN, regionUFs: ["RS"] };
  const SP_ONLY: ProductEligibility = { ...OPEN, regionUFs: ["SP"] };
  const COMMERCIAL_ONLY: ProductEligibility = { ...OPEN, propertyKinds: ["commercial"] };

  test("persisted cityUF drives product eligibility: well-formed UF matches regionUFs, malformed UF never matches a region-restricted product", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const verdicts = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-POA-RES",
        cityUF: "Porto Alegre/RS",
      });
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-POA-COM",
        cityUF: "porto alegre / rs",
        propertyKind: "commercial",
      });
      await insertLeaseRow(ctx, {
        agencyId,
        tenantId,
        publicId: "LSE-NO-UF",
        cityUF: "Brasília",
      });
      return byPublicId(await leasesByAgency(ctx, agencyId)).map((lease) => {
        const subject = {
          agencyId: lease.agencyId,
          uf: ufFromCityUF(lease.property.cityUF),
          tier: "bom" as const,
          propertyKind: lease.propertyKind,
        };
        return {
          publicId: lease.publicId,
          uf: subject.uf,
          open: isEligible({ eligibility: OPEN }, subject),
          rsOnly: isEligible({ eligibility: RS_ONLY }, subject),
          spOnly: isEligible({ eligibility: SP_ONLY }, subject),
          commercialOnly: isEligible({ eligibility: COMMERCIAL_ONLY }, subject),
        };
      });
    });

    expect(verdicts).toEqual([
      {
        publicId: "LSE-NO-UF",
        uf: null,
        open: true,
        rsOnly: false,
        spOnly: false,
        commercialOnly: false,
      },
      {
        publicId: "LSE-POA-COM",
        uf: "RS",
        open: true,
        rsOnly: true,
        spOnly: false,
        commercialOnly: true,
      },
      {
        publicId: "LSE-POA-RES",
        uf: "RS",
        open: true,
        rsOnly: true,
        spOnly: false,
        commercialOnly: false,
      },
    ]);
  });
});

describe("field mutability — patches in place", () => {
  test("patches tag, description, complement and propertyKind in place without touching rent, payer, tenantId or the pointer", async () => {
    const t = setupStrict();
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

  test("strict harness validates patches too — bad literals and the input rent shape are refused on patch and the row is left unchanged", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const leaseId = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      return insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-PATCH" });
    });

    await expect(
      // hook-ok: deliberately undeclared literal to exercise the validator on patch
      t.run((ctx) => ctx.db.patch(leaseId, malformed({}, { propertyKind: "industrial" }))),
    ).rejects.toThrow(/Expected one of literal, literal, got `"industrial"`/);

    await expect(
      // hook-ok: deliberately undeclared literal to exercise the validator on patch
      t.run((ctx) => ctx.db.patch(leaseId, malformed({}, { payer: "landlord" }))),
    ).rejects.toThrow(/Expected `tenant`, got `landlord`/);

    await expect(
      t.run((ctx) =>
        ctx.db.patch(
          leaseId,
          // hook-ok: deliberately incomplete rent bundle to exercise the validator on patch
          malformed({}, { rent: { rentCents: 200_000, condoCents: 0, otherFeesCents: 0 } }),
        ),
      ),
    ).rejects.toThrow(/Missing required field `totalRentCents` in object/);

    await expect(
      // hook-ok: deliberately undeclared field to exercise the validator on patch
      t.run((ctx) => ctx.db.patch(leaseId, malformed({}, { tenantCpf: "52998224725" }))),
    ).rejects.toThrow(/Unexpected field `tenantCpf` in object/);

    const unchanged = await t.run((ctx) => getLease(ctx, leaseId));
    expect(unchanged.propertyKind).toBe("residential");
    expect(unchanged.payer).toBe("tenant");
    expect(unchanged.rent).toEqual({
      rentCents: 100_000,
      condoCents: 0,
      otherFeesCents: 0,
      totalRentCents: 100_000,
    });
  });

  test("a rent patch on the lease changes the living rent and leaves the open guarantee's terms.rentCents snapshot untouched", async () => {
    const t = setupStrict();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "active", rentCents: 100_000 },
      "RJ1",
    );

    const before = await t.run(async (ctx) => {
      const guarantee = await ctx.db.get(guaranteeId);
      return { snapshot: guarantee?.terms.rentCents, living: (await getLease(ctx, leaseId)).rent };
    });
    expect(before).toEqual({
      snapshot: 100_000,
      living: { rentCents: 100_000, condoCents: 0, otherFeesCents: 0, totalRentCents: 100_000 },
    });

    const after = await t.run(async (ctx) => {
      await ctx.db.patch(leaseId, {
        rent: buildLeaseRent({ rentCents: 110_000, condoCents: 30_000, otherFeesCents: 0 }),
      });
      const guarantee = await ctx.db.get(guaranteeId);
      const lease = await getLease(ctx, leaseId);
      return {
        snapshot: guarantee?.terms.rentCents,
        living: lease.rent,
        pointer: lease.openGuaranteeId,
      };
    });

    expect(after).toEqual({
      snapshot: 100_000,
      living: {
        rentCents: 110_000,
        condoCents: 30_000,
        otherFeesCents: 0,
        totalRentCents: 140_000,
      },
      pointer: guaranteeId,
    });
  });
});

describe("index reads — leases", () => {
  test("by_publicId resolves one lease with .unique() and returns null for an unknown publicId", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");

    const { tenantId, leaseBId, hit, miss } = await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-A" });
      const leaseBId = await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-B" });
      await insertLeaseRow(ctx, { agencyId, tenantId, publicId: "LSE-C" });
      return {
        tenantId,
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

    expect(hit).toEqual({
      _id: leaseBId,
      _creationTime: expect.any(Number),
      agencyId,
      publicId: "LSE-B",
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
    expect(miss).toBe(null);
  });

  test("by_agency_tenant ordered desc returns the tenant's leases newest-first — the prefill consumer's contract; by_tenant desc agrees", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");

    const result = await t.run(async (ctx) => {
      const tenantT = await insertTenantRow(ctx, TENANT_T_TAX_ID);
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId: tenantT, publicId: "LSE-T1" });
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId: tenantT, publicId: "LSE-T2" });
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId: tenantT, publicId: "LSE-T3" });
      const newestFirst = await ctx.db
        .query("leases")
        .withIndex("by_agency_tenant", (q) => q.eq("agencyId", agencyA).eq("tenantId", tenantT))
        .order("desc")
        .collect();
      const byTenantNewestFirst = await ctx.db
        .query("leases")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantT))
        .order("desc")
        .collect();
      return {
        newestFirst: publicIds(newestFirst),
        byTenantNewestFirst: publicIds(byTenantNewestFirst),
        strictlyDescending: newestFirst.every(
          (row, i, rows) => i === 0 || (rows[i - 1]?._creationTime ?? 0) > row._creationTime,
        ),
      };
    });

    expect(result.newestFirst).toEqual(["LSE-T3", "LSE-T2", "LSE-T1"]);
    expect(result.byTenantNewestFirst).toEqual(["LSE-T3", "LSE-T2", "LSE-T1"]);
    expect(result.strictlyDescending).toBe(true);
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

    // The prefix read sorts by (agencyId, tenantId, _creationTime); tenant ids
    // are opaque, so the assertion is set equality with by_agency, not order.
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
        prefixIds: publicIds(byPublicId(prefix)),
        prefixRowIds: prefix.map((row) => row._id).sort(),
        byAgencyRowIds: byAgency.map((row) => row._id).sort(),
      };
    });

    expect(prefixIds).toEqual(["LSE-T1", "LSE-T2", "LSE-U1"]);
    expect(prefixRowIds).toEqual(byAgencyRowIds);
  });

  test("by_agency and by_agency_tenant follow an agencyId patch on a lease while by_tenant is unaffected", async () => {
    const t = setupStrict();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");

    const result = await t.run(async (ctx) => {
      const tenantT = await insertTenantRow(ctx, TENANT_T_TAX_ID);
      const leaseId = await insertLeaseRow(ctx, {
        agencyId: agencyA,
        tenantId: tenantT,
        publicId: "LSE-MOVE",
      });
      await ctx.db.patch(leaseId, { agencyId: agencyB });
      return {
        byAgencyA: publicIds(await leasesByAgency(ctx, agencyA)),
        byAgencyB: publicIds(await leasesByAgency(ctx, agencyB)),
        aT: publicIds(await leasesByAgencyTenant(ctx, agencyA, tenantT)),
        bT: publicIds(await leasesByAgencyTenant(ctx, agencyB, tenantT)),
        byTenant: publicIds(await leasesByTenant(ctx, tenantT)),
      };
    });

    expect(result).toEqual({
      byAgencyA: [],
      byAgencyB: ["LSE-MOVE"],
      aT: [],
      bT: ["LSE-MOVE"],
      byTenant: ["LSE-MOVE"],
    });
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

  test("by_publicId .unique() throws when two agencies share a publicId — the index enforces no uniqueness, so a deep-link resolver must scope by agency or enforce uniqueness at create time", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");

    await t.run(async (ctx) => {
      const tenantId = await insertTenantRow(ctx);
      await insertLeaseRow(ctx, { agencyId: agencyA, tenantId, publicId: "LSE-DUP" });
      await insertLeaseRow(ctx, { agencyId: agencyB, tenantId, publicId: "LSE-DUP" });
    });

    await expect(
      t.run((ctx) =>
        ctx.db
          .query("leases")
          .withIndex("by_publicId", (q) => q.eq("publicId", "LSE-DUP"))
          .unique(),
      ),
    ).rejects.toThrow(/unique\(\) query returned more than one result from table leases/);

    // The agency-scoped read the resolver has to fall back to.
    const scoped = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("leases")
        .withIndex("by_publicId", (q) => q.eq("publicId", "LSE-DUP"))
        .collect();
      return rows.filter((row) => row.agencyId === agencyA).map((row) => row.agencyId);
    });
    expect(scoped).toEqual([agencyA]);
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

  test("lease-side pointer sweep across two agencies is clean with one lease per GUARANTEE_STATE; the six non-closed states hold the pointer and closed releases it", async () => {
    const t = setup();
    const agencyA = await seedAgency(t, "Agency A", "00000000000101");
    const agencyB = await seedAgency(t, "Agency B", "00000000000202");
    // Order is GUARANTEE_STATES; the literal below is indexed the same way.
    const seeded = [
      await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "drafted" }, "S1"),
      await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "active" }, "S2"),
      await seedGuaranteeWithLease(t, { agencyId: agencyA, status: "in_arrears" }, "S3"),
      await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "default_verified" }, "S4"),
      await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "cover_committed" }, "S5"),
      await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "in_eviction" }, "S6"),
      await seedGuaranteeWithLease(t, { agencyId: agencyB, status: "closed" }, "S7"),
    ];

    const { problemsA, problemsB, statuses, pointsAtOwnGuarantee, closedPointer } = await t.run(
      async (ctx) => {
        const leases = await Promise.all(seeded.map((s) => getLease(ctx, s.leaseId)));
        const guarantees = await Promise.all(seeded.map((s) => ctx.db.get(s.guaranteeId)));
        return {
          problemsA: await leasePointerProblems(ctx, agencyA),
          problemsB: await leasePointerProblems(ctx, agencyB),
          statuses: guarantees.map((g) => g?.status),
          pointsAtOwnGuarantee: leases.map(
            (lease, i) => lease.openGuaranteeId === seeded[i]?.guaranteeId,
          ),
          closedPointer: leases[6]?.openGuaranteeId,
        };
      },
    );

    expect(statuses).toEqual([
      "drafted",
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
      "closed",
    ]);
    expect(statuses).toEqual([...GUARANTEE_STATES]);
    expect(problemsA).toEqual([]);
    expect(problemsB).toEqual([]);
    expect(pointsAtOwnGuarantee).toEqual([true, true, true, true, true, true, false]);
    expect(closedPointer).toBe(null);
  });

  const NON_CLOSED_STATES: GuaranteeState[] = [
    "drafted",
    "active",
    "in_arrears",
    "default_verified",
    "cover_committed",
    "in_eviction",
  ];

  test("NON_CLOSED_STATES is every GUARANTEE_STATE except closed", () => {
    expect([...NON_CLOSED_STATES, "closed"]).toEqual([...GUARANTEE_STATES]);
  });

  test.each(NON_CLOSED_STATES)(
    "a %s guarantee holds the lease pointer, makes the guard refuse with the literal error, and leaves the sweep clean",
    async (status) => {
      const t = setup();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
        t,
        { agencyId, status },
        `ST-${status}`,
      );

      const { pointer, guard, sweep } = await t.run(async (ctx) => {
        const lease = await getLease(ctx, leaseId);
        return {
          pointer: lease.openGuaranteeId,
          guard: assertLeaseAcceptsGuarantee(lease),
          sweep: await leasePointerProblems(ctx, agencyId),
        };
      });

      expect(pointer).toBe(guaranteeId);
      expect(guard).toEqual({
        success: false,
        error: { code: "LEASE_HAS_OPEN_GUARANTEE" },
        message: `Lease ${leaseId} already has an open guarantee (${guaranteeId}).`,
      });
      expect(sweep).toEqual([]);
    },
  );

  test("a lease whose only guarantee is closed has a null pointer, the guard accepts, and the sweep is clean", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    const { leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: "closed" },
      "ST-closed",
    );

    const { pointer, guard, sweep } = await t.run(async (ctx) => {
      const lease = await getLease(ctx, leaseId);
      return {
        pointer: lease.openGuaranteeId,
        guard: assertLeaseAcceptsGuarantee(lease),
        sweep: await leasePointerProblems(ctx, agencyId),
      };
    });

    expect(pointer).toBe(null);
    expect(guard).toEqual({
      success: true,
      data: { leaseId },
      message: "Lease accepts a new guarantee.",
    });
    expect(sweep).toEqual([]);
  });

  test("CLOSE_REASONS lists the seven documented reasons", () => {
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

  test.each([...CLOSE_REASONS])(
    "a lease whose guarantee closed under %s has a null pointer and accepts a new guarantee — the lease side is indifferent to why",
    async (closeReason: CloseReason) => {
      const t = setup();
      const agencyId = await seedAgency(t, "Agency A", "00000000000101");
      const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
        t,
        { agencyId, status: "closed", closeReason },
        `CR-${closeReason}`,
      );

      const { reason, pointer, guard } = await t.run(async (ctx) => {
        const guarantee = await ctx.db.get(guaranteeId);
        const lease = await getLease(ctx, leaseId);
        return {
          reason: guarantee?.closure?.reason,
          pointer: lease.openGuaranteeId,
          guard: assertLeaseAcceptsGuarantee(lease),
        };
      });

      expect(reason).toBe(closeReason);
      expect(pointer).toBe(null);
      expect(guard).toEqual({
        success: true,
        data: { leaseId },
        message: "Lease accepts a new guarantee.",
      });
    },
  );

  test("lease with two closed lives and one open guarantee: sweep clean, pointer at the open row", async () => {
    const t = setup();
    const agencyId = await seedAgency(t, "Agency A", "00000000000101");
    // The fixture seeds one guarantee per lease; the two closed lives are
    // re-parented onto the first lease at the db layer, mirroring a lease that
    // has been guaranteed three times over the years.
    const first = await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: "closed",
        closeReason: "end_of_lease",
        closedAt: "2024-06-01T00:00:00.000Z",
      },
      "L1",
    );
    const second = await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: "closed",
        closeReason: "rescission",
        closedAt: "2025-06-01T00:00:00.000Z",
      },
      "L2",
    );
    const open = await seedGuaranteeWithLease(t, { agencyId, status: "active" }, "L3");

    const result = await t.run(async (ctx) => {
      await ctx.db.patch(second.guaranteeId, { leaseId: first.leaseId });
      await ctx.db.patch(open.guaranteeId, { leaseId: first.leaseId });
      await ctx.db.patch(first.leaseId, { openGuaranteeId: open.guaranteeId });
      await ctx.db.patch(open.leaseId, { openGuaranteeId: null });
      await ctx.db.delete(second.leaseId);
      await ctx.db.delete(open.leaseId);

      const lease = await getLease(ctx, first.leaseId);
      const rows = await guaranteesByLease(ctx, first.leaseId);
      return {
        history: rows
          .map((row) => ({
            publicId: row.publicId,
            status: row.status,
            closeReason: row.closure?.reason ?? null,
          }))
          .sort((a, b) => a.publicId.localeCompare(b.publicId)),
        pointer: lease.openGuaranteeId,
        guard: assertLeaseAcceptsGuarantee(lease),
        sweep: await leasePointerProblems(ctx, agencyId),
        leaseCount: (await leasesByAgency(ctx, agencyId)).length,
      };
    });

    expect(result.history).toEqual([
      { publicId: "L1", status: "closed", closeReason: "end_of_lease" },
      { publicId: "L2", status: "closed", closeReason: "rescission" },
      { publicId: "L3", status: "active", closeReason: null },
    ]);
    expect(result.pointer).toBe(open.guaranteeId);
    expect(result.guard).toEqual({
      success: false,
      error: { code: "LEASE_HAS_OPEN_GUARANTEE" },
      message: `Lease ${first.leaseId} already has an open guarantee (${open.guaranteeId}).`,
    });
    expect(result.sweep).toEqual([]);
    expect(result.leaseCount).toBe(1);
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
