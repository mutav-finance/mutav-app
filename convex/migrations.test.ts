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
