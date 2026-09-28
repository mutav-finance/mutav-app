// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { registerGuaranteeAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import { replaceGuaranteeAggregates } from "./aggregateWrites";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import type { GuaranteeCapacity, GuaranteeId, GuaranteeState } from "./domain";
import schema from "../schema";

/**
 * Cover → reversal, end to end through the public mutations: the agency files
 * the notice, compliance verifies it and commits cover, and a later
 * `close(dispute_reversal)` must hand back exactly the cents cover reserved —
 * with a release audit row, a transition audit row and a history row, all in
 * the closing transaction.
 */

function setup() {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

type T = ReturnType<typeof setup>;

// Rent 300_000 × the default 30× multiplier. Spelled out so a pricing change
// fails loudly here instead of silently agreeing.
const CEILING_CENTS = 9_000_000;
const RENT_CENTS = 300_000;

type Fixture = {
  subject: string;
  userId: UserId;
  agencyId: AgencyId;
  guaranteeId: GuaranteeId;
  guaranteePublicId: string;
};

/**
 * One user who is both the agency's owner and Mutav compliance staff, so a
 * single identity can walk the whole path the two roles normally split.
 */
async function makeFixture(
  t: T,
  suffix: string,
  guarantee: { status?: GuaranteeState; availableCents?: number } = {},
): Promise<Fixture> {
  const subject = `auth0|reversal-${suffix}`;
  const guaranteePublicId = `REV-${suffix}`;
  const { userId, agencyId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `user-reversal-${suffix}`,
      subject,
      name: `Reversal User ${suffix}`,
      email: `reversal-${suffix}@test.br`,
      createdAt: "2024-01-01T00:00:00-03:00",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: `Reversal Agency ${suffix}`,
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
    await ctx.db.insert("mutavStaff", {
      userId,
      role: "compliance",
      createdAt: "2024-01-01T00:00:00-03:00",
    });
    return { userId, agencyId };
  });
  const { guaranteeId } = await seedGuaranteeWithLease(
    t,
    {
      agencyId,
      status: guarantee.status ?? "active",
      activatedAt: "2024-06-01T00:00:00.000Z",
      rentCents: RENT_CENTS,
      tenantTaxId: `1114447773${suffix}`.slice(-11),
      ...(guarantee.availableCents === undefined
        ? {}
        : { availableCents: guarantee.availableCents }),
    },
    guaranteePublicId,
  );
  return { subject, userId, agencyId, guaranteeId, guaranteePublicId };
}

async function readGuarantee(t: T, guaranteeId: GuaranteeId) {
  const row = await t.run((ctx) => ctx.db.get(guaranteeId));
  if (!row) throw new Error("guarantee row vanished");
  return row;
}

async function guaranteeAuditActions(t: T, guaranteePublicId: string): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("mutavAuditLog")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "guarantees").eq("resourceId", guaranteePublicId),
      )
      .collect(),
  );
  return rows.map((row) => row.action);
}

async function releaseEntries(t: T, guaranteePublicId: string) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("mutavAuditLog")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "guarantees").eq("resourceId", guaranteePublicId),
      )
      .collect(),
  );
  return rows.filter((row) => row.action === "guarantee.capacity_released");
}

/** File → verify → cover one missed rent, through the real mutations. */
async function coverOneRent(
  t: T,
  fx: Fixture,
  { rentDueDate, amountCents }: { rentDueDate: string; amountCents: number },
): Promise<number> {
  const asUser = t.withIdentity({ subject: fx.subject });
  const opened = await asUser.mutation(api.delinquencies.mutations.openNotice, {
    agencyId: fx.agencyId,
    guaranteePublicId: fx.guaranteePublicId,
    rentDueDate,
    originalAmountCents: amountCents,
  });
  if (!opened.success) throw new Error(opened.message);
  const verified = await asUser.mutation(api.delinquencies.mutations.staffVerifyDefault, {
    noticePublicId: opened.data.publicId,
  });
  if (!verified.success) throw new Error(verified.message);
  const covered = await asUser.mutation(api.delinquencies.mutations.staffMarkResolvedByCover, {
    noticePublicId: opened.data.publicId,
    coverOperationPublicId: `COVER-${rentDueDate}`,
  });
  if (!covered.success) throw new Error(covered.message);
  return covered.data.appliedCoverCents;
}

async function setCapacity(t: T, guaranteeId: GuaranteeId, capacity: GuaranteeCapacity) {
  await t.run(async (ctx) => {
    const before = await ctx.db.get(guaranteeId);
    if (!before) throw new Error("guarantee row vanished");
    await ctx.db.patch(guaranteeId, { capacity });
    const after = await ctx.db.get(guaranteeId);
    if (!after) throw new Error("guarantee row vanished");
    await replaceGuaranteeAggregates(ctx, before, after);
  });
}

describe("close(dispute_reversal) after cover releases the reserved capacity", () => {
  test("cover → reversal restores the full ceiling to available, with release, transition and history rows", async () => {
    const t = setup();
    const fx = await makeFixture(t, "1");
    await coverOneRent(t, fx, { rentDueDate: "2026-06-05", amountCents: 250_000 });

    const covered = await readGuarantee(t, fx.guaranteeId);
    expect(covered.status).toBe("cover_committed");
    expect(covered.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS - 250_000,
      reservedCents: 250_000,
    });

    const asStaff = t.withIdentity({ subject: fx.subject });
    const result = await asStaff.mutation(api.guarantees.mutations.close, {
      publicId: fx.guaranteePublicId,
      reason: "dispute_reversal",
    });
    expect(result.success).toBe(true);

    const closed = await readGuarantee(t, fx.guaranteeId);
    expect(closed.status).toBe("closed");
    expect(closed.closure?.reason).toBe("dispute_reversal");
    expect(closed.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS,
      reservedCents: 0,
    });

    // Release first, then the transition that stamps the restored capacity.
    expect(await guaranteeAuditActions(t, fx.guaranteePublicId)).toEqual([
      "guarantee.transitioned", // active → in_arrears
      "guarantee.transitioned", // in_arrears → default_verified
      "guarantee.capacity_reserved",
      "guarantee.transitioned", // default_verified → cover_committed
      "guarantee.capacity_released",
      "guarantee.transitioned", // cover_committed → closed
    ]);
    const [released] = await releaseEntries(t, fx.guaranteePublicId);
    expect(released.actor).toEqual({ kind: "user", userId: fx.userId });

    const history = await t.run((ctx) =>
      ctx.db
        .query("guaranteeHistory")
        .withIndex("by_guarantee", (q) => q.eq("guaranteePublicId", fx.guaranteePublicId))
        .collect(),
    );
    expect(history.at(-1)?.transition).toEqual({
      from: "cover_committed",
      to: "closed",
      closeReason: "dispute_reversal",
    });

    const lease = await t.run((ctx) => ctx.db.get(closed.leaseId));
    expect(lease?.openGuaranteeId).toBeNull();
  });

  test("several covered rents of one episode are all released", async () => {
    const t = setup();
    const fx = await makeFixture(t, "2");
    await coverOneRent(t, fx, { rentDueDate: "2026-06-05", amountCents: 250_000 });
    await coverOneRent(t, fx, { rentDueDate: "2026-07-05", amountCents: 310_000 });
    expect((await readGuarantee(t, fx.guaranteeId)).capacity.reservedCents).toBe(560_000);

    const asStaff = t.withIdentity({ subject: fx.subject });
    const result = await asStaff.mutation(api.guarantees.mutations.close, {
      publicId: fx.guaranteePublicId,
      reason: "dispute_reversal",
    });
    expect(result.success).toBe(true);

    expect((await readGuarantee(t, fx.guaranteeId)).capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS,
      reservedCents: 0,
    });
    const released = await releaseEntries(t, fx.guaranteePublicId);
    expect(released.length).toBe(1);
  });

  test("a clamped draw releases the applied figure, never the notice's face amount", async () => {
    const t = setup();
    const fx = await makeFixture(t, "3");
    // The first rent eats all but 100_000 of the ceiling, so the second is
    // clamped: it is worth 250_000 but can only reserve what is left.
    await coverOneRent(t, fx, { rentDueDate: "2026-06-05", amountCents: CEILING_CENTS - 100_000 });
    const applied = await coverOneRent(t, fx, { rentDueDate: "2026-07-05", amountCents: 250_000 });
    expect(applied).toBe(100_000);

    const asStaff = t.withIdentity({ subject: fx.subject });
    const result = await asStaff.mutation(api.guarantees.mutations.close, {
      publicId: fx.guaranteePublicId,
      reason: "dispute_reversal",
    });
    expect(result.success).toBe(true);

    // Releasing the face amounts would ask for 150_000 more than was ever
    // reserved; the applied figures give back exactly the ceiling.
    expect((await readGuarantee(t, fx.guaranteeId)).capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS,
      reservedCents: 0,
    });
    expect((await releaseEntries(t, fx.guaranteePublicId)).length).toBe(1);
  });

  test("a reversal before any cover moves no capacity and writes no release row", async () => {
    const t = setup();
    const fx = await makeFixture(t, "4", { status: "default_verified" });
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.close, {
      publicId: fx.guaranteePublicId,
      reason: "dispute_reversal",
    });
    expect(result.success).toBe(true);
    expect(await releaseEntries(t, fx.guaranteePublicId)).toEqual([]);
    expect((await readGuarantee(t, fx.guaranteeId)).capacity.reservedCents).toBe(0);
  });

  test("closing a covered guarantee for any other reason keeps the cents reserved (paid out, not reversed)", async () => {
    const t = setup();
    const fx = await makeFixture(t, "5");
    await coverOneRent(t, fx, { rentDueDate: "2026-06-05", amountCents: 250_000 });

    const asStaff = t.withIdentity({ subject: fx.subject });
    const result = await asStaff.mutation(api.guarantees.mutations.close, {
      publicId: fx.guaranteePublicId,
      reason: "rescission",
    });
    expect(result.success).toBe(true);
    expect((await readGuarantee(t, fx.guaranteeId)).capacity.reservedCents).toBe(250_000);
    expect(await releaseEntries(t, fx.guaranteePublicId)).toEqual([]);
  });

  test("a reserved figure the covered notices cannot account for is refused and nothing is written", async () => {
    const t = setup();
    const fx = await makeFixture(t, "6");
    await coverOneRent(t, fx, { rentDueDate: "2026-06-05", amountCents: 250_000 });
    // Reserved says 400_000 but the only covered notice applied 250_000.
    await setCapacity(t, fx.guaranteeId, {
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS - 400_000,
      reservedCents: 400_000,
    });
    const auditBefore = await guaranteeAuditActions(t, fx.guaranteePublicId);

    const asStaff = t.withIdentity({ subject: fx.subject });
    const result = await asStaff.mutation(api.guarantees.mutations.close, {
      publicId: fx.guaranteePublicId,
      reason: "dispute_reversal",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CAPACITY_INVARIANT_BROKEN");

    const after = await readGuarantee(t, fx.guaranteeId);
    expect(after.status).toBe("cover_committed");
    expect(after.capacity.reservedCents).toBe(400_000);
    expect(await guaranteeAuditActions(t, fx.guaranteePublicId)).toEqual(auditBefore);
  });
});
