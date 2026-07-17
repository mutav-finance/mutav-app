// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { AgencyId } from "./agencies/domain";
import schema from "./schema";
import { registerMigrationsComponent } from "./lib/testFixtures";

function setup() {
  const t = convexTest(schema);
  registerMigrationsComponent(t);
  return t;
}

async function seedUser(t: ReturnType<typeof setup>, email: string, isStaff: boolean | undefined) {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: `user-${email}`,
      name: "Test User",
      email,
      createdAt: new Date().toISOString(),
      ...(isStaff === undefined ? {} : { isStaff }),
    }),
  );
}

async function runClearIsStaff(t: ReturnType<typeof setup>) {
  await t.mutation(internal.migrations.clearUsersIsStaff, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("clearUsersIsStaff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("removes the field from a user that has isStaff: true", async () => {
    const t = setup();
    const id = await seedUser(t, "staff-true@mutav.test", true);

    await runClearIsStaff(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isStaff).toBeUndefined();
  });

  test("removes the field from a user that has isStaff: false", async () => {
    const t = setup();
    const id = await seedUser(t, "staff-false@mutav.test", false);

    await runClearIsStaff(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isStaff).toBeUndefined();
  });

  test("leaves a user that never had isStaff untouched", async () => {
    const t = setup();
    const id = await seedUser(t, "clean@mutav.test", undefined);

    await runClearIsStaff(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isStaff).toBeUndefined();
    expect(after?.email).toBe("clean@mutav.test");
  });

  test("clears a mixed batch and is idempotent on re-run", async () => {
    const t = setup();
    const setId = await seedUser(t, "set@mutav.test", true);
    const cleanId = await seedUser(t, "already-clean@mutav.test", undefined);

    await runClearIsStaff(t);
    await runClearIsStaff(t);

    const set = await t.run((ctx) => ctx.db.get(setId));
    const clean = await t.run((ctx) => ctx.db.get(cleanId));
    expect(set?.isStaff).toBeUndefined();
    expect(clean?.isStaff).toBeUndefined();
  });
});

async function seedAgencyFor(t: ReturnType<typeof setup>, cnpj: string): Promise<AgencyId> {
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

async function seedContract(
  t: ReturnType<typeof setup>,
  agencyId: AgencyId,
  publicId: string,
  entityType: "pf" | "pj" | undefined,
) {
  return t.run((ctx) =>
    ctx.db.insert("contracts", {
      agencyId,
      publicId,
      tenantCpf: "11144477735",
      status: "pendente",
      activatedAt: null,
      nextRenewalDate: "2026-12-31",
      availableGuaranteeCents: 100000,
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
      documents: [{ key: "rentalContract", status: "pendente" }],
      tenant: {
        approvalStatus: "pendente",
        fullName: "Test Tenant",
        cpf: "11144477735",
        birthDate: "1990-01-01",
        email: "tenant@test.br",
        phone: "11999999999",
        termApprovedAt: null,
        ...(entityType === undefined ? {} : { entityType }),
      },
    }),
  );
}

async function runBackfillEntityType(t: ReturnType<typeof setup>) {
  await t.mutation(internal.migrations.backfillTenantEntityType, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("backfillTenantEntityType", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("defaults a missing tenant.entityType to 'pf' without touching other fields", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000111");
    const id = await seedContract(t, agencyId, "C-NO-ENTITY", undefined);

    await runBackfillEntityType(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.tenant.entityType).toBe("pf");
    expect(after?.tenant.cpf).toBe("11144477735");
    expect(after?.tenant.fullName).toBe("Test Tenant");
  });

  test("leaves an explicit entityType ('pj') untouched", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000222");
    const id = await seedContract(t, agencyId, "C-PJ", "pj");

    await runBackfillEntityType(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.tenant.entityType).toBe("pj");
  });

  test("backfills a mixed batch and is idempotent on re-run", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000333");
    const missingId = await seedContract(t, agencyId, "C-MISSING", undefined);
    const pjId = await seedContract(t, agencyId, "C-PJ2", "pj");

    await runBackfillEntityType(t);
    await runBackfillEntityType(t);

    const missing = await t.run((ctx) => ctx.db.get(missingId));
    const pj = await t.run((ctx) => ctx.db.get(pjId));
    expect(missing?.tenant.entityType).toBe("pf");
    expect(pj?.tenant.entityType).toBe("pj");
  });
});

type LegacyTenantOverrides = {
  cpf?: string;
  cnpj?: string;
  fullName?: string;
  entityType?: "pf" | "pj";
  approvalStatus?: "aprovado" | "pendente" | "reprovado";
  termApprovedAt?: string | null;
  birthDate?: string;
};

async function seedLegacyContract(
  t: ReturnType<typeof setup>,
  agencyId: AgencyId,
  publicId: string,
  overrides: LegacyTenantOverrides = {},
) {
  const cpf = overrides.cpf ?? "11144477735";
  return t.run((ctx) =>
    ctx.db.insert("contracts", {
      agencyId,
      publicId,
      tenantCpf: cpf,
      status: "pendente",
      activatedAt: null,
      nextRenewalDate: "2026-12-31",
      availableGuaranteeCents: 100000,
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
      documents: [{ key: "rentalContract", status: "pendente" }],
      tenant: {
        approvalStatus: overrides.approvalStatus ?? "pendente",
        fullName: overrides.fullName ?? "Test Tenant",
        cpf,
        birthDate: overrides.birthDate ?? "1990-01-01",
        email: "tenant@test.br",
        phone: "11999999999",
        termApprovedAt: overrides.termApprovedAt ?? null,
        ...(overrides.entityType === undefined ? {} : { entityType: overrides.entityType }),
        ...(overrides.cnpj === undefined ? {} : { cnpj: overrides.cnpj }),
      },
    }),
  );
}

async function runRegistryBackfill(t: ReturnType<typeof setup>) {
  await t.mutation(internal.migrations.backfillContractTenantRegistry, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("backfillContractTenantRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const CPF_A = "52998224725";
  const CPF_B = "11144477735";

  test("dedups by taxId: first-created name wins, conflict audit-logged, all rows linked", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000444");
    const firstId = await seedLegacyContract(t, agencyId, "R-1", {
      cpf: CPF_A,
      fullName: "Alice Original",
      approvalStatus: "aprovado",
      termApprovedAt: "2025-03-01T10:00:00-03:00",
    });
    const conflictId = await seedLegacyContract(t, agencyId, "R-2", {
      cpf: CPF_A,
      fullName: "Alice Divergente",
    });
    const otherId = await seedLegacyContract(t, agencyId, "R-3", {
      cpf: CPF_B,
      fullName: "Bruno Distinto",
    });

    await runRegistryBackfill(t);

    const tenants = await t.run((ctx) => ctx.db.query("tenants").collect());
    expect(tenants).toHaveLength(2);
    const tenantA = tenants.find((row) => row.taxId === CPF_A);
    const tenantB = tenants.find((row) => row.taxId === CPF_B);
    expect(tenantA?.fullName).toBe("Alice Original");
    expect(tenantB?.fullName).toBe("Bruno Distinto");

    const audit = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("tenant.data_conflict");
    expect(audit[0].actor).toEqual({
      kind: "system",
      source: "migrations.backfillContractTenantRegistry",
    });

    const first = await t.run((ctx) => ctx.db.get(firstId));
    const conflict = await t.run((ctx) => ctx.db.get(conflictId));
    const other = await t.run((ctx) => ctx.db.get(otherId));
    expect(first?.tenantId).toBe(tenantA?._id);
    expect(conflict?.tenantId).toBe(tenantA?._id);
    expect(other?.tenantId).toBe(tenantB?._id);
    expect(first?.tenantApproval).toEqual({
      status: "aprovado",
      termApprovedAt: "2025-03-01T10:00:00-03:00",
    });
    expect(conflict?.tenantApproval).toEqual({ status: "pendente", termApprovedAt: null });
  });

  test("second run is a no-op (no new tenants, no new audit entries)", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000555");
    await seedLegacyContract(t, agencyId, "R-10", { cpf: CPF_A, fullName: "Alice Original" });
    await seedLegacyContract(t, agencyId, "R-11", { cpf: CPF_A, fullName: "Alice Divergente" });

    await runRegistryBackfill(t);
    const tenantsAfterFirst = await t.run((ctx) => ctx.db.query("tenants").collect());
    const auditAfterFirst = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());

    await runRegistryBackfill(t);
    const tenantsAfterSecond = await t.run((ctx) => ctx.db.query("tenants").collect());
    const auditAfterSecond = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());

    expect(tenantsAfterSecond).toEqual(tenantsAfterFirst);
    expect(auditAfterSecond).toEqual(auditAfterFirst);
  });

  test("skips a row with a checksum-invalid tax id without throwing", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000666");
    const invalidId = await seedLegacyContract(t, agencyId, "R-20", {
      cpf: "11111111111",
      fullName: "Legacy Inválido",
    });

    await runRegistryBackfill(t);

    const after = await t.run((ctx) => ctx.db.get(invalidId));
    expect(after?.tenantId).toBeUndefined();
    expect(after?.tenantApproval).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("tenants").collect())).toHaveLength(0);
  });

  test("legacy pj row with the CNPJ in the cpf field links via the fallback", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000777");
    const pjId = await seedLegacyContract(t, agencyId, "R-30", {
      cpf: "11444777000161",
      fullName: "Empresa Legada Ltda",
      entityType: "pj",
      birthDate: "",
    });

    await runRegistryBackfill(t);

    const after = await t.run((ctx) => ctx.db.get(pjId));
    const tenants = await t.run((ctx) => ctx.db.query("tenants").collect());
    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({ entityType: "pj", taxId: "11444777000161" });
    expect(tenants[0].entityType === "pj" ? tenants[0].contactCpf : "sentinel").toBeUndefined();
    expect(after?.tenantId).toBe(tenants[0]._id);
  });

  test("widen safety: a fully legacy-shaped contract row passes schema validation", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000888");
    const id = await seedLegacyContract(t, agencyId, "R-40", {});
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.tenantId).toBeUndefined();
    expect(row?.tenantApproval).toBeUndefined();
    expect(row?.tenant.cpf).toBe("11144477735");
  });
});
