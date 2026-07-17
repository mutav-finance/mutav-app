// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { AuditActor } from "../audit/domain";
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

  test("re-encounter last-write-wins on email/phone; fullName untouched", async () => {
    const t = setup();

    await t.run((ctx) => getOrCreateTenant(ctx, { input: pfInput(), actor: SYSTEM_ACTOR }));
    await t.run((ctx) =>
      getOrCreateTenant(ctx, {
        input: pfInput({ email: "maria.nova@example.com", phone: "11911111111" }),
        actor: SYSTEM_ACTOR,
      }),
    );

    const rows = await listTenants(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("maria.nova@example.com");
    expect(rows[0].phone).toBe("11911111111");
    expect(rows[0].fullName).toBe("Maria Silva");
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
