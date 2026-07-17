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

async function seedTenantRow(t: ReturnType<typeof setup>, taxId: string) {
  return t.run((ctx) =>
    ctx.db.insert("tenants", {
      entityType: "pf",
      taxId,
      fullName: "Test Tenant",
      birthDate: "1990-01-01",
      email: "tenant@test.br",
      phone: "11999999999",
    }),
  );
}

const CONTRACT_BASE = {
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
} as const;

type StragglerOverrides = {
  tenantId?: unknown;
  embeddedScore?: number;
  topLevelScore?: number;
};

/**
 * Seed a straggler row still carrying the dropped embedded `tenant` +
 * `tenantCpf` fields. Uses the loosely-typed `convexTest` surface (same
 * pattern as contracts/backfill.test.ts) so the legacy shape can be
 * written without casts; runtime accepts it because the narrowed schema
 * ships with `schemaValidation: false` until the cleanup completes.
 */
async function seedStragglerContract(
  t: ReturnType<typeof convexTest>,
  agencyId: AgencyId,
  publicId: string,
  overrides: StragglerOverrides = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("contracts", {
      ...CONTRACT_BASE,
      agencyId,
      publicId,
      ...(overrides.tenantId === undefined ? {} : { tenantId: overrides.tenantId }),
      ...(overrides.tenantId === undefined
        ? {}
        : { tenantApproval: { status: "pendente", termApprovedAt: null } }),
      ...(overrides.topLevelScore === undefined ? {} : { score: overrides.topLevelScore }),
      tenantCpf: "11144477735",
      tenant: {
        approvalStatus: "pendente",
        entityType: "pf",
        fullName: "Test Tenant",
        cpf: "11144477735",
        birthDate: "1990-01-01",
        email: "tenant@test.br",
        phone: "11999999999",
        termApprovedAt: null,
        ...(overrides.embeddedScore === undefined ? {} : { score: overrides.embeddedScore }),
      },
    }),
  );
}

/** Registry-only row in the narrowed shape — the migration must not touch it. */
async function seedCleanContract(
  t: ReturnType<typeof convexTest>,
  agencyId: AgencyId,
  publicId: string,
  args: { tenantId: unknown; score: number },
) {
  return t.run((ctx) =>
    ctx.db.insert("contracts", {
      ...CONTRACT_BASE,
      agencyId,
      publicId,
      tenantId: args.tenantId,
      tenantApproval: { status: "pendente", termApprovedAt: null },
      score: args.score,
    }),
  );
}

async function runClearEmbeddedTenant(t: ReturnType<typeof setup>) {
  await t.mutation(internal.migrations.clearContractEmbeddedTenant, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("clearContractEmbeddedTenant", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("strips tenant/tenantCpf from a linked straggler and promotes the embedded score", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000444");
    const tenantId = await seedTenantRow(t, "11144477735");
    const id = await seedStragglerContract(t, agencyId, "S-1", {
      tenantId,
      embeddedScore: 700,
    });

    await runClearEmbeddedTenant(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after).not.toBeNull();
    if (!after) return;
    expect(Object.keys(after)).not.toContain("tenant");
    expect(Object.keys(after)).not.toContain("tenantCpf");
    expect(after.score).toBe(700);
    expect(after.tenantId).toBe(tenantId);
    expect(after.tenantApproval).toEqual({ status: "pendente", termApprovedAt: null });
    expect(after.publicId).toBe("S-1");
    expect(after.status).toBe("pendente");
    expect(after.rental).toEqual(CONTRACT_BASE.rental);
    expect(after.property).toEqual(CONTRACT_BASE.property);
    expect(after.optional).toEqual(CONTRACT_BASE.optional);
    expect(after.documents).toEqual(CONTRACT_BASE.documents);
    expect(after.availableGuaranteeCents).toBe(100000);
    expect(after.nextRenewalDate).toBe("2026-12-31");
    expect(after.activatedAt).toBeNull();
  });

  test("an existing top-level score wins over the embedded one", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000555");
    const tenantId = await seedTenantRow(t, "11144477735");
    const id = await seedStragglerContract(t, agencyId, "S-2", {
      tenantId,
      embeddedScore: 700,
      topLevelScore: 810,
    });

    await runClearEmbeddedTenant(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.score).toBe(810);
    expect(after ? Object.keys(after) : []).not.toContain("tenant");
  });

  test("second run is a no-op and an already-clean row is untouched", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000666");
    const tenantId = await seedTenantRow(t, "11144477735");
    const stragglerId = await seedStragglerContract(t, agencyId, "S-3", { tenantId });
    const cleanId = await seedCleanContract(t, agencyId, "S-CLEAN", { tenantId, score: 640 });
    const cleanBefore = await t.run((ctx) => ctx.db.get(cleanId));

    await runClearEmbeddedTenant(t);
    const afterFirst = await t.run((ctx) => ctx.db.get(stragglerId));

    await runClearEmbeddedTenant(t);
    const afterSecond = await t.run((ctx) => ctx.db.get(stragglerId));
    const cleanAfter = await t.run((ctx) => ctx.db.get(cleanId));

    expect(afterSecond).toEqual(afterFirst);
    expect(cleanAfter).toEqual(cleanBefore);
  });

  test("a straggler without a registry link throws instead of dropping data", async () => {
    const t = setup();
    const agencyId = await seedAgencyFor(t, "00000000000777");
    const orphanId = await seedStragglerContract(t, agencyId, "S-ORPHAN", {});
    const before = await t.run((ctx) => ctx.db.get(orphanId));

    // The @convex-dev/migrations runner traps the thrown guard into a failed
    // migration status doc instead of re-raising, so assert on that status —
    // and that the orphan row was left byte-for-byte untouched (no data loss).
    const status = await t.mutation(internal.migrations.clearContractEmbeddedTenant, {});
    expect(JSON.stringify(status)).toMatch(/backfillContractTenantRegistry/);

    const after = await t.run((ctx) => ctx.db.get(orphanId));
    expect(after).toEqual(before);
  });
});
