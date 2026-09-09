import { describe, expect, test } from "vitest";
import { isValidProductTerms, type ProductTerms } from "./domain";

const VALID: ProductTerms = {
  tierRate: { bom: 0.09, regular: 0.12, ruim: 0.15 },
  coverageCeilingMultiplier: 30,
  exitCostMultiplier: 6,
  activationFeeCents: 15_000,
  commissionRate: 0.015,
  prestamistaPremiumCents: 1_280,
  prestamistaCommissionRate: 0.25,
};

describe("isValidProductTerms", () => {
  test("accepts the default product's constants", () => {
    expect(isValidProductTerms(VALID)).toBe(true);
  });

  test("accepts fractional multipliers and zero rates", () => {
    expect(
      isValidProductTerms({
        ...VALID,
        coverageCeilingMultiplier: 12.5,
        exitCostMultiplier: 0.5,
        commissionRate: 0,
        tierRate: { bom: 0, regular: 0, ruim: 0 },
      }),
    ).toBe(true);
  });

  test.each<[string, Partial<ProductTerms>]>([
    ["fractional activation fee", { activationFeeCents: 150.5 }],
    ["fractional prestamista premium", { prestamistaPremiumCents: 12.8 }],
    ["negative activation fee", { activationFeeCents: -1 }],
    ["zero coverage multiplier", { coverageCeilingMultiplier: 0 }],
    ["negative exit multiplier", { exitCostMultiplier: -6 }],
    ["non-finite multiplier", { coverageCeilingMultiplier: Number.POSITIVE_INFINITY }],
    ["negative commission rate", { commissionRate: -0.01 }],
    ["NaN prestamista commission rate", { prestamistaCommissionRate: Number.NaN }],
    ["negative tier rate", { tierRate: { bom: -0.01, regular: 0.12, ruim: 0.15 } }],
  ])("rejects %s", (_label, override) => {
    expect(isValidProductTerms({ ...VALID, ...override })).toBe(false);
  });
});
