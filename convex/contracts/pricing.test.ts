import { describe, expect, test } from "vitest";
import { priceContract, splitCommission, DEFAULT_PRICING_TABLE } from "./pricing";

describe("priceContract", () => {
  test("bom tier — 9% fee, 30x guarantee", () => {
    expect(
      priceContract({ rentCents: 100_000, condoCents: 0, otherFeesCents: 0, tier: "bom" }),
    ).toEqual({
      feeCents: 9_000,
      oneTimeActivationFeeCents: 15_000,
      availableGuaranteeCents: 3_000_000,
      totalRentCents: 100_000,
    });
  });

  test("regular tier — 12% fee, condo + other fold into totalRent only", () => {
    expect(
      priceContract({
        rentCents: 200_000,
        condoCents: 10_000,
        otherFeesCents: 5_000,
        tier: "regular",
      }),
    ).toEqual({
      feeCents: 24_000,
      oneTimeActivationFeeCents: 15_000,
      availableGuaranteeCents: 6_000_000,
      totalRentCents: 215_000,
    });
  });

  test("ruim tier — 15% fee", () => {
    expect(
      priceContract({
        rentCents: 300_000,
        condoCents: 20_000,
        otherFeesCents: 10_000,
        tier: "ruim",
      }),
    ).toEqual({
      feeCents: 45_000,
      oneTimeActivationFeeCents: 15_000,
      availableGuaranteeCents: 9_000_000,
      totalRentCents: 330_000,
    });
  });

  test("fee is rounded to whole cents", () => {
    // 33_333 * 0.09 = 2999.97 → 3000
    expect(
      priceContract({ rentCents: 33_333, condoCents: 0, otherFeesCents: 0, tier: "bom" }).feeCents,
    ).toBe(3_000);
  });

  test("guarantee scales with the coverage-ceiling multiplier from the table", () => {
    const priced = priceContract(
      { rentCents: 100_000, condoCents: 0, otherFeesCents: 0, tier: "bom" },
      { ...DEFAULT_PRICING_TABLE, coverageCeilingMultiplier: 12 },
    );
    expect(priced.availableGuaranteeCents).toBe(1_200_000);
  });
});

describe("splitCommission", () => {
  test("commission is 1.5% of fee, rounded", () => {
    expect(splitCommission(10_000)).toEqual({ commissionCents: 150, totalCents: 10_150 });
  });

  test("total = fee + commission for every input", () => {
    for (const fee of [0, 1, 33, 67, 167, 1_000, 9_999, 10_000, 999_999, 1_234_567]) {
      const { commissionCents, totalCents } = splitCommission(fee);
      expect(totalCents).toBe(fee + commissionCents);
    }
  });
});
