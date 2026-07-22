// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { registerContractAggregateComponents } from "../lib/testFixtures";
import type { MutavStaffRole } from "../mutavStaff/domain";
import type { UserId } from "../users/domain";
import type { AgencyId } from "../agencies/domain";
import type { ContractId } from "../contracts/domain";
import type { DelinquencyNoticeId } from "./domain";
import schema from "../schema";

// A convexTest instance factory. Aggregate components must be registered per
// instance — the contracts domain's shared schema wires them in, and
// unregistered lookups throw on first query.
function setup() {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  return t;
}

type T = ReturnType<typeof setup>;

// Narrowing helper for `ctx.db.get`-style Convex reads that return `T | null`.
// Tests seed the row inline immediately before reading it back, so a null
// return is a fatal setup bug rather than a case worth branching on.
function orThrow<TValue>(value: TValue | null | undefined, label: string): TValue {
  if (value === null || value === undefined) {
    throw new Error(`Expected non-null ${label}, got ${value === null ? "null" : "undefined"}.`);
  }
  return value;
}

// One-user, one-agency, one-active-contract fixture. Mirrors the shape used
// in useCases.test.ts so mutation calls resolve identity end-to-end.
type Fixture = {
  subject: string;
  userId: UserId;
  agencyId: AgencyId;
  contractId: ContractId;
  contractPublicId: string;
};

async function makeFixture(t: T, suffix = "1"): Promise<Fixture> {
  const subject = `auth0|user-${suffix}`;
  const contractPublicId = `CT-${suffix}`;
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
      publicId: contractPublicId,
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
  return { subject, contractPublicId, ...fx };
}

async function grantStaffRole(t: T, userId: UserId, role: MutavStaffRole): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("mutavStaff", {
      userId,
      role,
      createdAt: new Date().toISOString(),
    });
  });
}

async function setContractStatus(
  t: T,
  contractId: ContractId,
  status: "ativo" | "pendente" | "encerrado" | "cancelado",
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch(contractId, { status });
  });
}

async function insertNotice(
  t: T,
  fx: Fixture,
  overrides: {
    publicId: string;
    status?: "open" | "resolved" | "canceled";
    rentDueDate?: string;
    originalAmountCents?: number;
    updatedAmountCents?: number;
    openedAt?: string;
    resolvedAt?: string;
    canceledAt?: string;
  },
): Promise<DelinquencyNoticeId> {
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
// openNotice
// ---------------------------------------------------------------------------

describe("openNotice", () => {
  test("unauthenticated → throws UnauthenticatedError", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await expect(
      t.mutation(api.delinquencies.mutations.openNotice, {
        agencyId: fx.agencyId,
        contractPublicId: fx.contractPublicId,
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("authenticated but no membership in the target agency → throws ForbiddenError", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    const asA = t.withIdentity({ subject: a.subject });
    await expect(
      asA.mutation(api.delinquencies.mutations.openNotice, {
        agencyId: b.agencyId,
        contractPublicId: b.contractPublicId,
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
      }),
    ).rejects.toThrow(/not a member/);
  });

  test("happy path: inserts an open notice with server-derived openedAt + authored fields", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });

    const before = Date.now();
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    const after = Date.now();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publicId).toBe("DN-CT-1-2026-06-05");

    const row = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(row).not.toBeNull();
    expect(row?.status).toBe("open");
    expect(row?.contractId).toBe(fx.contractId);
    expect(row?.agencyId).toBe(fx.agencyId);
    expect(row?.openedByUserId).toBe(fx.userId);
    expect(row?.updatedAmountCents).toBe(300_000);
    expect(row?.evidenceSource).toBe("agency_reported");
    // openedAt is server-derived — must fall within the mutation window.
    const openedAtMs = Date.parse(orThrow(row, "notice row").openedAt);
    expect(openedAtMs).toBeGreaterThanOrEqual(before);
    expect(openedAtMs).toBeLessThanOrEqual(after);
  });

  test("evidenceSource defaults to 'agency_reported' when omitted", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-07-05",
      originalAmountCents: 250_000,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(row?.evidenceSource).toBe("agency_reported");
  });

  test("evidenceSource='bank_attested' from agency → INVALID_EVIDENCE_SOURCE", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
      evidenceSource: "bank_attested",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_EVIDENCE_SOURCE");
  });

  test("evidenceSource='onchain_observed' from agency → INVALID_EVIDENCE_SOURCE", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
      evidenceSource: "onchain_observed",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_EVIDENCE_SOURCE");
  });

  test("rentDueDate with ISO datetime shape → INVALID_RENT_DUE_DATE (only YYYY-MM-DD accepted)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05T00:00:00Z",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_RENT_DUE_DATE");
  });

  test("originalAmountCents = 0 → INVALID_AMOUNT (positive integer required)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 0,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_AMOUNT");
  });

  test("originalAmountCents negative → INVALID_AMOUNT", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: -1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_AMOUNT");
  });

  test("originalAmountCents non-integer → INVALID_AMOUNT", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300.5,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_AMOUNT");
  });

  test("unknown contract publicId → CONTRACT_NOT_FOUND", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: "CT-does-not-exist",
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CONTRACT_NOT_FOUND");
  });

  test("contract exists but in a different agency → CONTRACT_NOT_FOUND (existence not leaked)", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    const asA = t.withIdentity({ subject: a.subject });
    const result = await asA.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: a.agencyId,
      contractPublicId: b.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CONTRACT_NOT_FOUND");
  });

  test("contract exists but status='pendente' → CONTRACT_NOT_ACTIVE", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await setContractStatus(t, fx.contractId, "pendente");
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CONTRACT_NOT_ACTIVE");
  });

  test("second open notice for same (contract, rentDueDate) → DUPLICATE_NOTICE", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });

    const first = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(first.success).toBe(true);

    const second = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.code).toBe("DUPLICATE_NOTICE");
  });

  test("prior canceled notice for same (contract, dueDate) does NOT block a re-file; suffixed publicId", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    // Seed a prior canceled notice on the exact same rentDueDate — the
    // publicId scheme collides on the day, so the second open call must find
    // a fresh publicId via the -2 suffix.
    await insertNotice(t, fx, {
      publicId: "DN-CT-1-2026-06-05",
      status: "canceled",
      rentDueDate: "2026-06-05",
    });

    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publicId).toBe("DN-CT-1-2026-06-05-2");
  });

  test("two notices on same contract in same month, different due dates → distinct publicIds retrievable via getByPublicId", async () => {
    // Regression for the month-granularity collision: previously both notices
    // would base on `DN-CT-1-2026-04` and rely on the suffix loop. That loop
    // only saw prior rows on the SAME (contract, rentDueDate) tuple via
    // `by_contract_dueDate`, so the second notice would get the same base
    // publicId as the first and permanently break getByPublicId's `.unique()`.
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });

    const first = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-04-05",
      originalAmountCents: 300_000,
    });
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.data.publicId).toBe("DN-CT-1-2026-04-05");

    // Resolve the first so the second is not blocked by DUPLICATE_NOTICE.
    // (Same day would collide on the idempotency check; different day means
    // no collision anyway — but resolving keeps the test hermetic.)
    const resolve = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: first.data.publicId,
      resolution: { kind: "tenant_cured" },
    });
    expect(resolve.success).toBe(true);

    const second = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      contractPublicId: fx.contractPublicId,
      rentDueDate: "2026-04-20",
      originalAmountCents: 300_000,
    });
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.data.publicId).toBe("DN-CT-1-2026-04-20");
    expect(second.data.publicId).not.toBe(first.data.publicId);

    // Both must be retrievable via getByPublicId (no `.unique()` throw).
    const detailA = await asUser.query(api.delinquencies.useCases.getByPublicId, {
      publicId: first.data.publicId,
    });
    const detailB = await asUser.query(api.delinquencies.useCases.getByPublicId, {
      publicId: second.data.publicId,
    });
    expect(detailA?.publicId).toBe(first.data.publicId);
    expect(detailA?.rentDueDate).toBe("2026-04-05");
    expect(detailB?.publicId).toBe(second.data.publicId);
    expect(detailB?.rentDueDate).toBe("2026-04-20");
  });
});

// ---------------------------------------------------------------------------
// markResolved
// ---------------------------------------------------------------------------

describe("markResolved", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-r-1" });
    expect(noticeId).toBeDefined();
    await expect(
      t.mutation(api.delinquencies.mutations.markResolved, {
        noticePublicId: "DN-r-1",
        resolution: { kind: "tenant_cured" },
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("authenticated but wrong agency → throws ForbiddenError (write fails loud)", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    await insertNotice(t, b, { publicId: "DN-only-in-b" });
    const asA = t.withIdentity({ subject: a.subject });
    await expect(
      asA.mutation(api.delinquencies.mutations.markResolved, {
        noticePublicId: "DN-only-in-b",
        resolution: { kind: "tenant_cured" },
      }),
    ).rejects.toThrow(/not a member/);
  });

  test("unknown notice publicId → NOTICE_NOT_FOUND", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-nope",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_NOT_FOUND");
  });

  test("happy path: open → resolved (tenant_cured) with server-derived resolvedAt + note", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-happy-r" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const before = Date.now();
    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-happy-r",
      resolution: { kind: "tenant_cured", note: "Confirmed via WhatsApp." },
    });
    const after = Date.now();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publicId).toBe("DN-happy-r");

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("tenant_cured");
    expect(row?.resolution?.resolvedByUserId).toBe(fx.userId);
    expect(row?.resolution?.note).toBe("Confirmed via WhatsApp.");
    const resolution = orThrow(orThrow(row, "notice row").resolution, "resolution envelope");
    const resolvedAtMs = Date.parse(resolution.resolvedAt);
    expect(resolvedAtMs).toBeGreaterThanOrEqual(before);
    expect(resolvedAtMs).toBeLessThanOrEqual(after);
  });

  test("resolution kind='stale' is accepted (agency-side terminal resolution)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-stale-r" });
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-stale-r",
      resolution: { kind: "stale" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(row?.resolution?.kind).toBe("stale");
  });

  test("second call on an already-resolved notice → SELF_TRANSITION and row not re-patched", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-double-r" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const first = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-double-r",
      resolution: { kind: "tenant_cured", note: "first" },
    });
    expect(first.success).toBe(true);
    const rowAfterFirstRaw = await t.run(async (ctx) => {
      const notice = await ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", "DN-double-r"))
        .unique();
      return notice;
    });
    const rowAfterFirst = orThrow(rowAfterFirstRaw, "notice row after first resolve");
    const firstResolvedAt = orThrow(rowAfterFirst.resolution, "resolution envelope").resolvedAt;

    const second = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-double-r",
      resolution: { kind: "tenant_cured", note: "second" },
    });
    expect(second.success).toBe(false);
    if (second.success) return;
    // Machine checks self-transition BEFORE terminal-state; resolved→resolved
    // trips SELF_TRANSITION first (see convex/delinquencies/machine.ts).
    expect(second.error.code).toBe("SELF_TRANSITION");

    // Row must not have changed — note and resolvedAt still reflect first call.
    const rowAfterSecond = await t.run((ctx) => ctx.db.get(rowAfterFirst._id));
    expect(rowAfterSecond?.resolution?.note).toBe("first");
    expect(rowAfterSecond?.resolution?.resolvedAt).toBe(firstResolvedAt);
  });

  test("cannot resolve a canceled notice → TERMINAL_STATE", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cxl-r", status: "canceled" });
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-cxl-r",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("TERMINAL_STATE");
  });
});

// ---------------------------------------------------------------------------
// markCanceled
// ---------------------------------------------------------------------------

describe("markCanceled", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-c-noauth" });
    await expect(
      t.mutation(api.delinquencies.mutations.markCanceled, {
        noticePublicId: "DN-c-noauth",
        cancellation: { reason: "agency_withdrew" },
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("authenticated but wrong agency → throws (write fails loud)", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    await insertNotice(t, b, { publicId: "DN-only-in-b-c" });
    const asA = t.withIdentity({ subject: a.subject });
    await expect(
      asA.mutation(api.delinquencies.mutations.markCanceled, {
        noticePublicId: "DN-only-in-b-c",
        cancellation: { reason: "agency_withdrew" },
      }),
    ).rejects.toThrow(/not a member/);
  });

  test("unknown notice publicId → NOTICE_NOT_FOUND", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-does-not-exist",
      cancellation: { reason: "agency_withdrew" },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_NOT_FOUND");
  });

  test("happy path: open → canceled with server-derived canceledAt + reason", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-happy-c" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const before = Date.now();
    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-happy-c",
      cancellation: { reason: "data_error", note: "Wrong tenant." },
    });
    const after = Date.now();

    expect(result.success).toBe(true);
    if (!result.success) return;

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("canceled");
    expect(row?.cancellation?.reason).toBe("data_error");
    expect(row?.cancellation?.canceledByUserId).toBe(fx.userId);
    expect(row?.cancellation?.note).toBe("Wrong tenant.");
    const cancellation = orThrow(orThrow(row, "notice row").cancellation, "cancellation envelope");
    const canceledAtMs = Date.parse(cancellation.canceledAt);
    expect(canceledAtMs).toBeGreaterThanOrEqual(before);
    expect(canceledAtMs).toBeLessThanOrEqual(after);
  });

  test("reason='duplicate' accepted", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-dup-c" });
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-dup-c",
      cancellation: { reason: "duplicate" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(row?.cancellation?.reason).toBe("duplicate");
  });

  test("cannot cancel an already-canceled notice → SELF_TRANSITION and row preserved", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-double-c" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const first = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-double-c",
      cancellation: { reason: "agency_withdrew", note: "first" },
    });
    expect(first.success).toBe(true);

    const rowAfterFirstRaw = await t.run(async (ctx) => {
      return ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", "DN-double-c"))
        .unique();
    });
    const rowAfterFirst = orThrow(rowAfterFirstRaw, "notice row after first cancel");
    const firstCanceledAt = orThrow(rowAfterFirst.cancellation, "cancellation envelope").canceledAt;

    const second = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-double-c",
      cancellation: { reason: "agency_withdrew", note: "second" },
    });
    expect(second.success).toBe(false);
    if (second.success) return;
    // canceled→canceled trips SELF_TRANSITION before TERMINAL_STATE.
    expect(second.error.code).toBe("SELF_TRANSITION");

    const rowAfterSecond = await t.run((ctx) => ctx.db.get(rowAfterFirst._id));
    expect(rowAfterSecond?.cancellation?.note).toBe("first");
    expect(rowAfterSecond?.cancellation?.canceledAt).toBe(firstCanceledAt);
  });

  test("cannot cancel a resolved notice → TERMINAL_STATE", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-r-then-c", status: "resolved" });
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-r-then-c",
      cancellation: { reason: "agency_withdrew" },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("TERMINAL_STATE");
  });
});

// ---------------------------------------------------------------------------
// staffMarkResolvedByCover
// ---------------------------------------------------------------------------

describe("staffMarkResolvedByCover", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cover-noauth" });
    await expect(
      t.mutation(api.delinquencies.mutations.staffMarkResolvedByCover, {
        noticePublicId: "DN-cover-noauth",
        coverOperationPublicId: "COVER-1",
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("authenticated non-staff → throws ForbiddenError", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cover-nostaff" });
    const asUser = t.withIdentity({ subject: fx.subject });
    await expect(
      asUser.mutation(api.delinquencies.mutations.staffMarkResolvedByCover, {
        noticePublicId: "DN-cover-nostaff",
        coverOperationPublicId: "COVER-1",
      }),
    ).rejects.toThrow(/Not a Mutav staff member/);
  });

  test("staff role='support' → throws (below compliance)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cover-support" });
    await grantStaffRole(t, fx.userId, "support");
    const asSupport = t.withIdentity({ subject: fx.subject });
    await expect(
      asSupport.mutation(api.delinquencies.mutations.staffMarkResolvedByCover, {
        noticePublicId: "DN-cover-support",
        coverOperationPublicId: "COVER-1",
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("staff role='treasury' → throws (off-ladder)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cover-treasury" });
    await grantStaffRole(t, fx.userId, "treasury");
    const asTreasury = t.withIdentity({ subject: fx.subject });
    await expect(
      asTreasury.mutation(api.delinquencies.mutations.staffMarkResolvedByCover, {
        noticePublicId: "DN-cover-treasury",
        coverOperationPublicId: "COVER-1",
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("unknown notice → NOTICE_NOT_FOUND (staff, compliance role)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });
    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-nope", coverOperationPublicId: "COVER-1" },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_NOT_FOUND");
  });

  test("happy path (compliance): patches row + emits audit entry with staff actor", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-cover-happy" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const before = Date.now();
    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      {
        noticePublicId: "DN-cover-happy",
        coverOperationPublicId: "COVER-ABC",
        note: "Reserve drawn per case #42.",
      },
    );
    const after = Date.now();
    expect(result.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("cover_committed");
    expect(row?.resolution?.coverOperationPublicId).toBe("COVER-ABC");
    expect(row?.resolution?.resolvedByUserId).toBe(fx.userId);
    expect(row?.resolution?.note).toBe("Reserve drawn per case #42.");
    const resolution = orThrow(orThrow(row, "notice row").resolution, "resolution envelope");
    const resolvedAtMs = Date.parse(resolution.resolvedAt);
    expect(resolvedAtMs).toBeGreaterThanOrEqual(before);
    expect(resolvedAtMs).toBeLessThanOrEqual(after);

    // Audit trail — exactly one entry keyed on the notice publicId.
    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "contractDelinquencyNotices").eq("resourceId", "DN-cover-happy"),
        )
        .collect(),
    );
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("delinquency.resolved_by_cover");
    expect(entries[0].actor).toEqual({ kind: "user", userId: fx.userId });
  });

  test("staff role='admin' also allowed (admin ≥ compliance)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cover-admin" });
    await grantStaffRole(t, fx.userId, "admin");
    const asAdmin = t.withIdentity({ subject: fx.subject });
    const result = await asAdmin.mutation(api.delinquencies.mutations.staffMarkResolvedByCover, {
      noticePublicId: "DN-cover-admin",
      coverOperationPublicId: "COVER-XYZ",
    });
    expect(result.success).toBe(true);
  });

  test("cross-agency: compliance staff can resolve a notice owned by any agency", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    const noticeId = await insertNotice(t, b, { publicId: "DN-cross-agency" });
    // Staff row lives on user A, but the notice is agency B's.
    await grantStaffRole(t, a.userId, "compliance");
    const asStaff = t.withIdentity({ subject: a.subject });
    const result = await asStaff.mutation(api.delinquencies.mutations.staffMarkResolvedByCover, {
      noticePublicId: "DN-cross-agency",
      coverOperationPublicId: "COVER-CROSS",
    });
    expect(result.success).toBe(true);

    // Row must reflect the staff-signed resolution envelope (kind =
    // cover_committed, resolvedByUserId = staff A) even though the notice
    // belongs to agency B.
    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.agencyId).toBe(b.agencyId);
    expect(row?.resolution?.kind).toBe("cover_committed");
    expect(row?.resolution?.coverOperationPublicId).toBe("COVER-CROSS");
    expect(row?.resolution?.resolvedByUserId).toBe(a.userId);

    // Exactly one audit entry, actor = staff A (not the agency owner).
    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "contractDelinquencyNotices").eq("resourceId", "DN-cross-agency"),
        )
        .collect(),
    );
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("delinquency.resolved_by_cover");
    expect(entries[0].actor).toEqual({ kind: "user", userId: a.userId });
  });

  test("canceled notice cannot be resolved by cover → TERMINAL_STATE and no audit entry emitted", async () => {
    // Seed a canceled notice (not resolved) so the machine's TERMINAL_STATE
    // branch is exercised — a resolved seed would trip SELF_TRANSITION first
    // because assertTransition checks from === to before isTerminal.
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cover-terminal", status: "canceled" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });
    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-cover-terminal", coverOperationPublicId: "COVER-Z" },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("TERMINAL_STATE");

    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "contractDelinquencyNotices").eq("resourceId", "DN-cover-terminal"),
        )
        .collect(),
    );
    expect(entries.length).toBe(0);
  });

  test("resolved notice cannot be resolved-by-cover a second time → SELF_TRANSITION and no audit entry", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cover-self", status: "resolved" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });
    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-cover-self", coverOperationPublicId: "COVER-DUP" },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("SELF_TRANSITION");

    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "contractDelinquencyNotices").eq("resourceId", "DN-cover-self"),
        )
        .collect(),
    );
    expect(entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// staffMarkCanceledByDismissal
// ---------------------------------------------------------------------------

describe("staffMarkCanceledByDismissal", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-dismiss-noauth" });
    await expect(
      t.mutation(api.delinquencies.mutations.staffMarkCanceledByDismissal, {
        noticePublicId: "DN-dismiss-noauth",
        disposition: { kind: "staff_dismissed" },
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("authenticated non-staff → throws", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-dismiss-nostaff" });
    const asUser = t.withIdentity({ subject: fx.subject });
    await expect(
      asUser.mutation(api.delinquencies.mutations.staffMarkCanceledByDismissal, {
        noticePublicId: "DN-dismiss-nostaff",
        disposition: { kind: "staff_dismissed" },
      }),
    ).rejects.toThrow(/Not a Mutav staff member/);
  });

  test("staff role='support' → throws (below compliance)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-dismiss-support" });
    await grantStaffRole(t, fx.userId, "support");
    const asSupport = t.withIdentity({ subject: fx.subject });
    await expect(
      asSupport.mutation(api.delinquencies.mutations.staffMarkCanceledByDismissal, {
        noticePublicId: "DN-dismiss-support",
        disposition: { kind: "staff_dismissed" },
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("unknown notice → NOTICE_NOT_FOUND", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });
    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      { noticePublicId: "DN-nope", disposition: { kind: "staff_dismissed" } },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_NOT_FOUND");
  });

  test("staff_dismissed happy path: open → canceled, cancellation envelope + audit entry", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-dismiss-happy" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const before = Date.now();
    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      {
        noticePublicId: "DN-dismiss-happy",
        disposition: { kind: "staff_dismissed", note: "Procedurally invalid." },
      },
    );
    const after = Date.now();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.terminalStatus).toBe("canceled");

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("canceled");
    expect(row?.cancellation?.reason).toBe("staff_dismissed");
    expect(row?.cancellation?.canceledByUserId).toBe(fx.userId);
    expect(row?.cancellation?.note).toBe("Procedurally invalid.");
    const cancellation = orThrow(orThrow(row, "notice row").cancellation, "cancellation envelope");
    const canceledAtMs = Date.parse(cancellation.canceledAt);
    expect(canceledAtMs).toBeGreaterThanOrEqual(before);
    expect(canceledAtMs).toBeLessThanOrEqual(after);

    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "contractDelinquencyNotices").eq("resourceId", "DN-dismiss-happy"),
        )
        .collect(),
    );
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("delinquency.dismissed");
    expect(entries[0].actor).toEqual({ kind: "user", userId: fx.userId });
  });

  test("staff_dispute happy path: open → resolved (staff_dispute) + audit entry", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-dispute-happy" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      {
        noticePublicId: "DN-dispute-happy",
        disposition: { kind: "staff_dispute", note: "Reversal per legal review." },
      },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.terminalStatus).toBe("resolved");

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("staff_dispute");
    expect(row?.resolution?.resolvedByUserId).toBe(fx.userId);
    expect(row?.resolution?.note).toBe("Reversal per legal review.");
    // cancellation envelope must remain empty on a dispute-resolution path.
    expect(row?.cancellation).toBeUndefined();

    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "contractDelinquencyNotices").eq("resourceId", "DN-dispute-happy"),
        )
        .collect(),
    );
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("delinquency.disputed");
  });

  test("cross-agency: compliance staff dismisses a notice owned by another agency", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    const noticeId = await insertNotice(t, b, { publicId: "DN-cross-dismiss" });
    await grantStaffRole(t, a.userId, "compliance");
    const asStaff = t.withIdentity({ subject: a.subject });
    const result = await asStaff.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      { noticePublicId: "DN-cross-dismiss", disposition: { kind: "staff_dismissed" } },
    );
    expect(result.success).toBe(true);

    // Row reflects a staff-signed cancellation envelope even though the
    // notice belongs to agency B.
    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("canceled");
    expect(row?.agencyId).toBe(b.agencyId);
    expect(row?.cancellation?.reason).toBe("staff_dismissed");
    expect(row?.cancellation?.canceledByUserId).toBe(a.userId);

    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "contractDelinquencyNotices").eq("resourceId", "DN-cross-dismiss"),
        )
        .collect(),
    );
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("delinquency.dismissed");
    expect(entries[0].actor).toEqual({ kind: "user", userId: a.userId });
  });

  test("resolved notice cannot be dismissed → TERMINAL_STATE and no audit entry", async () => {
    // staff_dismissed targets `canceled`; seeding `resolved` makes it a
    // cross-terminal attempt so TERMINAL_STATE is what fires (a canceled
    // seed would be canceled→canceled = SELF_TRANSITION).
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-dismiss-terminal", status: "resolved" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });
    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      { noticePublicId: "DN-dismiss-terminal", disposition: { kind: "staff_dismissed" } },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("TERMINAL_STATE");

    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q
            .eq("resourceType", "contractDelinquencyNotices")
            .eq("resourceId", "DN-dismiss-terminal"),
        )
        .collect(),
    );
    expect(entries.length).toBe(0);
  });

  test("canceled notice cannot be dismissed a second time → SELF_TRANSITION and no audit entry", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-dismiss-self", status: "canceled" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });
    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      { noticePublicId: "DN-dismiss-self", disposition: { kind: "staff_dismissed" } },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("SELF_TRANSITION");

    const entries = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "contractDelinquencyNotices").eq("resourceId", "DN-dismiss-self"),
        )
        .collect(),
    );
    expect(entries.length).toBe(0);
  });
});
