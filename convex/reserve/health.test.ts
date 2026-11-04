import { describe, expect, test } from "vitest";
import {
  BRS_BASE_UNITS_PER_CENT,
  PILOT_COVERAGE_RATIO_BPS,
  brsBaseUnitsToCents,
  computeReserveHealth,
  phase1FreeCapitalBaseUnits,
  requiredCoverageCents,
} from "./health";

describe("BRS → BRL cents (1 BRS = R$1, 6 decimals)", () => {
  test("one cent is 10_000 base units", () => {
    expect(BRS_BASE_UNITS_PER_CENT).toBe(BigInt(10_000));
  });

  test.each([
    { baseUnits: "0", cents: 0 },
    { baseUnits: "1000000", cents: 100 }, // 1 BRS = R$ 1,00
    { baseUnits: "250000000000", cents: 25_000_000 }, // 250k BRS
    { baseUnits: "10000", cents: 1 },
    { baseUnits: "19999", cents: 1 }, // rounds down — a balance is never overstated
    { baseUnits: "9999", cents: 0 },
  ])("$baseUnits base units → $cents cents", ({ baseUnits, cents }) => {
    expect(brsBaseUnitsToCents(BigInt(baseUnits))).toBe(cents);
  });

  test("stays exact past 2^53 base units", () => {
    // 10^12 BRS = 10^18 base units = 10^14 cents.
    expect(brsBaseUnitsToCents(BigInt("1000000000000000000"))).toBe(100_000_000_000_000);
  });
});

describe("requiredCoverageCents", () => {
  test("pilot c is 0.25", () => {
    expect(PILOT_COVERAGE_RATIO_BPS).toBe(2_500);
  });

  test("is in-force cover × c", () => {
    expect(
      requiredCoverageCents({ insuredCoverCents: 4_000_000, requiredCoverageRatioBps: 2_500 }),
    ).toBe(1_000_000);
  });

  test("rounds up so the requirement is never understated", () => {
    expect(requiredCoverageCents({ insuredCoverCents: 3, requiredCoverageRatioBps: 2_500 })).toBe(
      1,
    );
  });

  test("is zero on an empty book", () => {
    expect(requiredCoverageCents({ insuredCoverCents: 0, requiredCoverageRatioBps: 2_500 })).toBe(
      0,
    );
  });
});

describe("computeReserveHealth", () => {
  test("above target: ratio, free capital and the coverage gate", () => {
    const health = computeReserveHealth({
      balanceCents: 30_000_000, // R$ 300k
      insuredCoverCents: 40_000_000, // R$ 400k in force → R$ 100k required at c = 0.25
      requiredCoverageRatioBps: 2_500,
      activeOfferHoldsCents: 500_000,
    });
    expect(health.requiredCoverageCents).toBe(10_000_000);
    expect(health.achievedCoverageRatio).toBe(3);
    expect(health.freeCapitalCents).toBe(19_500_000);
    expect(health.meetsRequiredCoverage).toBe(true);
  });

  test("zero required: no ratio, the whole balance is free", () => {
    const health = computeReserveHealth({
      balanceCents: 1_000_000,
      insuredCoverCents: 0,
      requiredCoverageRatioBps: 2_500,
      activeOfferHoldsCents: 0,
    });
    expect(health.requiredCoverageCents).toBe(0);
    expect(health.achievedCoverageRatio).toBeNull();
    expect(health.freeCapitalCents).toBe(1_000_000);
    expect(health.meetsRequiredCoverage).toBe(true);
  });

  test("below target: ratio under 1 and negative free capital", () => {
    const health = computeReserveHealth({
      balanceCents: 500_000,
      insuredCoverCents: 4_000_000, // 1_000_000 required
      requiredCoverageRatioBps: 2_500,
      activeOfferHoldsCents: 100_000,
    });
    expect(health.achievedCoverageRatio).toBe(0.5);
    expect(health.freeCapitalCents).toBe(-600_000);
    expect(health.meetsRequiredCoverage).toBe(false);
  });

  test("an empty vault on an empty book meets the (zero) requirement", () => {
    const health = computeReserveHealth({
      balanceCents: 0,
      insuredCoverCents: 0,
      requiredCoverageRatioBps: 2_500,
      activeOfferHoldsCents: 0,
    });
    expect(health.achievedCoverageRatio).toBeNull();
    expect(health.freeCapitalCents).toBe(0);
    expect(health.meetsRequiredCoverage).toBe(true);
  });
});

describe("phase1FreeCapitalBaseUnits", () => {
  test("balance minus in-force cover × c, in base units", () => {
    // 300k BRS balance; R$ 400k in force → 100k BRS required.
    expect(
      phase1FreeCapitalBaseUnits({
        balanceBaseUnits: BigInt("300000000000"),
        insuredCoverCents: 40_000_000,
        requiredCoverageRatioBps: 2_500,
      }),
    ).toBe(BigInt("200000000000"));
  });

  test("goes negative when the book requires more than the vault holds", () => {
    expect(
      phase1FreeCapitalBaseUnits({
        balanceBaseUnits: BigInt(0),
        insuredCoverCents: 400,
        requiredCoverageRatioBps: 2_500,
      }),
    ).toBe(BigInt(-1_000_000));
  });
});
