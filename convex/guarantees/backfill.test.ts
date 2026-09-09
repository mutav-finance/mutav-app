// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import { ativoInsuredCentsPlatform, contractsByStatusPlatform } from "./aggregate";
import { registerContractAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import { GUARANTEE_STATE } from "./domain";
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

const ACTIVE_BOUNDS = {
  lower: { key: GUARANTEE_STATE.ACTIVE, inclusive: true },
  upper: { key: GUARANTEE_STATE.ACTIVE, inclusive: true },
};

async function platformActiveCount(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => contractsByStatusPlatform.count(ctx, { bounds: ACTIVE_BOUNDS }));
}

async function platformActiveSum(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ativoInsuredCentsPlatform.sum(ctx, { bounds: ACTIVE_BOUNDS }));
}

// rentCents 100_000 through the default product → 6x exit cap.
const EXIT_CAP = 600_000;

describe("backfillPlatformAggregates", () => {
  test("populates platform count and sum aggregates from raw guarantees", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000000999");

    await seedGuaranteeWithLease(
      t,
      {
        agencyId: agency,
        status: GUARANTEE_STATE.ACTIVE,
        availableCents: 10_000,
        indexInAggregates: false,
      },
      "BF1",
    );
    await seedGuaranteeWithLease(
      t,
      {
        agencyId: agency,
        status: GUARANTEE_STATE.ACTIVE,
        availableCents: 25_000,
        indexInAggregates: false,
      },
      "BF2",
    );
    await seedGuaranteeWithLease(
      t,
      {
        agencyId: agency,
        status: GUARANTEE_STATE.DRAFTED,
        availableCents: 99_900,
        indexInAggregates: false,
      },
      "BF3",
    );

    expect(await platformActiveCount(t)).toBe(0);
    expect(await platformActiveSum(t)).toBe(0);

    const first = await t.mutation(internal.guarantees.backfill.backfillPlatformAggregates, {});
    expect(first.processed).toBe(3);
    expect(first.done).toBe(true);

    expect(await platformActiveCount(t)).toBe(2);
    // Two active: (10_000 + 25_000) + 2 x 600_000 exit cap.
    expect(await platformActiveSum(t)).toBe(35_000 + 2 * EXIT_CAP);
  });

  test("idempotent — re-running after first pass is a no-op", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const agency = await seedAgency(t, "00000000001001");
    await seedGuaranteeWithLease(
      t,
      {
        agencyId: agency,
        status: GUARANTEE_STATE.ACTIVE,
        availableCents: 4_200,
        indexInAggregates: false,
      },
      "BF4",
    );

    await t.mutation(internal.guarantees.backfill.backfillPlatformAggregates, {});
    expect(await platformActiveCount(t)).toBe(1);
    expect(await platformActiveSum(t)).toBe(4_200 + EXIT_CAP);

    await t.mutation(internal.guarantees.backfill.backfillPlatformAggregates, {});
    expect(await platformActiveCount(t)).toBe(1);
    expect(await platformActiveSum(t)).toBe(4_200 + EXIT_CAP);
  });
});
