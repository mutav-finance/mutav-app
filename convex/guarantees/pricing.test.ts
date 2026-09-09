import { describe, expect, test } from "vitest";
import { priceGuarantee, splitCommission, DEFAULT_PRICING_TABLE } from "./pricing";

const APPLIED_AT = "2026-07-18T12:00:00.000Z";
const PRODUCT_SLUG = "mutav-fianca";

function price(input: {
  rentCents: number;
  tier: "bom" | "regular" | "ruim";
  plan: "basic" | "plus";
}) {
  return priceGuarantee(
    { ...input, productSlug: PRODUCT_SLUG, appliedAt: APPLIED_AT },
    DEFAULT_PRICING_TABLE,
  );
}

describe("priceGuarantee", () => {
  test("bom tier, basic plan — 9% taxa, no prestamista, 30x ceiling, 6x exit cap", () => {
    expect(price({ rentCents: 100_000, tier: "bom", plan: "basic" })).toEqual({
      terms: {
        productSlug: PRODUCT_SLUG,
        plan: "basic",
        rentCents: 100_000,
        feeCents: 9_000,
        taxaFeeCents: 9_000,
        prestamistaFeeCents: 0,
        oneTimeActivationFeeCents: 15_000,
        commissionRate: 0.015,
        prestamistaCommissionRate: 0.25,
        coverageCeilingMultiplier: 30,
        exitCostMultiplier: 6,
        coverageCeilingCents: 3_000_000,
        exitCostCapCents: 600_000,
        appliedAt: APPLIED_AT,
      },
      capacity: { ceilingCents: 3_000_000, availableCents: 3_000_000, reservedCents: 0 },
    });
  });

  test("regular tier — 12% taxa", () => {
    const priced = price({ rentCents: 200_000, tier: "regular", plan: "basic" });
    expect(priced.terms.feeCents).toBe(24_000);
    expect(priced.terms.taxaFeeCents).toBe(24_000);
    expect(priced.terms.coverageCeilingCents).toBe(6_000_000);
  });

  test("ruim tier — 15% taxa", () => {
    const priced = price({ rentCents: 300_000, tier: "ruim", plan: "basic" });
    expect(priced.terms.feeCents).toBe(45_000);
    expect(priced.terms.coverageCeilingCents).toBe(9_000_000);
    expect(priced.terms.exitCostCapCents).toBe(1_800_000);
  });

  test("plus plan adds the R$ 12,80 prestamista premium on top of the taxa", () => {
    const priced = price({ rentCents: 100_000, tier: "bom", plan: "plus" });
    expect(priced.terms.taxaFeeCents).toBe(9_000);
    expect(priced.terms.prestamistaFeeCents).toBe(1_280);
    expect(priced.terms.feeCents).toBe(10_280);
  });

  test("taxa is rounded to whole cents", () => {
    // 33_333 * 0.09 = 2999.97 → 3000
    expect(price({ rentCents: 33_333, tier: "bom", plan: "basic" }).terms.taxaFeeCents).toBe(3_000);
  });

  test("ceiling and exit cap are rounded to whole cents under a fractional multiplier", () => {
    const priced = priceGuarantee(
      {
        rentCents: 100_001,
        tier: "bom",
        plan: "basic",
        productSlug: "custom",
        appliedAt: APPLIED_AT,
      },
      { ...DEFAULT_PRICING_TABLE, coverageCeilingMultiplier: 12.5, exitCostMultiplier: 2.5 },
    );
    // 100_001 * 12.5 = 1_250_012.5 → 1_250_013; 100_001 * 2.5 = 250_002.5 → 250_003
    expect(priced.terms.coverageCeilingCents).toBe(1_250_013);
    expect(priced.terms.exitCostCapCents).toBe(250_003);
    expect(Number.isInteger(priced.capacity.ceilingCents)).toBe(true);
    expect(Number.isInteger(priced.capacity.availableCents)).toBe(true);
  });

  test("ceiling, exit cap and initial capacity follow the product's multipliers", () => {
    const priced = priceGuarantee(
      {
        rentCents: 100_000,
        tier: "bom",
        plan: "basic",
        productSlug: "custom",
        appliedAt: APPLIED_AT,
      },
      { ...DEFAULT_PRICING_TABLE, coverageCeilingMultiplier: 12, exitCostMultiplier: 3 },
    );
    expect(priced.terms.coverageCeilingCents).toBe(1_200_000);
    expect(priced.terms.exitCostCapCents).toBe(300_000);
    expect(priced.terms.coverageCeilingMultiplier).toBe(12);
    expect(priced.terms.exitCostMultiplier).toBe(3);
    expect(priced.capacity).toEqual({
      ceilingCents: 1_200_000,
      availableCents: 1_200_000,
      reservedCents: 0,
    });
  });

  test("snapshots the product's commission rates so a later product edit cannot move them", () => {
    const priced = priceGuarantee(
      {
        rentCents: 100_000,
        tier: "bom",
        plan: "plus",
        productSlug: "custom",
        appliedAt: APPLIED_AT,
      },
      { ...DEFAULT_PRICING_TABLE, commissionRate: 0.02, prestamistaCommissionRate: 0.3 },
    );
    expect(priced.terms.commissionRate).toBe(0.02);
    expect(priced.terms.prestamistaCommissionRate).toBe(0.3);
    // 9_000 x 2% = 180; 1_280 x 30% = 384
    expect(splitCommission(priced.terms).commissionCents).toBe(564);
  });

  test("capacity invariant holds at pricing time: available + reserved = ceiling", () => {
    const { capacity } = price({ rentCents: 123_456, tier: "regular", plan: "plus" });
    expect(capacity.availableCents + capacity.reservedCents).toBe(capacity.ceilingCents);
  });
});

describe("splitCommission", () => {
  const DEFAULT_RATES = {
    commissionRate: DEFAULT_PRICING_TABLE.commissionRate,
    prestamistaCommissionRate: DEFAULT_PRICING_TABLE.prestamistaCommissionRate,
  };

  test("taxa only — 1.5% of the taxa portion", () => {
    expect(
      splitCommission({ taxaFeeCents: 10_000, prestamistaFeeCents: 0, ...DEFAULT_RATES }),
    ).toEqual({
      commissionCents: 150,
      totalCents: 10_150,
    });
  });

  test("plus — 1.5% of taxa plus 25% of the prestamista premium", () => {
    // 1.5% of 10_000 = 150; 25% of 1_280 = 320; fee = 11_280; total = 11_750.
    expect(
      splitCommission({ taxaFeeCents: 10_000, prestamistaFeeCents: 1_280, ...DEFAULT_RATES }),
    ).toEqual({
      commissionCents: 470,
      totalCents: 11_750,
    });
  });

  test("accepts a stored terms snapshot directly", () => {
    const { terms } = price({ rentCents: 300_000, tier: "bom", plan: "basic" });
    expect(splitCommission(terms).commissionCents).toBe(405);
  });

  test("total = fee + commission for every input", () => {
    const cases: Array<{ taxaFeeCents: number; prestamistaFeeCents: number }> = [
      { taxaFeeCents: 0, prestamistaFeeCents: 0 },
      { taxaFeeCents: 1, prestamistaFeeCents: 0 },
      { taxaFeeCents: 9_999, prestamistaFeeCents: 1_280 },
      { taxaFeeCents: 1_234_567, prestamistaFeeCents: 0 },
    ];
    for (const c of cases) {
      const { commissionCents, totalCents } = splitCommission({ ...c, ...DEFAULT_RATES });
      expect(totalCents).toBe(c.taxaFeeCents + c.prestamistaFeeCents + commissionCents);
    }
  });
});
