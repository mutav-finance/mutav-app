// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { registerContractAggregateComponents } from "../lib/testFixtures";
import type { MutavStaffRole } from "../mutavStaff/domain";
import schema from "../schema";
import { STATS_TAKE_LIMIT } from "./useCases";

// convexTest instance factory. Aggregate components must be registered per
// instance even though this suite never mutates contracts — the shared
// schema wires the components in, and unregistered lookups throw on first
// query. Cheap to register, expensive to forget.
function setup() {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  return t;
}

type T = ReturnType<typeof setup>;

// A one-user, one-agency, one-contract fixture — the smallest shape that lets
// us insert notices against a real (agencyId, contractId, userId) tuple. Mirrors
// the scenarios.test.ts pattern but seeds the users row with a `subject` so
// `t.withIdentity({ subject })` resolves the same user.
type Fixture = {
  subject: string;
  userId: Id<"users">;
  agencyId: Id<"agencies">;
  contractId: Id<"contracts">;
};

async function makeFixture(t: T, suffix = "1"): Promise<Fixture> {
  const subject = `auth0|user-${suffix}`;
  const fx = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `user-${suffix}`,
      subject,
      name: `Fixture User ${suffix}`,
      email: `fixture-${suffix}@test.br`,
      createdAt: "2024-01-01T00:00:00-03:00",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: `Fixture Agency ${suffix}`,
      cnpj: `0000000000000${suffix}`.slice(-14),
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
    const tenantId = await ctx.db.insert("tenants", {
      entityType: "pf",
      taxId: `1114447773${suffix}`.slice(-11),
      fullName: `Tenant ${suffix}`,
      birthDate: "1990-01-01",
      email: `tenant-${suffix}@test.br`,
      phone: "11999999999",
    });
    const contractId = await ctx.db.insert("contracts", {
      agencyId,
      publicId: `CT-${suffix}`,
      tenantId,
      tenantApproval: { status: "aprovado", termApprovedAt: "2024-06-01" },
      status: "ativo",
      activatedAt: "2024-06-01",
      deactivatedAt: null,
      nextRenewalDate: "2026-12-31",
      availableGuaranteeCents: 3_600_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 300_000,
        condoCents: 0,
        otherFeesCents: 0,
        totalRentCents: 300_000,
        feeCents: 1500,
        oneTimeActivationFeeCents: 0,
        setupInstallments: 1,
        exitCostMultiplier: "5x",
        rentMultiplier: "12x",
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
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
    });
    return { userId, agencyId, contractId };
  });
  return { subject, ...fx };
}

// Seed a mutavStaff row for an existing user. Mirrors mutavStaff/useCases.test.ts.
async function grantStaffRole(t: T, userId: Id<"users">, role: MutavStaffRole): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("mutavStaff", {
      userId,
      role,
      createdAt: new Date().toISOString(),
    });
  });
}

// Insert a notice with sensible defaults. Any field can be overridden.
async function insertNotice(
  t: T,
  fx: Fixture,
  overrides: {
    publicId: string;
    status?: "open" | "resolved" | "canceled";
    rentDueDate?: string;
    openedAt?: string;
    updatedAmountCents?: number;
    originalAmountCents?: number;
    resolvedAt?: string;
    canceledAt?: string;
  },
): Promise<Id<"contractDelinquencyNotices">> {
  return t.run(async (ctx) => {
    const status = overrides.status ?? "open";
    return ctx.db.insert("contractDelinquencyNotices", {
      publicId: overrides.publicId,
      contractId: fx.contractId,
      agencyId: fx.agencyId,
      status,
      rentDueDate: overrides.rentDueDate ?? "2026-06-05",
      originalAmountCents: overrides.originalAmountCents ?? 300_000,
      updatedAmountCents: overrides.updatedAmountCents ?? 300_000,
      evidenceSource: "agency_reported",
      openedAt: overrides.openedAt ?? "2026-06-10T09:00:00-03:00",
      openedByUserId: fx.userId,
      ...(status === "resolved"
        ? {
            resolution: {
              kind: "tenant_cured" as const,
              resolvedAt: overrides.resolvedAt ?? "2026-06-15T09:00:00-03:00",
              resolvedByUserId: fx.userId,
            },
          }
        : {}),
      ...(status === "canceled"
        ? {
            cancellation: {
              reason: "agency_withdrew" as const,
              canceledAt: overrides.canceledAt ?? "2026-06-11T09:00:00-03:00",
              canceledByUserId: fx.userId,
            },
          }
        : {}),
    });
  });
}

// ---------------------------------------------------------------------------
// listByAgency — wrapper enforcement, filters, pagination
// ---------------------------------------------------------------------------

describe("listByAgency", () => {
  test("unauthenticated → throws UnauthenticatedError", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    // No withIdentity() ⇒ ctx.auth.getUserIdentity() returns null and the
    // wrapper throws UnauthenticatedError.
    await expect(
      t.query(api.delinquencies.useCases.listByAgency, {
        agencyId: fx.agencyId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("authenticated but no membership in the target agency → throws ForbiddenError", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    // User A is authenticated but has no membership in agency B.
    const asA = t.withIdentity({ subject: a.subject });
    await expect(
      asA.query(api.delinquencies.useCases.listByAgency, {
        agencyId: b.agencyId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/not a member/);
  });

  test("authenticated + member → returns the paginated shape", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-shape-1" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId: fx.agencyId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("isDone");
    expect(result).toHaveProperty("continueCursor");
    expect(Array.isArray(result.page)).toBe(true);
    expect(result.page.length).toBe(1);
    expect(result.page[0].publicId).toBe("DN-shape-1");
    // Projected row shape — no _id/_creationTime, no full resolution envelope.
    expect(result.page[0]).not.toHaveProperty("_id");
    expect(result.page[0]).not.toHaveProperty("_creationTime");
    expect(result.page[0].resolvedAt).toBeNull();
    expect(result.page[0].canceledAt).toBeNull();
  });

  test("cross-agency isolation: querying agency A returns only A's notices", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    await insertNotice(t, a, { publicId: "DN-agencyA-1" });
    await insertNotice(t, a, { publicId: "DN-agencyA-2" });
    await insertNotice(t, b, { publicId: "DN-agencyB-1" });

    const asA = t.withIdentity({ subject: a.subject });
    const result = await asA.query(api.delinquencies.useCases.listByAgency, {
      agencyId: a.agencyId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.publicId).sort()).toEqual(["DN-agencyA-1", "DN-agencyA-2"]);
  });

  test("default status='open' returns only open notices", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-open-1", status: "open" });
    await insertNotice(t, fx, { publicId: "DN-resolved-1", status: "resolved" });
    await insertNotice(t, fx, { publicId: "DN-canceled-1", status: "canceled" });

    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId: fx.agencyId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.publicId)).toEqual(["DN-open-1"]);
    expect(result.page.every((r) => r.status === "open")).toBe(true);
  });

  test("status='resolved' returns only resolved notices", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-open-x", status: "open" });
    await insertNotice(t, fx, { publicId: "DN-resolved-x", status: "resolved" });

    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId: fx.agencyId,
      status: "resolved",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.publicId)).toEqual(["DN-resolved-x"]);
    expect(result.page.every((r) => r.status === "resolved")).toBe(true);
  });

  test("status='canceled' returns only canceled notices", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-open-y", status: "open" });
    await insertNotice(t, fx, { publicId: "DN-canceled-y", status: "canceled" });

    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId: fx.agencyId,
      status: "canceled",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.publicId)).toEqual(["DN-canceled-y"]);
    expect(result.page.every((r) => r.status === "canceled")).toBe(true);
  });

  test("dueDateFrom / dueDateTo narrows to the in-range subset", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-early", rentDueDate: "2026-02-05" });
    await insertNotice(t, fx, { publicId: "DN-mid", rentDueDate: "2026-04-05" });
    await insertNotice(t, fx, { publicId: "DN-late", rentDueDate: "2026-06-05" });

    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId: fx.agencyId,
      dueDateFrom: "2026-03-01",
      dueDateTo: "2026-05-31",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.publicId)).toEqual(["DN-mid"]);
  });

  test("amountFromCents / amountToCents narrows to the in-range subset", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cheap", updatedAmountCents: 100_000 });
    await insertNotice(t, fx, { publicId: "DN-mid", updatedAmountCents: 300_000 });
    await insertNotice(t, fx, { publicId: "DN-expensive", updatedAmountCents: 500_000 });

    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId: fx.agencyId,
      amountFromCents: 200_000,
      amountToCents: 400_000,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.publicId)).toEqual(["DN-mid"]);
  });

  test("pagination: numItems=2 with 3 rows returns 2 rows + isDone=false + cursor advances the page", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    // Distinct openedAt so the desc order is stable and predictable.
    await insertNotice(t, fx, { publicId: "DN-p1", openedAt: "2026-06-01T09:00:00-03:00" });
    await insertNotice(t, fx, { publicId: "DN-p2", openedAt: "2026-06-02T09:00:00-03:00" });
    await insertNotice(t, fx, { publicId: "DN-p3", openedAt: "2026-06-03T09:00:00-03:00" });

    const asUser = t.withIdentity({ subject: fx.subject });
    const firstPage = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId: fx.agencyId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page.length).toBe(2);
    expect(firstPage.isDone).toBe(false);
    expect(typeof firstPage.continueCursor).toBe("string");

    const secondPage = await asUser.query(api.delinquencies.useCases.listByAgency, {
      agencyId: fx.agencyId,
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page.length).toBe(1);
    // Paginator termination contract — the final page must announce EOF so
    // callers stop paging. A regression that returns `isDone: false` on the
    // last page would send a UI into an infinite fetch loop.
    expect(secondPage.isDone).toBe(true);
    // Union of both pages covers every seeded row exactly once.
    const seen = [...firstPage.page, ...secondPage.page].map((r) => r.publicId).sort();
    expect(seen).toEqual(["DN-p1", "DN-p2", "DN-p3"]);
  });
});

// ---------------------------------------------------------------------------
// getByPublicId — null-on-miss discipline, no cross-agency leak
// ---------------------------------------------------------------------------

describe("getByPublicId", () => {
  test("unauthenticated → returns null (never throws)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-public" });

    // No withIdentity. assertAgencyAccess throws internally; getByPublicId
    // catches and returns null. Must NOT throw.
    const result = await t.query(api.delinquencies.useCases.getByPublicId, {
      publicId: "DN-public",
    });
    expect(result).toBeNull();
  });

  test("authenticated but wrong agency → returns null (existence not leaked)", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    await insertNotice(t, b, { publicId: "DN-only-in-b" });

    const asA = t.withIdentity({ subject: a.subject });
    const result = await asA.query(api.delinquencies.useCases.getByPublicId, {
      publicId: "DN-only-in-b",
    });
    expect(result).toBeNull();
  });

  test("authenticated + correct agency + existing publicId → returns the detail row", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-detail-1" });

    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.query(api.delinquencies.useCases.getByPublicId, {
      publicId: "DN-detail-1",
    });
    expect(result).not.toBeNull();
    expect(result?.publicId).toBe("DN-detail-1");
    expect(result?.agencyId).toBe(fx.agencyId);
    expect(result?.status).toBe("open");
    // Detail shape carries the (nullable) envelope fields.
    expect(result?.resolution).toBeNull();
    expect(result?.cancellation).toBeNull();
  });

  test("non-existent publicId → returns null", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.query(api.delinquencies.useCases.getByPublicId, {
      publicId: "DN-does-not-exist",
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// openStats — wrapper + 30-day windowing + take-limit flags
// ---------------------------------------------------------------------------

describe("openStats", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await expect(
      t.query(api.delinquencies.useCases.openStats, { agencyId: fx.agencyId }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("counts open + resolved-within-30d + canceled-within-30d, with approx flags false when under the take ceiling", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    // Two open.
    await insertNotice(t, fx, { publicId: "DN-open-A", status: "open" });
    await insertNotice(t, fx, { publicId: "DN-open-B", status: "open" });
    // One resolved WITHIN the last 30 days (relative to Date.now()).
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await insertNotice(t, fx, {
      publicId: "DN-resolved-recent",
      status: "resolved",
      resolvedAt: recent,
    });
    // (Zero canceled → both counts and both approx flags stay false.)

    const asUser = t.withIdentity({ subject: fx.subject });
    const stats = await asUser.query(api.delinquencies.useCases.openStats, {
      agencyId: fx.agencyId,
    });
    expect(stats).toEqual({
      openCount: 2,
      resolvedCountLast30d: 1,
      canceledCountLast30d: 0,
      approxResolved: false,
      approxCanceled: false,
    });
  });

  test("canceledCountLast30d is counted independently and respects the 30-day boundary (in-window vs out-of-window)", async () => {
    const t = setup();
    const fx = await makeFixture(t);

    // Two canceled INSIDE the last 30 days.
    const recent1 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const recent2 = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    await insertNotice(t, fx, {
      publicId: "DN-canceled-recent-1",
      status: "canceled",
      canceledAt: recent1,
    });
    await insertNotice(t, fx, {
      publicId: "DN-canceled-recent-2",
      status: "canceled",
      canceledAt: recent2,
    });
    // One canceled OUTSIDE the window — must be excluded from the 30-day
    // count. 45 days ago is well past the boundary and immune to test-run
    // clock skew.
    const stale = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    await insertNotice(t, fx, {
      publicId: "DN-canceled-stale",
      status: "canceled",
      canceledAt: stale,
    });
    // One resolved in-window — proves the canceled counter does not double
    // as the resolved counter (independence guarantee).
    const resolvedIn = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await insertNotice(t, fx, {
      publicId: "DN-resolved-in-window",
      status: "resolved",
      resolvedAt: resolvedIn,
    });

    const asUser = t.withIdentity({ subject: fx.subject });
    const stats = await asUser.query(api.delinquencies.useCases.openStats, {
      agencyId: fx.agencyId,
    });
    expect(stats).toEqual({
      openCount: 0,
      resolvedCountLast30d: 1,
      canceledCountLast30d: 2,
      approxResolved: false,
      approxCanceled: false,
    });
  });

  test("saturating STATS_TAKE_LIMIT flips approxResolved / approxCanceled to true", async () => {
    const t = setup();
    const fx = await makeFixture(t);

    // Seed exactly STATS_TAKE_LIMIT resolved rows and STATS_TAKE_LIMIT
    // canceled rows in a single ctx transaction — inserting 2000 rows one
    // mutation at a time would balloon this test past a reasonable ceiling.
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await t.run(async (ctx) => {
      for (let i = 0; i < STATS_TAKE_LIMIT; i++) {
        await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-saturate-resolved-${i}`,
          contractId: fx.contractId,
          agencyId: fx.agencyId,
          status: "resolved",
          rentDueDate: "2026-06-05",
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: "2026-06-10T09:00:00-03:00",
          openedByUserId: fx.userId,
          resolution: {
            kind: "tenant_cured" as const,
            resolvedAt: recent,
            resolvedByUserId: fx.userId,
          },
        });
      }
      for (let i = 0; i < STATS_TAKE_LIMIT; i++) {
        await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-saturate-canceled-${i}`,
          contractId: fx.contractId,
          agencyId: fx.agencyId,
          status: "canceled",
          rentDueDate: "2026-06-05",
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: "2026-06-10T09:00:00-03:00",
          openedByUserId: fx.userId,
          cancellation: {
            reason: "agency_withdrew" as const,
            canceledAt: recent,
            canceledByUserId: fx.userId,
          },
        });
      }
    });

    const asUser = t.withIdentity({ subject: fx.subject });
    const stats = await asUser.query(api.delinquencies.useCases.openStats, {
      agencyId: fx.agencyId,
    });
    // .take() returned exactly the ceiling → the approx flag flips true so
    // the UI can render "1000+" instead of silently under-reporting.
    expect(stats.approxResolved).toBe(true);
    expect(stats.approxCanceled).toBe(true);
    // The 30-day counters are capped by the take ceiling as well — every
    // seeded row is in-window, so both counts equal STATS_TAKE_LIMIT.
    expect(stats.resolvedCountLast30d).toBe(STATS_TAKE_LIMIT);
    expect(stats.canceledCountLast30d).toBe(STATS_TAKE_LIMIT);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// listOpenAdminQueue — staff-role ladder + cross-agency ordering
// ---------------------------------------------------------------------------

describe("listOpenAdminQueue", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    await expect(
      t.query(api.delinquencies.useCases.listOpenAdminQueue, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("authenticated user with no mutavStaff row → throws ForbiddenError", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    await expect(
      asUser.query(api.delinquencies.useCases.listOpenAdminQueue, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Not a Mutav staff member/);
  });

  test("staff role='support' → throws (below the compliance ladder rung)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await grantStaffRole(t, fx.userId, "support");
    const asSupport = t.withIdentity({ subject: fx.subject });
    await expect(
      asSupport.query(api.delinquencies.useCases.listOpenAdminQueue, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("staff role='compliance' → returns open notices across agencies, oldest-first (openedAt asc)", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    await grantStaffRole(t, a.userId, "compliance");

    // Insert across both agencies with deliberately-misordered publicIds so
    // the openedAt asc ordering is the only thing that can produce the
    // expected sequence.
    await insertNotice(t, a, { publicId: "DN-late-a", openedAt: "2026-08-10T09:00:00-03:00" });
    await insertNotice(t, b, { publicId: "DN-early-b", openedAt: "2026-05-10T09:00:00-03:00" });
    await insertNotice(t, a, { publicId: "DN-mid-a", openedAt: "2026-06-10T09:00:00-03:00" });
    // Resolved control — must NOT surface in the open queue.
    await insertNotice(t, b, {
      publicId: "DN-resolved-b",
      status: "resolved",
      openedAt: "2026-04-01T09:00:00-03:00",
    });

    const asCompliance = t.withIdentity({ subject: a.subject });
    const result = await asCompliance.query(api.delinquencies.useCases.listOpenAdminQueue, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.publicId)).toEqual(["DN-early-b", "DN-mid-a", "DN-late-a"]);
    // Cross-agency coverage — both agency IDs appear in the queue.
    const seenAgencies = new Set(result.page.map((r) => r.agencyId));
    expect(seenAgencies.has(a.agencyId)).toBe(true);
    expect(seenAgencies.has(b.agencyId)).toBe(true);
  });

  test("staff role='admin' → also allowed (admin satisfies ≥ compliance)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await grantStaffRole(t, fx.userId, "admin");
    await insertNotice(t, fx, { publicId: "DN-admin-visible" });

    const asAdmin = t.withIdentity({ subject: fx.subject });
    const result = await asAdmin.query(api.delinquencies.useCases.listOpenAdminQueue, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.publicId)).toEqual(["DN-admin-visible"]);
  });

  test("staff role='treasury' → throws (off-ladder, never satisfies an operational gate)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await grantStaffRole(t, fx.userId, "treasury");
    const asTreasury = t.withIdentity({ subject: fx.subject });
    await expect(
      asTreasury.query(api.delinquencies.useCases.listOpenAdminQueue, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/compliance/);
  });
});

// ---------------------------------------------------------------------------
// getByPublicIdInternal — private companion, no auth of its own
// ---------------------------------------------------------------------------

describe("getByPublicIdInternal", () => {
  test("returns the raw Doc for a known publicId, and null for a missing one", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-internal-hit" });

    // Internal queries have no auth of their own; callers enforce auth
    // upstream. Invoked directly here to prove the lookup behavior.
    const hit = await t.query(internal.delinquencies.useCases.getByPublicIdInternal, {
      publicId: "DN-internal-hit",
    });
    expect(hit).not.toBeNull();
    expect(hit?.publicId).toBe("DN-internal-hit");
    // Raw Doc carries the system fields the public shape drops.
    expect(hit).toHaveProperty("_id");
    expect(hit).toHaveProperty("_creationTime");

    const miss = await t.query(internal.delinquencies.useCases.getByPublicIdInternal, {
      publicId: "DN-internal-miss",
    });
    expect(miss).toBeNull();
  });
});
