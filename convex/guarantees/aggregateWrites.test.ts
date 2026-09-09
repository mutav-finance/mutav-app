// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { AgencyId } from "../agencies/domain";
import {
  ativoInsuredCentsPlatform,
  contractsByStatus,
  contractsByStatusPlatform,
  sumInsuredExposure,
} from "./aggregate";
import {
  deleteGuaranteeAggregates,
  insertGuaranteeAggregates,
  replaceGuaranteeAggregates,
} from "./aggregateWrites";
import { registerContractAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import { GUARANTEE_STATE, type GuaranteeState } from "./domain";
import schema from "../schema";

async function seedAgency(t: ReturnType<typeof convexTest>, cnpj: string): Promise<AgencyId> {
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

function singleKey(state: GuaranteeState) {
  return {
    lower: { key: state, inclusive: true },
    upper: { key: state, inclusive: true },
  };
}

async function activeCountFor(t: ReturnType<typeof convexTest>, agencyId: AgencyId) {
  return t.run((ctx) =>
    contractsByStatus.count(ctx, {
      namespace: agencyId,
      bounds: singleKey(GUARANTEE_STATE.ACTIVE),
    }),
  );
}

async function platformActiveCount(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    contractsByStatusPlatform.count(ctx, { bounds: singleKey(GUARANTEE_STATE.ACTIVE) }),
  );
}

async function platformActiveSum(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ativoInsuredCentsPlatform.sum(ctx, { bounds: singleKey(GUARANTEE_STATE.ACTIVE) }),
  );
}

// Every seeded guarantee prices at rentCents 100_000 through the default
// product: 30x ceiling = 3_000_000, 6x exit cap = 600_000.
const EXIT_CAP = 600_000;

describe("insertGuaranteeAggregates", () => {
  test("keeps per-agency, platform, and sum-insured aggregates in lockstep", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agencyA = await seedAgency(t, "00000000000111");
    const agencyB = await seedAgency(t, "00000000000222");

    const docs = [
      { agencyId: agencyA, status: GUARANTEE_STATE.ACTIVE, availableCents: 10_000 },
      { agencyId: agencyA, status: GUARANTEE_STATE.DRAFTED, availableCents: 20_000 },
      { agencyId: agencyB, status: GUARANTEE_STATE.ACTIVE, availableCents: 30_000 },
    ] as const;

    for (let i = 0; i < docs.length; i++) {
      const { guaranteeId } = await seedGuaranteeWithLease(
        t,
        { ...docs[i], indexInAggregates: false },
        `CTR-INS${i}`,
      );
      await t.run(async (ctx) => {
        const doc = await ctx.db.get(guaranteeId);
        if (!doc) throw new Error("seed lost");
        await insertGuaranteeAggregates(ctx, doc);
      });
    }

    const activeA = await activeCountFor(t, agencyA);
    const activeB = await activeCountFor(t, agencyB);
    const activePlatform = await platformActiveCount(t);
    expect(activeA + activeB).toBe(activePlatform);
    expect(activePlatform).toBe(2);

    // Exposure per active = availableCents + exit cap. Two active:
    // (10_000 + 30_000) + 2 x 600_000. The draft is excluded.
    expect(await platformActiveSum(t)).toBe(40_000 + 2 * EXIT_CAP);
    expect(await t.run((ctx) => sumInsuredExposure(ctx))).toBe(40_000 + 2 * EXIT_CAP);
  });
});

describe("replaceGuaranteeAggregates", () => {
  test("flips counts and sum when drafted becomes active", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000000333");
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId: agency, status: GUARANTEE_STATE.DRAFTED, availableCents: 50_000 },
      "CTR-REP1",
    );

    expect(await platformActiveSum(t)).toBe(0);
    expect(await platformActiveCount(t)).toBe(0);

    await t.run(async (ctx) => {
      const before = await ctx.db.get(guaranteeId);
      if (!before) throw new Error("missing before");
      await ctx.db.patch(guaranteeId, { status: GUARANTEE_STATE.ACTIVE });
      const after = await ctx.db.get(guaranteeId);
      if (!after) throw new Error("missing after");
      await replaceGuaranteeAggregates(ctx, before, after);
    });

    expect(await platformActiveCount(t)).toBe(1);
    expect(await activeCountFor(t, agency)).toBe(1);
    expect(await platformActiveSum(t)).toBe(50_000 + EXIT_CAP);
  });

  test("sumInsuredExposure follows a guarantee across the non-contiguous insured states", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000000334");
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId: agency, status: GUARANTEE_STATE.ACTIVE, availableCents: 50_000 },
      "CTR-REP2",
    );
    expect(await t.run((ctx) => sumInsuredExposure(ctx))).toBe(50_000 + EXIT_CAP);

    await t.run(async (ctx) => {
      const before = await ctx.db.get(guaranteeId);
      if (!before) throw new Error("missing before");
      await ctx.db.patch(guaranteeId, { status: GUARANTEE_STATE.IN_ARREARS });
      const after = await ctx.db.get(guaranteeId);
      if (!after) throw new Error("missing after");
      await replaceGuaranteeAggregates(ctx, before, after);
    });
    expect(await platformActiveSum(t)).toBe(0);
    expect(await t.run((ctx) => sumInsuredExposure(ctx))).toBe(50_000 + EXIT_CAP);

    await t.run(async (ctx) => {
      const before = await ctx.db.get(guaranteeId);
      if (!before) throw new Error("missing before");
      await ctx.db.patch(guaranteeId, {
        status: GUARANTEE_STATE.CLOSED,
        closure: { reason: "end_of_lease", closedAt: "2026-06-01T00:00:00.000Z" },
      });
      const after = await ctx.db.get(guaranteeId);
      if (!after) throw new Error("missing after");
      await replaceGuaranteeAggregates(ctx, before, after);
    });
    expect(await t.run((ctx) => sumInsuredExposure(ctx))).toBe(0);
  });
});

describe("deleteGuaranteeAggregates", () => {
  test("removes the guarantee from every aggregate", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000000444");
    const { guaranteeId } = await seedGuaranteeWithLease(
      t,
      { agencyId: agency, status: GUARANTEE_STATE.ACTIVE, availableCents: 70_000 },
      "CTR-DEL1",
    );

    expect(await platformActiveCount(t)).toBe(1);
    expect(await platformActiveSum(t)).toBe(70_000 + EXIT_CAP);

    await t.run(async (ctx) => {
      const doc = await ctx.db.get(guaranteeId);
      if (!doc) throw new Error("missing doc");
      await deleteGuaranteeAggregates(ctx, doc);
      await ctx.db.delete(guaranteeId);
    });

    expect(await platformActiveCount(t)).toBe(0);
    expect(await activeCountFor(t, agency)).toBe(0);
    expect(await platformActiveSum(t)).toBe(0);
  });
});
