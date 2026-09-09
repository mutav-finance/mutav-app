// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { registerContractAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import { replaceGuaranteeAggregates } from "../guarantees/aggregateWrites";
import type { MutavStaffRole } from "../mutavStaff/domain";
import type { UserId } from "../users/domain";
import type { AgencyId } from "../agencies/domain";
import type { GuaranteeId, GuaranteeState } from "../guarantees/domain";
import type { DelinquencyNoticeId } from "./domain";
import schema from "../schema";

// A convexTest instance factory. Aggregate components must be registered per
// instance — the guarantees domain's shared schema wires them in, and
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

// One-user, one-agency, one-active-guarantee fixture. Mirrors the shape used
// in useCases.test.ts so mutation calls resolve identity end-to-end.
type Fixture = {
  subject: string;
  userId: UserId;
  agencyId: AgencyId;
  guaranteeId: GuaranteeId;
  guaranteePublicId: string;
};

async function makeFixture(
  t: T,
  suffix = "1",
  guarantee: { status?: GuaranteeState; availableCents?: number } = {},
): Promise<Fixture> {
  const subject = `auth0|user-${suffix}`;
  const guaranteePublicId = `CT-${suffix}`;
  const { userId, agencyId } = await t.run(async (ctx) => {
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
    return { userId, agencyId };
  });
  const { guaranteeId } = await seedGuaranteeWithLease(
    t,
    {
      agencyId,
      status: guarantee.status ?? "active",
      activatedAt: "2024-06-01T00:00:00.000Z",
      rentCents: 300_000,
      tenantTaxId: `1114447773${suffix}`.slice(-11),
      ...(guarantee.availableCents === undefined
        ? {}
        : { availableCents: guarantee.availableCents }),
    },
    guaranteePublicId,
  );
  return { subject, guaranteePublicId, userId, agencyId, guaranteeId };
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

// Direct status patch. The aggregates are rewritten with it: a mutation under
// test may now transition the guarantee, and `replace` deletes by the key the
// aggregate holds — a stale key makes the aggregate, not the mutation, the
// thing that fails.
async function setGuaranteeStatus(
  t: T,
  guaranteeId: GuaranteeId,
  status: GuaranteeState,
): Promise<void> {
  await t.run(async (ctx) => {
    const before = await ctx.db.get(guaranteeId);
    if (!before) throw new Error(`No guarantee ${guaranteeId} to patch.`);
    await ctx.db.patch(guaranteeId, { status });
    const after = await ctx.db.get(guaranteeId);
    if (!after) throw new Error(`Guarantee ${guaranteeId} vanished mid-patch.`);
    await replaceGuaranteeAggregates(ctx, before, after);
  });
}

async function insertNotice(
  t: T,
  fx: Fixture,
  overrides: {
    publicId: string;
    status?: "open" | "verified" | "resolved" | "canceled";
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
    return ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId: overrides.publicId,
      guaranteeId: fx.guaranteeId,
      agencyId: fx.agencyId,
      status,
      rentDueDate: overrides.rentDueDate ?? "2026-06-05",
      originalAmountCents: overrides.originalAmountCents ?? 300_000,
      updatedAmountCents: overrides.updatedAmountCents ?? 300_000,
      evidenceSource: "agency_reported",
      openedAt: overrides.openedAt ?? "2026-06-10T09:00:00-03:00",
      openedByUserId: fx.userId,
      ...(status === "verified"
        ? {
            verification: {
              verifiedAt: "2026-06-12T09:00:00-03:00",
              verifiedByUserId: fx.userId,
            },
          }
        : {}),
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
        guaranteePublicId: fx.guaranteePublicId,
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
        guaranteePublicId: b.guaranteePublicId,
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
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    const after = Date.now();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publicId).toBe("DN-CT-1-2026-06-05");

    const row = await t.run((ctx) =>
      ctx.db
        .query("guaranteeDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(row).not.toBeNull();
    expect(row?.status).toBe("open");
    expect(row?.guaranteeId).toBe(fx.guaranteeId);
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
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-07-05",
      originalAmountCents: 250_000,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = await t.run((ctx) =>
      ctx.db
        .query("guaranteeDelinquencyNotices")
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
      guaranteePublicId: fx.guaranteePublicId,
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
      guaranteePublicId: fx.guaranteePublicId,
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
      guaranteePublicId: fx.guaranteePublicId,
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
      guaranteePublicId: fx.guaranteePublicId,
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
      guaranteePublicId: fx.guaranteePublicId,
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
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300.5,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_AMOUNT");
  });

  test("unknown guarantee publicId → GUARANTEE_NOT_FOUND", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: "CT-does-not-exist",
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("GUARANTEE_NOT_FOUND");
  });

  test("guarantee exists but in a different agency → GUARANTEE_NOT_FOUND (existence not leaked)", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");
    const asA = t.withIdentity({ subject: a.subject });
    const result = await asA.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: a.agencyId,
      guaranteePublicId: b.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("GUARANTEE_NOT_FOUND");
  });

  test("guarantee exists but status='drafted' → GUARANTEE_NOT_INSURED", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await setGuaranteeStatus(t, fx.guaranteeId, "drafted");
    const asUser = t.withIdentity({ subject: fx.subject });
    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("GUARANTEE_NOT_INSURED");
  });

  test("second open notice for same (guarantee, rentDueDate) → DUPLICATE_NOTICE", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });

    const first = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(first.success).toBe(true);

    const second = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.code).toBe("DUPLICATE_NOTICE");
  });

  test("prior canceled notice for same (guarantee, dueDate) does NOT block a re-file; suffixed publicId", async () => {
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
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publicId).toBe("DN-CT-1-2026-06-05-2");
  });

  test("two notices on same guarantee in same month, different due dates → distinct publicIds retrievable via getByPublicId", async () => {
    // Regression for the month-granularity collision: previously both notices
    // would base on `DN-CT-1-2026-04` and rely on the suffix loop. That loop
    // only saw prior rows on the SAME (guarantee, rentDueDate) tuple via
    // `by_guarantee_dueDate`, so the second notice would get the same base
    // publicId as the first and permanently break getByPublicId's `.unique()`.
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });

    const first = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: fx.guaranteePublicId,
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
      guaranteePublicId: fx.guaranteePublicId,
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

  test("staff-verified notice → NOTICE_VERIFIED; agency cannot make a confirmed default disappear", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-verified-r", status: "verified" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-verified-r",
      resolution: { kind: "tenant_cured" },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_VERIFIED");

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("verified");
    expect(row?.resolution).toBeUndefined();
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
        .query("guaranteeDelinquencyNotices")
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
        .query("guaranteeDelinquencyNotices")
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

  test("staff-verified notice → NOTICE_VERIFIED and row preserved", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-verified-c", status: "verified" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-verified-c",
      cancellation: { reason: "agency_withdrew" },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_VERIFIED");

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("verified");
    expect(row?.cancellation).toBeUndefined();
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
        .query("guaranteeDelinquencyNotices")
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
        .query("guaranteeDelinquencyNotices")
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
    const noticeId = await insertNotice(t, fx, {
      publicId: "DN-cover-happy",
      status: "verified",
    });
    await setGuaranteeStatus(t, fx.guaranteeId, "default_verified");
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
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-cover-happy"),
        )
        .collect(),
    );
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("delinquency.resolved_by_cover");
    expect(entries[0].actor).toEqual({ kind: "user", userId: fx.userId });
  });

  test("verified → resolved by cover is the staff path the agency guard reserves", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, {
      publicId: "DN-cover-verified",
      status: "verified",
    });
    await setGuaranteeStatus(t, fx.guaranteeId, "default_verified");
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-cover-verified", coverOperationPublicId: "COVER-V1" },
    );
    expect(result.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("cover_committed");
    expect(row?.verification?.verifiedByUserId).toBe(fx.userId);
  });

  test("staff role='admin' also allowed (admin ≥ compliance)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await insertNotice(t, fx, { publicId: "DN-cover-admin", status: "verified" });
    await setGuaranteeStatus(t, fx.guaranteeId, "default_verified");
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
    const noticeId = await insertNotice(t, b, {
      publicId: "DN-cross-agency",
      status: "verified",
    });
    await setGuaranteeStatus(t, b.guaranteeId, "default_verified");
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
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-cross-agency"),
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
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-cover-terminal"),
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
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-cover-self"),
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
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-dismiss-happy"),
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
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-dispute-happy"),
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
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-cross-dismiss"),
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
            .eq("resourceType", "guaranteeDelinquencyNotices")
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
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-dismiss-self"),
        )
        .collect(),
    );
    expect(entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Composition: notices drive the guarantee machine
//
// Every case below asserts BOTH rows the transaction touches — the notice and
// the guarantee it belongs to — plus what the guarantee timeline and the audit
// log recorded. The fixture's 300_000-cent rent under the seeded default
// product (30x ceiling multiplier) gives a 9_000_000-cent ceiling; the
// capacity literals are written out from that, never read back from pricing.
// ---------------------------------------------------------------------------

const CEILING_CENTS = 9_000_000;

async function readGuarantee(t: T, guaranteeId: GuaranteeId) {
  return orThrow(await t.run((ctx) => ctx.db.get(guaranteeId)), "guarantee row");
}

async function readGuaranteeHistory(t: T, guaranteePublicId: string) {
  return t.run((ctx) =>
    ctx.db
      .query("guaranteeHistory")
      .withIndex("by_guarantee", (q) => q.eq("guaranteePublicId", guaranteePublicId))
      .collect(),
  );
}

async function readGuaranteeAudit(t: T, guaranteePublicId: string) {
  return t.run((ctx) =>
    ctx.db
      .query("mutavAuditLog")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "guarantees").eq("resourceId", guaranteePublicId),
      )
      .collect(),
  );
}

describe("openNotice — composed guarantee transition", () => {
  test("active guarantee moves to in_arrears, with history and audit, in the same call", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(true);

    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("in_arrears");

    const history = await readGuaranteeHistory(t, fx.guaranteePublicId);
    expect(history.length).toBe(1);
    expect(history[0].transition).toEqual({ from: "active", to: "in_arrears" });

    const audit = await readGuaranteeAudit(t, fx.guaranteePublicId);
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe("guarantee.transitioned");
    expect(audit[0].actor).toEqual({ kind: "user", userId: fx.userId });
  });

  test("guarantee already in_arrears keeps its state and still records the notice", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-07-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("in_arrears");
    expect((await readGuaranteeHistory(t, fx.guaranteePublicId)).length).toBe(0);

    const notice = await t.run((ctx) =>
      ctx.db
        .query("guaranteeDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", result.data.publicId))
        .unique(),
    );
    expect(notice?.status).toBe("open");
  });

  test("guarantee under cover keeps cover_committed and still records the notice", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "cover_committed" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-08-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(true);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("cover_committed");
    expect((await readGuaranteeHistory(t, fx.guaranteePublicId)).length).toBe(0);
  });

  test("drafted guarantee is refused and writes nothing at all", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "drafted" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId: fx.agencyId,
      guaranteePublicId: fx.guaranteePublicId,
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("GUARANTEE_NOT_INSURED");

    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("drafted");
    expect((await readGuaranteeHistory(t, fx.guaranteePublicId)).length).toBe(0);
    const notices = await t.run((ctx) => ctx.db.query("guaranteeDelinquencyNotices").collect());
    expect(notices.length).toBe(0);
  });
});

describe("staffVerifyDefault", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-verify-noauth" });
    await expect(
      t.mutation(api.delinquencies.mutations.staffVerifyDefault, {
        noticePublicId: "DN-verify-noauth",
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("authenticated non-staff → throws ForbiddenError", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-verify-nostaff" });
    const asUser = t.withIdentity({ subject: fx.subject });
    await expect(
      asUser.mutation(api.delinquencies.mutations.staffVerifyDefault, {
        noticePublicId: "DN-verify-nostaff",
      }),
    ).rejects.toThrow(/Not a Mutav staff member/);
  });

  test("staff role='support' → throws (below compliance)", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-verify-support" });
    await grantStaffRole(t, fx.userId, "support");
    const asSupport = t.withIdentity({ subject: fx.subject });
    await expect(
      asSupport.mutation(api.delinquencies.mutations.staffVerifyDefault, {
        noticePublicId: "DN-verify-support",
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("unknown notice → NOTICE_NOT_FOUND", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });
    const result = await asCompliance.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: "DN-nope",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_NOT_FOUND");
  });

  test("happy path: notice open → verified and guarantee in_arrears → default_verified", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    const noticeId = await insertNotice(t, fx, { publicId: "DN-verify-happy" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const before = Date.now();
    const result = await asCompliance.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: "DN-verify-happy",
      note: "Comprovante conferido.",
    });
    const after = Date.now();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeStatus).toBe("default_verified");

    const row = orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row");
    expect(row.status).toBe("verified");
    const verification = orThrow(row.verification, "verification envelope");
    expect(verification.verifiedByUserId).toBe(fx.userId);
    expect(verification.note).toBe("Comprovante conferido.");
    const verifiedAtMs = Date.parse(verification.verifiedAt);
    expect(verifiedAtMs).toBeGreaterThanOrEqual(before);
    expect(verifiedAtMs).toBeLessThanOrEqual(after);

    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("default_verified");

    const history = await readGuaranteeHistory(t, fx.guaranteePublicId);
    expect(history.length).toBe(1);
    expect(history[0].transition).toEqual({ from: "in_arrears", to: "default_verified" });

    const noticeAudit = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", "DN-verify-happy"),
        )
        .collect(),
    );
    expect(noticeAudit.length).toBe(1);
    expect(noticeAudit[0].action).toBe("delinquency.verified");
    expect(noticeAudit[0].actor).toEqual({ kind: "user", userId: fx.userId });
  });

  test("guarantee still active → GUARANTEE_TRANSITION_REFUSED and neither row moves", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-verify-active" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: "DN-verify-active",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("GUARANTEE_TRANSITION_REFUSED");

    const row = orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row");
    expect(row.status).toBe("open");
    expect(row.verification).toBeUndefined();
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("active");
    expect((await readGuaranteeHistory(t, fx.guaranteePublicId)).length).toBe(0);
    expect((await readGuaranteeAudit(t, fx.guaranteePublicId)).length).toBe(0);
  });

  test("already-verified notice → SELF_TRANSITION, guarantee untouched", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    await insertNotice(t, fx, { publicId: "DN-verify-twice", status: "verified" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: "DN-verify-twice",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("SELF_TRANSITION");
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("default_verified");
    expect((await readGuaranteeHistory(t, fx.guaranteePublicId)).length).toBe(0);
  });

  test("a second notice on an already-verified default is verified without moving the guarantee", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    const noticeId = await insertNotice(t, fx, {
      publicId: "DN-verify-second",
      rentDueDate: "2026-07-05",
    });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: "DN-verify-second",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeStatus).toBe("default_verified");

    expect(orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row").status).toBe(
      "verified",
    );
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("default_verified");
    // No hop, so no history row and no guarantee-level audit entry.
    expect((await readGuaranteeHistory(t, fx.guaranteePublicId)).length).toBe(0);
    expect((await readGuaranteeAudit(t, fx.guaranteePublicId)).length).toBe(0);
  });

  test("a notice filed under committed cover is verified without moving the guarantee", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "cover_committed" });
    await insertNotice(t, fx, { publicId: "DN-verify-covered", rentDueDate: "2026-08-05" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: "DN-verify-covered",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeStatus).toBe("cover_committed");
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("cover_committed");
  });

  test("cross-agency: compliance staff verifies a notice owned by another agency", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2", { status: "in_arrears" });
    const noticeId = await insertNotice(t, b, { publicId: "DN-verify-cross" });
    await grantStaffRole(t, a.userId, "compliance");
    const asStaff = t.withIdentity({ subject: a.subject });

    const result = await asStaff.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: "DN-verify-cross",
    });
    expect(result.success).toBe(true);

    const row = orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row");
    expect(row.agencyId).toBe(b.agencyId);
    expect(row.verification?.verifiedByUserId).toBe(a.userId);
    expect((await readGuarantee(t, b.guaranteeId)).status).toBe("default_verified");
    // Agency A's own guarantee is untouched by staff acting on agency B's row.
    expect((await readGuarantee(t, a.guaranteeId)).status).toBe("active");
  });
});

describe("staffMarkResolvedByCover — capacity draw", () => {
  test("reserves the notice's updated amount and moves the guarantee to cover_committed", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    const noticeId = await insertNotice(t, fx, {
      publicId: "DN-draw-happy",
      status: "verified",
      originalAmountCents: 250_000,
      updatedAmountCents: 250_000,
    });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-draw-happy", coverOperationPublicId: "COVER-D1" },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.appliedCoverCents).toBe(250_000);

    const guarantee = await readGuarantee(t, fx.guaranteeId);
    expect(guarantee.status).toBe("cover_committed");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 8_750_000,
      reservedCents: 250_000,
    });

    const row = orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row");
    expect(row.resolution?.appliedCoverCents).toBe(250_000);
    expect(row.resolution?.kind).toBe("cover_committed");

    const audit = await readGuaranteeAudit(t, fx.guaranteePublicId);
    expect(audit.map((entry) => entry.action)).toEqual([
      "guarantee.capacity_reserved",
      "guarantee.transitioned",
    ]);
  });

  test("draws the UPDATED amount, not the original one", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    await insertNotice(t, fx, {
      publicId: "DN-draw-updated",
      status: "verified",
      originalAmountCents: 200_000,
      updatedAmountCents: 260_000,
    });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-draw-updated", coverOperationPublicId: "COVER-D2" },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.appliedCoverCents).toBe(260_000);
    expect((await readGuarantee(t, fx.guaranteeId)).capacity.reservedCents).toBe(260_000);
  });

  test("a notice worth more than the remaining ceiling is clamped to what is available", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", {
      status: "default_verified",
      availableCents: 100_000,
    });
    const noticeId = await insertNotice(t, fx, {
      publicId: "DN-draw-clamp",
      status: "verified",
      originalAmountCents: 300_000,
      updatedAmountCents: 300_000,
    });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-draw-clamp", coverOperationPublicId: "COVER-D3" },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.appliedCoverCents).toBe(100_000);

    const guarantee = await readGuarantee(t, fx.guaranteeId);
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 0,
      reservedCents: CEILING_CENTS,
    });

    const row = orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row");
    // The APPLIED figure, not the 300_000 face amount — a reversal gives back
    // exactly what was taken.
    expect(row.resolution?.appliedCoverCents).toBe(100_000);
  });

  test("an exhausted guarantee applies zero and still records the cover", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified", availableCents: 0 });
    await insertNotice(t, fx, {
      publicId: "DN-draw-exhausted",
      status: "verified",
      originalAmountCents: 300_000,
      updatedAmountCents: 300_000,
    });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-draw-exhausted", coverOperationPublicId: "COVER-D4" },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.appliedCoverCents).toBe(0);

    const guarantee = await readGuarantee(t, fx.guaranteeId);
    expect(guarantee.status).toBe("cover_committed");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 0,
      reservedCents: CEILING_CENTS,
    });
  });

  test("an unverified notice cannot draw cover even when a sibling verified the default", async () => {
    // The guarantee is `default_verified` because ANOTHER notice was verified.
    // Without a notice-level gate the machine check alone would let this one
    // through and draw against a default nobody confirmed for it.
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    await insertNotice(t, fx, {
      publicId: "DN-draw-sibling-verified",
      status: "verified",
      rentDueDate: "2026-05-05",
    });
    const unverifiedId = await insertNotice(t, fx, {
      publicId: "DN-draw-unverified",
      rentDueDate: "2026-06-05",
    });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-draw-unverified", coverOperationPublicId: "COVER-D6" },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_NOT_VERIFIED");

    const guarantee = await readGuarantee(t, fx.guaranteeId);
    expect(guarantee.status).toBe("default_verified");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS,
      reservedCents: 0,
    });
    expect(orThrow(await t.run((ctx) => ctx.db.get(unverifiedId)), "notice row").status).toBe(
      "open",
    );
    expect((await readGuaranteeAudit(t, fx.guaranteePublicId)).length).toBe(0);
  });

  test("a second verified notice draws again against the same ceiling without a second hop", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    await insertNotice(t, fx, {
      publicId: "DN-draw-month-1",
      status: "verified",
      rentDueDate: "2026-06-05",
      originalAmountCents: 250_000,
      updatedAmountCents: 250_000,
    });
    const secondId = await insertNotice(t, fx, {
      publicId: "DN-draw-month-2",
      status: "verified",
      rentDueDate: "2026-07-05",
      originalAmountCents: 100_000,
      updatedAmountCents: 100_000,
    });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const first = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-draw-month-1", coverOperationPublicId: "COVER-M1" },
    );
    expect(first.success).toBe(true);

    const second = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-draw-month-2", coverOperationPublicId: "COVER-M2" },
    );
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.data.appliedCoverCents).toBe(100_000);

    const guarantee = await readGuarantee(t, fx.guaranteeId);
    expect(guarantee.status).toBe("cover_committed");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 8_650_000,
      reservedCents: 350_000,
    });
    // Each notice records its own applied figure so a reversal gives back
    // exactly what that notice took.
    expect(
      orThrow(await t.run((ctx) => ctx.db.get(secondId)), "notice row").resolution
        ?.appliedCoverCents,
    ).toBe(100_000);
    // One state hop for the episode, two reservations.
    expect((await readGuaranteeAudit(t, fx.guaranteePublicId)).map((e) => e.action)).toEqual([
      "guarantee.capacity_reserved",
      "guarantee.transitioned",
      "guarantee.capacity_reserved",
    ]);
  });

  test("guarantee still active → refused, and no capacity moves", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const noticeId = await insertNotice(t, fx, { publicId: "DN-draw-active", status: "verified" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkResolvedByCover,
      { noticePublicId: "DN-draw-active", coverOperationPublicId: "COVER-D5" },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("GUARANTEE_TRANSITION_REFUSED");

    const guarantee = await readGuarantee(t, fx.guaranteeId);
    expect(guarantee.status).toBe("active");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS,
      reservedCents: 0,
    });
    expect(orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row").status).toBe(
      "verified",
    );
    expect((await readGuaranteeAudit(t, fx.guaranteePublicId)).length).toBe(0);
  });
});

describe("markResolved — return to active", () => {
  test("curing the last outstanding notice returns the guarantee to active", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-cure-only" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-cure-only",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(true);

    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("active");
    const history = await readGuaranteeHistory(t, fx.guaranteePublicId);
    expect(history.length).toBe(1);
    expect(history[0].transition).toEqual({ from: "in_arrears", to: "active" });
  });

  test("another open notice on the same guarantee keeps it in arrears", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-cure-one", rentDueDate: "2026-06-05" });
    await insertNotice(t, fx, { publicId: "DN-cure-two", rentDueDate: "2026-07-05" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-cure-one",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("in_arrears");
    expect((await readGuaranteeHistory(t, fx.guaranteePublicId)).length).toBe(0);
  });

  test("a staff-verified notice still outstanding keeps the guarantee where it is", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    await insertNotice(t, fx, { publicId: "DN-cure-open", rentDueDate: "2026-06-05" });
    await insertNotice(t, fx, {
      publicId: "DN-cure-verified",
      rentDueDate: "2026-07-05",
      status: "verified",
    });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-cure-open",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("default_verified");
  });

  test("a resolved or canceled sibling does not block the return to active", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-cure-live", rentDueDate: "2026-06-05" });
    await insertNotice(t, fx, {
      publicId: "DN-cure-done",
      rentDueDate: "2026-05-05",
      status: "resolved",
    });
    await insertNotice(t, fx, {
      publicId: "DN-cure-dropped",
      rentDueDate: "2026-04-05",
      status: "canceled",
    });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-cure-live",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(true);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("active");
  });

  test("a 'stale' resolution never hands the guarantee back its performing state", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-cure-stale" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-cure-stale",
      resolution: { kind: "stale" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("in_arrears");
  });

  test("a guarantee in eviction is not pulled back by a cure", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_eviction" });
    const noticeId = await insertNotice(t, fx, { publicId: "DN-cure-eviction" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-cure-eviction",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("in_eviction");
    // The notice itself still resolves — the cure is a fact worth recording.
    expect(orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row").status).toBe(
      "resolved",
    );
  });

  test("a member of another agency cannot cure this agency's notice", async () => {
    const t = setup();
    const a = await makeFixture(t, "1", { status: "in_arrears" });
    const b = await makeFixture(t, "2");
    await insertNotice(t, a, { publicId: "DN-cure-cross" });
    const asB = t.withIdentity({ subject: b.subject });

    await expect(
      asB.mutation(api.delinquencies.mutations.markResolved, {
        noticePublicId: "DN-cure-cross",
        resolution: { kind: "tenant_cured" },
      }),
    ).rejects.toThrow(/not a member/);
    expect((await readGuarantee(t, a.guaranteeId)).status).toBe("in_arrears");
  });

  test("a staff-verified notice is refused for the agency and moves no guarantee", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    await insertNotice(t, fx, { publicId: "DN-cure-locked", status: "verified" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-cure-locked",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_VERIFIED");
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("default_verified");
  });
});

describe("markCanceled — return to active", () => {
  test("canceling the last outstanding notice returns the guarantee to active", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-cancel-only" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-cancel-only",
      cancellation: { reason: "data_error" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(true);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("active");
  });

  test("another open notice keeps the guarantee in arrears", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "in_arrears" });
    await insertNotice(t, fx, { publicId: "DN-cancel-one", rentDueDate: "2026-06-05" });
    await insertNotice(t, fx, { publicId: "DN-cancel-two", rentDueDate: "2026-07-05" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-cancel-one",
      cancellation: { reason: "duplicate" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("in_arrears");
  });

  test("a cancellation never touches capacity", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", {
      status: "in_arrears",
      availableCents: 8_700_000,
    });
    await insertNotice(t, fx, { publicId: "DN-cancel-capacity" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: "DN-cancel-capacity",
      cancellation: { reason: "agency_withdrew" },
    });
    expect(result.success).toBe(true);

    const guarantee = await readGuarantee(t, fx.guaranteeId);
    expect(guarantee.status).toBe("active");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 8_700_000,
      reservedCents: 300_000,
    });
  });

  test("a member of another agency cannot cancel this agency's notice", async () => {
    const t = setup();
    const a = await makeFixture(t, "1", { status: "in_arrears" });
    const b = await makeFixture(t, "2");
    await insertNotice(t, a, { publicId: "DN-cancel-cross" });
    const asB = t.withIdentity({ subject: b.subject });

    await expect(
      asB.mutation(api.delinquencies.mutations.markCanceled, {
        noticePublicId: "DN-cancel-cross",
        cancellation: { reason: "data_error" },
      }),
    ).rejects.toThrow(/not a member/);
    expect((await readGuarantee(t, a.guaranteeId)).status).toBe("in_arrears");
  });
});

describe("return to active — who may leave which state", () => {
  // The machine allows `default_verified → active` and `cover_committed →
  // active`; the mutations do not hand that authority to an agency. Without
  // the state-specific gate an agency could open a fresh notice on a covered
  // guarantee, cancel it, and walk a paid-out default back to performing.
  test.each([
    { label: "a verified default", status: "default_verified" as GuaranteeState },
    { label: "a committed cover", status: "cover_committed" as GuaranteeState },
  ])("an agency cancellation does not pull $label back to active", async ({ status }) => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status });
    await insertNotice(t, fx, { publicId: `DN-walkback-${status}`, rentDueDate: "2026-09-05" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markCanceled, {
      noticePublicId: `DN-walkback-${status}`,
      cancellation: { reason: "data_error" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe(status);
    expect((await readGuaranteeHistory(t, fx.guaranteePublicId)).length).toBe(0);
  });

  test("an agency cure does not pull a committed cover back to active", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "cover_committed" });
    await insertNotice(t, fx, { publicId: "DN-walkback-cure", rentDueDate: "2026-09-05" });
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.delinquencies.mutations.markResolved, {
      noticePublicId: "DN-walkback-cure",
      resolution: { kind: "tenant_cured" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("cover_committed");
  });

  test("a compliance dismissal undoes its own verification and returns the guarantee", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    const noticeId = await insertNotice(t, fx, {
      publicId: "DN-dismiss-restores",
      status: "verified",
    });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      { noticePublicId: "DN-dismiss-restores", disposition: { kind: "staff_dismissed" } },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(true);

    expect(orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row").status).toBe(
      "canceled",
    );
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("active");
    const history = await readGuaranteeHistory(t, fx.guaranteePublicId);
    expect(history.length).toBe(1);
    expect(history[0].transition).toEqual({ from: "default_verified", to: "active" });
  });

  test("a dismissal leaves the guarantee alone while another notice is outstanding", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    await insertNotice(t, fx, {
      publicId: "DN-dismiss-one",
      status: "verified",
      rentDueDate: "2026-06-05",
    });
    await insertNotice(t, fx, { publicId: "DN-dismiss-two", rentDueDate: "2026-07-05" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      { noticePublicId: "DN-dismiss-one", disposition: { kind: "staff_dismissed" } },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("default_verified");
  });

  test("a dismissal never gives back cents a cover already reserved", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", {
      status: "cover_committed",
      availableCents: 8_700_000,
    });
    await insertNotice(t, fx, { publicId: "DN-dismiss-covered", status: "verified" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      { noticePublicId: "DN-dismiss-covered", disposition: { kind: "staff_dismissed" } },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);

    const guarantee = await readGuarantee(t, fx.guaranteeId);
    expect(guarantee.status).toBe("cover_committed");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 8_700_000,
      reservedCents: 300_000,
    });
  });

  test("a staff dispute leaves the default standing for the reversal to close", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1", { status: "default_verified" });
    await insertNotice(t, fx, { publicId: "DN-dispute-holds", status: "verified" });
    await grantStaffRole(t, fx.userId, "compliance");
    const asCompliance = t.withIdentity({ subject: fx.subject });

    const result = await asCompliance.mutation(
      api.delinquencies.mutations.staffMarkCanceledByDismissal,
      { noticePublicId: "DN-dispute-holds", disposition: { kind: "staff_dispute" } },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.guaranteeReturnedToActive).toBe(false);
    expect((await readGuarantee(t, fx.guaranteeId)).status).toBe("default_verified");
  });
});
