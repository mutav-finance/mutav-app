// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import { AUDIT_ACTION } from "../audit/domain";
import { registerContractAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import { contractsByStatus } from "./aggregate";
import {
  CLOSE_REASON,
  GUARANTEE_STATE,
  type Guarantee,
  type GuaranteeCapacity,
  type GuaranteeId,
  type GuaranteeState,
} from "./domain";
import {
  applyGuaranteeTransition,
  releaseCoverCapacity,
  reserveCoverCapacity,
  type GuaranteeActor,
} from "./transitions";
import schema from "../schema";

type T = TestConvex<typeof schema>;

const RENT_CENTS = 100_000;
// `DEFAULT_PRICING_TABLE.coverageCeilingMultiplier` is 30, so the fixture's
// rent prices a 3,000,000-cent ceiling. Spelled out rather than derived so a
// pricing change fails these tests loudly instead of silently agreeing.
const CEILING_CENTS = 3_000_000;

function setup(): T {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  return t;
}

async function seedActor(t: T, suffix: string): Promise<{ actor: GuaranteeActor; userId: UserId }> {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: `user-${suffix}`,
      subject: `auth0|user-${suffix}`,
      name: `Actor ${suffix}`,
      email: `actor-${suffix}@test.br`,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  return { actor: { userId, username: `Actor ${suffix}` }, userId };
}

async function seedAgency(t: T, suffix: string): Promise<AgencyId> {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name: `Agency ${suffix}`,
      cnpj: `0000000000${suffix}`.slice(-14),
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

async function readGuarantee(t: T, guaranteeId: GuaranteeId): Promise<Guarantee> {
  const doc = await t.run((ctx) => ctx.db.get(guaranteeId));
  if (!doc) throw new Error("guarantee vanished");
  return doc;
}

async function historyFor(t: T, publicId: string) {
  return t.run((ctx) =>
    ctx.db
      .query("guaranteeHistory")
      .withIndex("by_guarantee", (q) => q.eq("guaranteePublicId", publicId))
      .collect(),
  );
}

async function auditActions(t: T): Promise<string[]> {
  const rows = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
  return rows.map((row) => row.action);
}

async function countInState(t: T, agencyId: AgencyId, state: GuaranteeState): Promise<number> {
  return t.run((ctx) =>
    contractsByStatus.count(ctx, {
      namespace: agencyId,
      bounds: { lower: { key: state, inclusive: true }, upper: { key: state, inclusive: true } },
    }),
  );
}

describe("applyGuaranteeTransition — machine composition", () => {
  let t: T;
  let agencyId: AgencyId;
  let actor: GuaranteeActor;

  beforeEach(async () => {
    t = setup();
    agencyId = await seedAgency(t, "1");
    ({ actor } = await seedActor(t, "1"));
  });

  test("drafted → active stamps activatedAt, applies capacity and records both twins", async () => {
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.DRAFTED, rentCents: RENT_CENTS },
      "G1",
    );
    const guarantee = await readGuarantee(t, guaranteeId);

    const result = await t.run((ctx) =>
      applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.ACTIVE,
        capacity: {
          ceilingCents: CEILING_CENTS,
          availableCents: CEILING_CENTS,
          reservedCents: 0,
        },
        actor,
        message: "Garantia ativada",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.from).toBe(GUARANTEE_STATE.DRAFTED);
    expect(result.data.to).toBe(GUARANTEE_STATE.ACTIVE);
    expect(result.data.closeReason).toBeNull();

    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe(GUARANTEE_STATE.ACTIVE);
    expect(after.activatedAt).not.toBeNull();
    expect(after.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS,
      reservedCents: 0,
    });

    const history = await historyFor(t, "G1");
    expect(history).toHaveLength(1);
    expect(history[0].message).toBe("Garantia ativada");
    expect(history[0].transition).toEqual({
      from: GUARANTEE_STATE.DRAFTED,
      to: GUARANTEE_STATE.ACTIVE,
    });
    expect(history[0].username).toBe("Actor 1");

    expect(await auditActions(t)).toEqual([AUDIT_ACTION.GUARANTEE_TRANSITIONED]);
    expect(await countInState(t, agencyId, GUARANTEE_STATE.ACTIVE)).toBe(1);
    expect(await countInState(t, agencyId, GUARANTEE_STATE.DRAFTED)).toBe(0);
  });

  test("returning to active from arrears leaves the original activatedAt in place", async () => {
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: GUARANTEE_STATE.IN_ARREARS,
        activatedAt: "2026-02-01T00:00:00.000Z",
      },
      "G2",
    );
    const guarantee = await readGuarantee(t, guaranteeId);

    const result = await t.run((ctx) =>
      applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.ACTIVE,
        actor,
        message: "Inadimplência regularizada",
      }),
    );

    expect(result.success).toBe(true);
    expect((await readGuarantee(t, guaranteeId)).activatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  test("closing records the reason on the row, on the history twin and nulls the lease pointer", async () => {
    const { guaranteeId, leaseId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, activatedAt: "2026-02-01T00:00:00.000Z" },
      "G3",
    );
    const guarantee = await readGuarantee(t, guaranteeId);
    expect((await t.run((ctx) => ctx.db.get(leaseId)))?.openGuaranteeId).toBe(guaranteeId);

    const result = await t.run((ctx) =>
      applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.CLOSED,
        closure: { reason: CLOSE_REASON.END_OF_LEASE, note: "Contrato encerrado" },
        actor,
        message: "Garantia encerrada",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.closeReason).toBe(CLOSE_REASON.END_OF_LEASE);

    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe(GUARANTEE_STATE.CLOSED);
    expect(after.closure?.reason).toBe(CLOSE_REASON.END_OF_LEASE);
    expect(after.closure?.note).toBe("Contrato encerrado");
    expect(after.closure?.closedAt).toEqual(expect.any(String));

    const history = await historyFor(t, "G3");
    expect(history[0].transition).toEqual({
      from: GUARANTEE_STATE.ACTIVE,
      to: GUARANTEE_STATE.CLOSED,
      closeReason: CLOSE_REASON.END_OF_LEASE,
    });

    expect((await t.run((ctx) => ctx.db.get(leaseId)))?.openGuaranteeId).toBeNull();
  });

  test.each([
    {
      label: "illegal target",
      to: GUARANTEE_STATE.IN_ARREARS,
      from: GUARANTEE_STATE.DRAFTED,
      code: "ILLEGAL_TRANSITION",
    },
    {
      label: "self transition",
      to: GUARANTEE_STATE.DRAFTED,
      from: GUARANTEE_STATE.DRAFTED,
      code: "SELF_TRANSITION",
    },
    {
      label: "terminal origin",
      to: GUARANTEE_STATE.ACTIVE,
      from: GUARANTEE_STATE.CLOSED,
      code: "TERMINAL_STATE",
    },
  ])("$label is refused before any write", async ({ to, from, code }) => {
    const { guaranteeId } = await seedGuaranteeWithLease(t, { agencyId, status: from }, "G4");
    const guarantee = await readGuarantee(t, guaranteeId);

    const result = await t.run((ctx) =>
      applyGuaranteeTransition(ctx, { guarantee, to, actor, message: "n/a" }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(code);
    expect((await readGuarantee(t, guaranteeId)).status).toBe(from);
    expect(await historyFor(t, "G4")).toHaveLength(0);
    expect(await auditActions(t)).toHaveLength(0);
  });

  test("closing without a reason is refused before any write", async () => {
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE },
      "G5",
    );
    const guarantee = await readGuarantee(t, guaranteeId);

    const result = await t.run((ctx) =>
      applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.CLOSED,
        actor,
        message: "Garantia encerrada",
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CLOSURE_REQUIRED");
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.ACTIVE);
    expect(await historyFor(t, "G5")).toHaveLength(0);
  });

  test("a closure payload on a non-closing transition is refused", async () => {
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE },
      "G6",
    );
    const guarantee = await readGuarantee(t, guaranteeId);

    const result = await t.run((ctx) =>
      applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.IN_ARREARS,
        closure: { reason: CLOSE_REASON.END_OF_LEASE },
        actor,
        message: "n/a",
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CLOSURE_NOT_ALLOWED");
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.ACTIVE);
  });

  test("a close reason the origin state does not allow is refused", async () => {
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE },
      "G7",
    );
    const guarantee = await readGuarantee(t, guaranteeId);

    const result = await t.run((ctx) =>
      applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.CLOSED,
        closure: { reason: CLOSE_REASON.EVICTION },
        actor,
        message: "n/a",
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("REASON_NOT_ALLOWED_FROM_STATE");
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.ACTIVE);
  });

  test("a supplied capacity that breaks available + reserved = ceiling is refused", async () => {
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.DRAFTED },
      "G8",
    );
    const guarantee = await readGuarantee(t, guaranteeId);

    const result = await t.run((ctx) =>
      applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.ACTIVE,
        capacity: { ceilingCents: CEILING_CENTS, availableCents: CEILING_CENTS, reservedCents: 1 },
        actor,
        message: "Garantia ativada",
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CAPACITY_INVARIANT_BROKEN");
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.DRAFTED);
  });
});

describe("cover capacity arithmetic", () => {
  let t: T;
  let agencyId: AgencyId;
  let actor: GuaranteeActor;

  beforeEach(async () => {
    t = setup();
    agencyId = await seedAgency(t, "2");
    ({ actor } = await seedActor(t, "2"));
  });

  async function seedActive(publicId: string, availableCents?: number): Promise<Guarantee> {
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      {
        agencyId,
        status: GUARANTEE_STATE.ACTIVE,
        rentCents: RENT_CENTS,
        activatedAt: "2026-02-01T00:00:00.000Z",
        ...(availableCents === undefined ? {} : { availableCents }),
      },
      publicId,
    );
    return readGuarantee(t, guaranteeId);
  }

  function isBalanced(capacity: GuaranteeCapacity): boolean {
    return capacity.availableCents + capacity.reservedCents === capacity.ceilingCents;
  }

  test("reserves the full amount when the ceiling still covers it", async () => {
    const guarantee = await seedActive("C1");

    const result = await t.run((ctx) =>
      reserveCoverCapacity(ctx, { guarantee, amountCents: 250_000, actor }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.appliedCents).toBe(250_000);
    expect(result.data.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 2_750_000,
      reservedCents: 250_000,
    });
    expect(isBalanced(result.data.capacity)).toBe(true);
    expect(await auditActions(t)).toEqual([AUDIT_ACTION.GUARANTEE_CAPACITY_RESERVED]);
  });

  test("clamps to what is available when the notice is worth more than the ceiling", async () => {
    // 400,000 already reserved, so 2,600,000 is all that is left to draw on.
    const guarantee = await seedActive("C2", 2_600_000);

    const result = await t.run((ctx) =>
      reserveCoverCapacity(ctx, { guarantee, amountCents: 9_999_999, actor }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.appliedCents).toBe(2_600_000);
    expect(result.data.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 0,
      reservedCents: CEILING_CENTS,
    });
    expect(isBalanced(result.data.capacity)).toBe(true);
  });

  test("a second draw on an exhausted guarantee applies zero and moves nothing", async () => {
    const guarantee = await seedActive("C3", 0);

    const result = await t.run((ctx) =>
      reserveCoverCapacity(ctx, { guarantee, amountCents: 500_000, actor }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.appliedCents).toBe(0);
    expect(result.data.capacity).toEqual(guarantee.capacity);
  });

  test.each([
    { label: "negative", amountCents: -1 },
    { label: "fractional", amountCents: 100.5 },
  ])("a $label amount is refused before any write", async ({ amountCents }) => {
    const guarantee = await seedActive("C4");

    const result = await t.run((ctx) =>
      reserveCoverCapacity(ctx, { guarantee, amountCents, actor }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_AMOUNT");
    expect((await readGuarantee(t, guarantee._id)).capacity).toEqual(guarantee.capacity);
    expect(await auditActions(t)).toHaveLength(0);
  });

  test("a drifted capacity is refused rather than repaired", async () => {
    const guarantee = await seedActive("C5");
    await t.run((ctx) =>
      ctx.db.patch(guarantee._id, {
        capacity: { ceilingCents: CEILING_CENTS, availableCents: 10, reservedCents: 10 },
      }),
    );
    const drifted = await readGuarantee(t, guarantee._id);

    const result = await t.run((ctx) =>
      reserveCoverCapacity(ctx, { guarantee: drifted, amountCents: 5, actor }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CAPACITY_INVARIANT_BROKEN");
    expect((await readGuarantee(t, guarantee._id)).capacity).toEqual(drifted.capacity);
  });

  test("releasing the applied figure is the exact inverse of reserving it", async () => {
    const guarantee = await seedActive("C6");
    const before = guarantee.capacity;

    const reserved = await t.run((ctx) =>
      reserveCoverCapacity(ctx, { guarantee, amountCents: 812_345, actor }),
    );
    expect(reserved.success).toBe(true);
    if (!reserved.success) return;

    const drawn = await readGuarantee(t, guarantee._id);
    const released = await t.run((ctx) =>
      releaseCoverCapacity(ctx, {
        guarantee: drawn,
        appliedCents: reserved.data.appliedCents,
        actor,
      }),
    );

    expect(released.success).toBe(true);
    if (!released.success) return;
    expect(released.data.capacity).toEqual(before);
    expect((await readGuarantee(t, guarantee._id)).capacity).toEqual(before);
    expect(await auditActions(t)).toEqual([
      AUDIT_ACTION.GUARANTEE_CAPACITY_RESERVED,
      AUDIT_ACTION.GUARANTEE_CAPACITY_RELEASED,
    ]);
  });

  test("releasing a clamped notice's FACE amount is refused; its applied amount is not", async () => {
    const guarantee = await seedActive("C7", 1_000_000);
    const faceAmountCents = 4_000_000;

    const reserved = await t.run((ctx) =>
      reserveCoverCapacity(ctx, { guarantee, amountCents: faceAmountCents, actor }),
    );
    expect(reserved.success).toBe(true);
    if (!reserved.success) return;
    expect(reserved.data.appliedCents).toBe(1_000_000);

    const drawn = await readGuarantee(t, guarantee._id);
    const overRelease = await t.run((ctx) =>
      releaseCoverCapacity(ctx, { guarantee: drawn, appliedCents: faceAmountCents, actor }),
    );

    expect(overRelease.success).toBe(false);
    if (overRelease.success) return;
    expect(overRelease.error.code).toBe("RELEASE_EXCEEDS_RESERVED");
    expect((await readGuarantee(t, guarantee._id)).capacity).toEqual(drawn.capacity);

    const exact = await t.run((ctx) =>
      releaseCoverCapacity(ctx, {
        guarantee: drawn,
        appliedCents: reserved.data.appliedCents,
        actor,
      }),
    );
    expect(exact.success).toBe(true);
    expect((await readGuarantee(t, guarantee._id)).capacity).toEqual(guarantee.capacity);
  });

  test("a negative release amount is refused before any write", async () => {
    const guarantee = await seedActive("C8", 1_000_000);

    const result = await t.run((ctx) =>
      releaseCoverCapacity(ctx, { guarantee, appliedCents: -5, actor }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_AMOUNT");
    expect((await readGuarantee(t, guarantee._id)).capacity).toEqual(guarantee.capacity);
  });
});
