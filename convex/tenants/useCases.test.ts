// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import type { AuditActor } from "../audit/domain";
import {
  registerContractAggregateComponents,
  seedAgencyWithMembership,
  setupAuthenticatedUser,
  type SeededUserId,
  seedFreshCreditAssessment,
} from "../lib/testFixtures";
import { tenantToSep9Prefill } from "../payments/providers/tenantPrefill";
import schema from "../schema";
import { normalizeEmbeddedTenant, type TenantInput } from "./domain";
import { getOrCreateTenant } from "./useCases";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64"); // hook-ok: test-only env fixture
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64"); // hook-ok: test-only env fixture
});

const VALID_CPF = "52998224725";
const VALID_CPF_2 = "11144477735";
const VALID_CNPJ = "11444777000161";

const SYSTEM_ACTOR: AuditActor = { kind: "system", source: "test" };

function pfInput(overrides: Partial<Extract<TenantInput, { entityType: "pf" }>> = {}): TenantInput {
  return {
    entityType: "pf",
    taxId: VALID_CPF,
    fullName: "Maria Silva",
    birthDate: "1990-05-12",
    email: "maria@example.com",
    phone: "11900000001",
    ...overrides,
  };
}

function setup() {
  return convexTest(schema);
}

async function listTenants(t: ReturnType<typeof setup>) {
  return t.run((ctx) => ctx.db.query("tenants").collect());
}

async function auditEntriesFor(t: ReturnType<typeof setup>, resourceId: string) {
  return t.run((ctx) =>
    ctx.db
      .query("mutavAuditLog")
      .withIndex("by_resource", (q) => q.eq("resourceType", "tenants").eq("resourceId", resourceId))
      .collect(),
  );
}

describe("getOrCreateTenant", () => {
  test("two calls with the same taxId yield exactly one row; second returns the first id", async () => {
    const t = setup();

    const first = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }),
    );
    const second = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }),
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(first.data.created).toBe(true);
    expect(second.data.created).toBe(false);
    expect(second.data.tenantId).toBe(first.data.tenantId);

    const rows = await listTenants(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].taxId).toBe(VALID_CPF);
  });

  test("digits-normalizes a formatted tax id before lookup and insert", async () => {
    const t = setup();

    const formatted = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput({ taxId: "529.982.247-25" }), actor: SYSTEM_ACTOR }),
    );
    const plain = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }),
    );

    expect(formatted.success).toBe(true);
    expect(plain.success).toBe(true);
    if (!formatted.success || !plain.success) return;
    expect(plain.data.tenantId).toBe(formatted.data.tenantId);

    const rows = await listTenants(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].taxId).toBe(VALID_CPF);
  });

  test.each([
    ["bad check digits", "52998224726"],
    ["repeated digits", "11111111111"],
    ["wrong length", "5299822472"],
  ])("rejects a CPF with %s and inserts nothing", async (_label, taxId) => {
    const t = setup();

    const result = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput({ taxId }), actor: SYSTEM_ACTOR }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_TAX_ID");
    expect(await listTenants(t)).toHaveLength(0);
  });

  test("rejects an invalid CNPJ and inserts nothing", async () => {
    const t = setup();

    const result = await t.run((ctx) =>
      getOrCreateTenant(ctx, {
        input: {
          entityType: "pj",
          taxId: "11444777000162",
          fullName: "Empresa Ltda",
          email: "contato@empresa.com",
          phone: "11900000002",
        },
        actor: SYSTEM_ACTOR,
      }),
    );

    expect(result.success).toBe(false);
    expect(await listTenants(t)).toHaveLength(0);
  });

  test("re-encounter never overwrites email/phone and appends one audit entry", async () => {
    const t = setup();

    const first = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }),
    );
    expect(first.success).toBe(true);
    if (!first.success) return;

    await t.run((ctx) =>
      getOrCreateTenant(ctx, {
        input: pfInput({ email: "maria.nova@example.com", phone: "11911111111" }),
        actor: SYSTEM_ACTOR,
      }),
    );

    const rows = await listTenants(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("maria@example.com");
    expect(rows[0].phone).toBe("11900000001");
    expect(rows[0].fullName).toBe("Maria Silva");

    const entries = await auditEntriesFor(t, first.data.tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("tenant.data_conflict");
  });

  test.each([
    ["fullName", { fullName: "Maria S. Santos" }],
    ["email", { email: "maria.nova@example.com" }],
    ["phone", { phone: "11911111111" }],
    ["birthDate", { birthDate: "1991-01-01" }],
  ])("a divergent %s alone appends an audit entry", async (_field, override) => {
    const t = setup();

    const first = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }),
    );
    expect(first.success).toBe(true);
    if (!first.success) return;

    await t.run((ctx) => getOrCreateTenant(ctx, { input: pfInput(override), actor: SYSTEM_ACTOR }));

    const entries = await auditEntriesFor(t, first.data.tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("tenant.data_conflict");
  });

  test("a divergent pj contactCpf appends an audit entry and is not overwritten", async () => {
    const t = setup();

    const pjInput = (contactCpf: string | undefined): TenantInput => ({
      entityType: "pj",
      taxId: VALID_CNPJ,
      fullName: "Empresa Ltda",
      ...(contactCpf === undefined ? {} : { contactCpf }),
      email: "contato@empresa.com",
      phone: "11900000002",
    });

    const first = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pjInput(VALID_CPF), actor: SYSTEM_ACTOR }),
    );
    expect(first.success).toBe(true);
    if (!first.success) return;

    await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pjInput(VALID_CPF_2), actor: SYSTEM_ACTOR }),
    );

    const rows = await listTenants(t);
    expect(rows).toHaveLength(1);
    if (rows[0].entityType === "pj") {
      expect(rows[0].contactCpf).toBe(VALID_CPF);
    }

    const entries = await auditEntriesFor(t, first.data.tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("tenant.data_conflict");
  });

  test("re-encounter with conflicting fullName/birthDate keeps registry values and appends one audit entry", async () => {
    const t = setup();

    const first = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }),
    );
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = await t.run((ctx) =>
      getOrCreateTenant(ctx, {
        input: pfInput({ fullName: "Maria S. Santos", birthDate: "1991-01-01" }),
        actor: SYSTEM_ACTOR,
      }),
    );
    expect(second.success).toBe(true);

    const rows = await listTenants(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("Maria Silva");
    if (rows[0].entityType === "pf") {
      expect(rows[0].birthDate).toBe("1990-05-12");
    }

    const entries = await auditEntriesFor(t, first.data.tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("tenant.data_conflict");
    expect(entries[0].actor).toEqual(SYSTEM_ACTOR);
  });

  test("matching re-encounter appends no audit entry", async () => {
    const t = setup();

    const first = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }),
    );
    await t.run((ctx) => getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }));

    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(await auditEntriesFor(t, first.data.tenantId)).toHaveLength(0);
  });

  test("internal wrapper resolves the same registry row as the helper", async () => {
    const t = setup();

    const viaWrapper = await t.mutation(internal.tenants.useCases.getOrCreate, {
      input: pfInput({ taxId: VALID_CPF_2 }),
      actor: SYSTEM_ACTOR,
    });
    const viaHelper = await t.run((ctx) =>
      getOrCreateTenant(ctx, { input: pfInput({ taxId: VALID_CPF_2 }), actor: SYSTEM_ACTOR }),
    );

    expect(viaWrapper.success).toBe(true);
    expect(viaHelper.success).toBe(true);
    if (!viaWrapper.success || !viaHelper.success) return;
    expect(viaHelper.data.tenantId).toBe(viaWrapper.data.tenantId);
  });
});

describe("normalizeEmbeddedTenant", () => {
  const base = {
    fullName: "Empresa Teste Ltda",
    birthDate: "",
    email: "contato@empresa.com",
    phone: "11900000003",
  };

  test("pj with CNPJ digits living in the cpf field resolves taxId from it, no contactCpf fabricated", async () => {
    const input = normalizeEmbeddedTenant({
      ...base,
      entityType: "pj",
      cpf: VALID_CNPJ,
    });

    expect(input).not.toBeNull();
    if (!input) return;
    expect(input.entityType).toBe("pj");
    expect(input.taxId).toBe(VALID_CNPJ);
    if (input.entityType === "pj") {
      expect(input.contactCpf).toBeUndefined();
    }
  });

  test("pj with empty-string cnpj counts as absent and falls back to the cpf field", async () => {
    const input = normalizeEmbeddedTenant({
      ...base,
      entityType: "pj",
      cpf: VALID_CNPJ,
      cnpj: "",
    });

    expect(input?.taxId).toBe(VALID_CNPJ);
    if (input?.entityType === "pj") {
      expect(input.contactCpf).toBeUndefined();
    }
  });

  test("pj with a real cnpj and a CPF-length cpf keeps the contact CPF", async () => {
    const input = normalizeEmbeddedTenant({
      ...base,
      entityType: "pj",
      cpf: VALID_CPF,
      cnpj: VALID_CNPJ,
    });

    expect(input?.taxId).toBe(VALID_CNPJ);
    if (input?.entityType === "pj") {
      expect(input.contactCpf).toBe(VALID_CPF);
    }
  });

  test("pf with a checksum-invalid cpf returns null", async () => {
    const input = normalizeEmbeddedTenant({
      ...base,
      entityType: "pf",
      cpf: "11111111111",
      birthDate: "1990-01-01",
    });
    expect(input).toBeNull();
  });

  test("pf without birthDate returns null", async () => {
    const input = normalizeEmbeddedTenant({
      ...base,
      entityType: "pf",
      cpf: VALID_CPF,
    });
    expect(input).toBeNull();
  });

  test("missing entityType defaults to pf", async () => {
    const input = normalizeEmbeddedTenant({
      ...base,
      cpf: VALID_CPF,
      birthDate: "1990-01-01",
    });
    expect(input?.entityType).toBe("pf");
    expect(input?.taxId).toBe(VALID_CPF);
  });
});

describe("lookupTenantByTaxId (relationship-gated)", () => {
  async function seedSecondAgencyForUser(
    t: ReturnType<typeof setup>,
    userId: SeededUserId,
    cnpj: string,
  ): Promise<AgencyId> {
    return t.run(async (ctx) => {
      const agencyId = await ctx.db.insert("agencies", {
        name: `Second Agency ${cnpj}`,
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

  function pfContractArgs(agencyId: AgencyId) {
    return {
      agencyId,
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo / SP",
      },
      optional: { complement: "", tag: "", description: "" },
      propertyKind: "residencial" as const,
      plan: "basic" as const,
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
      },
    };
  }

  test("related agency gets prefill; unrelated agency and unknown tax id both get null (no existence leak)", async () => {
    const t = setup();
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyA = await seedAgencyWithMembership(t, userId);
    await seedFreshCreditAssessment(t, { agencyId: agencyA, document: VALID_CPF, score: 750 });
    await seedFreshCreditAssessment(t, { agencyId: agencyA, document: VALID_CNPJ, score: 650 });
    const agencyB = await seedSecondAgencyForUser(t, userId, "00000000000200");

    const created = await asUser.mutation(api.contracts.useCases.create, pfContractArgs(agencyA));
    expect(created.success).toBe(true);

    const fromRelated = await asUser.query(api.tenants.useCases.lookupTenantByTaxId, {
      agencyId: agencyA,
      taxId: VALID_CPF,
    });
    expect(fromRelated).toEqual({ fullName: "Maria Silva Santos", email: "maria@example.com" });

    const fromUnrelated = await asUser.query(api.tenants.useCases.lookupTenantByTaxId, {
      agencyId: agencyB,
      taxId: VALID_CPF,
    });
    const forUnknown = await asUser.query(api.tenants.useCases.lookupTenantByTaxId, {
      agencyId: agencyA,
      taxId: VALID_CPF_2,
    });

    // Known-but-unrelated and never-registered are indistinguishable — both null.
    expect(fromUnrelated).toBeNull();
    expect(forUnknown).toBeNull();
    expect(fromUnrelated).toEqual(forUnknown);
  });

  test("a pj tenant's contact CPF is not an identity key — looking it up never leaks company data", async () => {
    const t = setup();
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedFreshCreditAssessment(t, { agencyId: agencyId, document: VALID_CPF, score: 750 });
    await seedFreshCreditAssessment(t, { agencyId: agencyId, document: VALID_CNPJ, score: 650 });

    const pjArgs = {
      ...pfContractArgs(agencyId),
      tenant: {
        entityType: "pj" as const,
        fullName: "Tech Solutions Ltda",
        cpf: VALID_CPF,
        cnpj: VALID_CNPJ,
        birthDate: "",
        email: "contato@techsolutions.example.com",
        phone: "11900000003",
      },
    };
    const created = await asUser.mutation(api.contracts.useCases.create, pjArgs);
    expect(created.success).toBe(true);

    // The registry row keys on the CNPJ; the contact CPF is stored but is not
    // a lookup key, so a pf-flow lookup by that CPF resolves nothing.
    const byContactCpf = await asUser.query(api.tenants.useCases.lookupTenantByTaxId, {
      agencyId,
      taxId: VALID_CPF,
    });
    expect(byContactCpf).toBeNull();

    // The CNPJ itself resolves within the owning agency.
    const byCnpj = await asUser.query(api.tenants.useCases.lookupTenantByTaxId, {
      agencyId,
      taxId: VALID_CNPJ,
    });
    expect(byCnpj).toEqual({
      fullName: "Tech Solutions Ltda",
      email: "contato@techsolutions.example.com",
    });
  });
});

// Multi-actor sequence: two agencies transact with the same natural person.
// The registry row is shared; neither agency may see the other's values
// through any authorized call (LGPD-26).
describe("cross-agency tenant identity", () => {
  const AGENCY_A_TENANT = {
    fullName: "Maria Silva Santos",
    birthDate: "1990-05-12",
    email: "maria@agencia-a.example.com",
    phone: "11900000001",
  };
  const AGENCY_B_TENANT = {
    fullName: "Maria S. Nascimento",
    birthDate: "1991-01-02",
    email: "maria@agencia-b.example.com",
    phone: "11922222222",
  };

  type SubmittedTenant = typeof AGENCY_A_TENANT;

  function contractArgs(agencyId: AgencyId, tenant: SubmittedTenant) {
    return {
      agencyId,
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo / SP",
      },
      optional: { complement: "", tag: "", description: "" },
      propertyKind: "residencial" as const,
      plan: "basic" as const,
      rentCents: 300000,
      condoCents: 0,
      otherFeesCents: 0,
      tenant: {
        entityType: "pf" as const,
        fullName: tenant.fullName,
        cpf: VALID_CPF,
        cnpj: undefined,
        birthDate: tenant.birthDate,
        email: tenant.email,
        phone: tenant.phone,
        score: 750,
      },
    };
  }

  async function seedAgencyFor(
    t: ReturnType<typeof setup>,
    userId: SeededUserId,
    cnpj: string,
  ): Promise<AgencyId> {
    return t.run(async (ctx) => {
      const agencyId = await ctx.db.insert("agencies", {
        name: `Agency ${cnpj}`,
        cnpj,
        agencyType: "empresa",
        onboardingState: "active",
        createdAt: "2024-01-01T00:00:00-03:00",
      });
      await ctx.db.insert("memberships", {
        userId,
        agencyId,
        role: "owner",
        joinedAt: "2024-01-01T00:00:00-03:00",
      });
      return agencyId;
    });
  }

  async function bothAgenciesRegisterTheSameCpf(t: ReturnType<typeof setup>) {
    registerContractAggregateComponents(t);

    const a = await setupAuthenticatedUser(t, {
      subject: "auth0|agency-a-owner",
      email: "owner-a@mutav.test",
      name: "Owner A",
    });
    const agencyA = await seedAgencyFor(t, a.userId, "00000000000100");
    const b = await setupAuthenticatedUser(t, {
      subject: "auth0|agency-b-owner",
      email: "owner-b@mutav.test",
      name: "Owner B",
    });
    const agencyB = await seedAgencyFor(t, b.userId, "00000000000200");

    const createdA = await a.asUser.mutation(
      api.contracts.useCases.create,
      contractArgs(agencyA, AGENCY_A_TENANT),
    );
    const createdB = await b.asUser.mutation(
      api.contracts.useCases.create,
      contractArgs(agencyB, AGENCY_B_TENANT),
    );
    expect(createdA.success).toBe(true);
    expect(createdB.success).toBe(true);
    if (!createdA.success || !createdB.success) throw new Error("Contract creation failed");

    return { a, b, agencyA, agencyB, createdA, createdB };
  }

  test("agency B reads back its own submitted identity, never agency A's", async () => {
    const t = setup();
    const { b, createdB } = await bothAgenciesRegisterTheSameCpf(t);

    const contract = await b.asUser.query(api.contracts.useCases.getByPublicId, {
      publicId: createdB.data.publicId,
    });

    expect(contract?.tenant).toMatchObject({
      entityType: "pf",
      taxId: VALID_CPF,
      fullName: "Maria S. Nascimento",
      email: "maria@agencia-b.example.com",
      phone: "11922222222",
    });
    if (contract?.tenant.entityType === "pf") {
      expect(contract.tenant.birthDate).toBe("1991-01-02");
    }
  });

  test("agency A keeps reading its own submitted identity", async () => {
    const t = setup();
    const { a, createdA } = await bothAgenciesRegisterTheSameCpf(t);

    const contract = await a.asUser.query(api.contracts.useCases.getByPublicId, {
      publicId: createdA.data.publicId,
    });

    expect(contract?.tenant).toMatchObject({
      fullName: "Maria Silva Santos",
      email: "maria@agencia-a.example.com",
      phone: "11900000001",
    });
    if (contract?.tenant.entityType === "pf") {
      expect(contract.tenant.birthDate).toBe("1990-05-12");
    }
  });

  test("the contract list shows each agency the name it submitted", async () => {
    const t = setup();
    const { a, b, agencyA, agencyB } = await bothAgenciesRegisterTheSameCpf(t);

    const pageA = await a.asUser.query(api.contracts.useCases.listByAgency, {
      agencyId: agencyA,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const pageB = await b.asUser.query(api.contracts.useCases.listByAgency, {
      agencyId: agencyB,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(pageA.page.map((row) => row.tenantName)).toEqual(["Maria Silva Santos"]);
    expect(pageB.page.map((row) => row.tenantName)).toEqual(["Maria S. Nascimento"]);
  });

  test("the shared registry row keeps the first registrant's values on every field", async () => {
    const t = setup();
    await bothAgenciesRegisterTheSameCpf(t);

    const rows = await listTenants(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taxId: VALID_CPF,
      fullName: "Maria Silva Santos",
      email: "maria@agencia-a.example.com",
      phone: "11900000001",
    });
    if (rows[0].entityType === "pf") {
      expect(rows[0].birthDate).toBe("1990-05-12");
    }
  });

  test("the prefill lookup gives agency B its own submitted contact data, never agency A's", async () => {
    const t = setup();
    const { a, b, agencyA, agencyB } = await bothAgenciesRegisterTheSameCpf(t);

    const prefillB = await b.asUser.query(api.tenants.useCases.lookupTenantByTaxId, {
      agencyId: agencyB,
      taxId: VALID_CPF,
    });
    const prefillA = await a.asUser.query(api.tenants.useCases.lookupTenantByTaxId, {
      agencyId: agencyA,
      taxId: VALID_CPF,
    });

    expect(prefillB).toEqual({
      fullName: "Maria S. Nascimento",
      email: "maria@agencia-b.example.com",
    });
    expect(prefillA).toEqual({
      fullName: "Maria Silva Santos",
      email: "maria@agencia-a.example.com",
    });
  });

  test("the contract detail history excludes another agency's rows under the same publicId", async () => {
    const t = setup();
    const { b, agencyA, createdB } = await bothAgenciesRegisterTheSameCpf(t);

    // publicId carries no DB-level uniqueness constraint, so a collision across
    // agencies is a real state — seed re-runs already produce them.
    await t.run(async (ctx) => {
      await ctx.db.insert("contractHistory", {
        agencyId: agencyA,
        contractPublicId: createdB.data.publicId,
        at: "2025-01-01T00:00:00-03:00",
        username: "Owner A",
        message: "Agency A internal note",
      });
    });

    const contract = await b.asUser.query(api.contracts.useCases.getByPublicId, {
      publicId: createdB.data.publicId,
    });

    expect(contract?.history.map((entry) => entry.username)).toEqual(["Owner B"]);
    expect(contract?.history.map((entry) => entry.message)).not.toContain("Agency A internal note");
  });

  test("the anchor SEP-9 prefill carries agency B's own submitted contact data", async () => {
    const t = setup();
    const { createdB } = await bothAgenciesRegisterTheSameCpf(t);

    // The two steps `resolveTenantPrefill` composes inside the anchor action.
    const identity = await t.query(internal.contracts.useCases.getTenantIdentityInternal, {
      publicId: createdB.data.publicId,
    });
    expect(identity).not.toBeNull();
    if (!identity) return;

    expect(tenantToSep9Prefill(identity)).toEqual({
      first_name: "Maria",
      last_name: "S. Nascimento",
      email_address: "maria@agencia-b.example.com",
      id_number: VALID_CPF,
    });
  });

  test("the divergence appends one audit entry attributed to the second agency's user", async () => {
    const t = setup();
    const { b } = await bothAgenciesRegisterTheSameCpf(t);

    const rows = await listTenants(t);
    expect(rows).toHaveLength(1);

    const entries = await auditEntriesFor(t, rows[0]._id);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("tenant.data_conflict");
    expect(entries[0].actor).toEqual({ kind: "user", userId: b.userId });
  });
});
