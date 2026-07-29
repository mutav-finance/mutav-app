import { describe, expect, test } from "vitest";
import { priceContract, splitCommission, feeBreakdown, DEFAULT_PRICING_TABLE } from "./pricing";

describe("priceContract", () => {
  test("bom tier, basic plan — 9% taxa, no prestamista, 30x guarantee", () => {
    expect(
      priceContract({
        rentCents: 100_000,
        condoCents: 0,
        otherFeesCents: 0,
        tier: "bom",
        plan: "basic",
      }),
    ).toEqual({
      feeCents: 9_000,
      taxaFeeCents: 9_000,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      availableGuaranteeCents: 3_000_000,
      totalRentCents: 100_000,
    });
  });

  test("regular tier — 12% taxa, condo + other fold into totalRent only", () => {
    expect(
      priceContract({
        rentCents: 200_000,
        condoCents: 10_000,
        otherFeesCents: 5_000,
        tier: "regular",
        plan: "basic",
      }),
    ).toEqual({
      feeCents: 24_000,
      taxaFeeCents: 24_000,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      availableGuaranteeCents: 6_000_000,
      totalRentCents: 215_000,
    });
  });

  test("ruim tier — 15% taxa", () => {
    expect(
      priceContract({
        rentCents: 300_000,
        condoCents: 20_000,
        otherFeesCents: 10_000,
        tier: "ruim",
        plan: "basic",
      }),
    ).toEqual({
      feeCents: 45_000,
      taxaFeeCents: 45_000,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      availableGuaranteeCents: 9_000_000,
      totalRentCents: 330_000,
    });
  });

  test("plus plan adds the R$ 12,80 prestamista premium on top of the taxa", () => {
    const priced = priceContract({
      rentCents: 100_000,
      condoCents: 0,
      otherFeesCents: 0,
      tier: "bom",
      plan: "plus",
    });
    expect(priced.taxaFeeCents).toBe(9_000);
    expect(priced.prestamistaFeeCents).toBe(1_280);
    expect(priced.feeCents).toBe(10_280);
  });

  test("taxa is rounded to whole cents", () => {
    // 33_333 * 0.09 = 2999.97 → 3000
    expect(
      priceContract({
        rentCents: 33_333,
        condoCents: 0,
        otherFeesCents: 0,
        tier: "bom",
        plan: "basic",
      }).taxaFeeCents,
    ).toBe(3_000);
  });

  test("guarantee scales with the coverage-ceiling multiplier from the table", () => {
    const priced = priceContract(
      { rentCents: 100_000, condoCents: 0, otherFeesCents: 0, tier: "bom", plan: "basic" },
      { ...DEFAULT_PRICING_TABLE, coverageCeilingMultiplier: 12 },
    );
    expect(priced.availableGuaranteeCents).toBe(1_200_000);
  });
});

describe("feeBreakdown", () => {
  test("basic — the whole fee is taxa, no prestamista", () => {
    expect(feeBreakdown({ feeCents: 9_000, plan: "basic" })).toEqual({
      taxaFeeCents: 9_000,
      prestamistaFeeCents: 0,
    });
  });

  test("plus — recovers the taxa by subtracting the premium", () => {
    expect(feeBreakdown({ feeCents: 10_280, plan: "plus" })).toEqual({
      taxaFeeCents: 9_000,
      prestamistaFeeCents: 1_280,
    });
  });

  test("plus — clamps the premium to the stored fee so the split never goes negative", () => {
    // Defensive: a fee stored under a lower premium than the current table value.
    const split = feeBreakdown({ feeCents: 800, plan: "plus" });
    expect(split.taxaFeeCents).toBe(0);
    expect(split.prestamistaFeeCents).toBe(800);
    expect(split.taxaFeeCents + split.prestamistaFeeCents).toBe(800);
  });
});

describe("splitCommission", () => {
  test("taxa only — 1.5% of the taxa portion", () => {
    expect(splitCommission({ taxaFeeCents: 10_000, prestamistaFeeCents: 0 })).toEqual({
      commissionCents: 150,
      totalCents: 10_150,
    });
  });

  test("plus — 1.5% of taxa plus 25% of the prestamista premium", () => {
    // 1.5% of 10_000 = 150; 25% of 1_280 = 320; fee = 11_280; total = 11_750.
    expect(splitCommission({ taxaFeeCents: 10_000, prestamistaFeeCents: 1_280 })).toEqual({
      commissionCents: 470,
      totalCents: 11_750,
    });
  });

  test("total = fee + commission for every input", () => {
    const cases: Array<{ taxaFeeCents: number; prestamistaFeeCents: number }> = [
      { taxaFeeCents: 0, prestamistaFeeCents: 0 },
      { taxaFeeCents: 1, prestamistaFeeCents: 0 },
      { taxaFeeCents: 9_999, prestamistaFeeCents: 1_280 },
      { taxaFeeCents: 1_234_567, prestamistaFeeCents: 0 },
    ];
    for (const c of cases) {
      const { commissionCents, totalCents } = splitCommission(c);
      expect(totalCents).toBe(c.taxaFeeCents + c.prestamistaFeeCents + commissionCents);
    }
  });
});
