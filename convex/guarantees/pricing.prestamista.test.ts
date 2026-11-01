import { describe, expect, test, vi } from "vitest";
import { priceGuarantee, splitCommission, DEFAULT_PRICING_TABLE, isPlanOffered } from "./pricing";

// The Plus plan path, kept covered while the flag is off for the pilot.
vi.mock("./flags", () => ({ PRESTAMISTA_ENABLED: true }));

const APPLIED_AT = "2026-07-18T12:00:00.000Z";

function pricePlus(input: { rentCents: number; tier: "bom" | "regular" | "ruim" }) {
  return priceGuarantee(
    { ...input, plan: "plus", productSlug: "mutav-fianca", appliedAt: APPLIED_AT },
    DEFAULT_PRICING_TABLE,
  );
}

describe("priceGuarantee with prestamista enabled", () => {
  test("offers the plus plan", () => {
    expect(isPlanOffered("plus")).toBe(true);
  });

  test("plus plan adds the R$ 12,80 prestamista premium on top of the taxa", () => {
    const priced = pricePlus({ rentCents: 100_000, tier: "bom" });
    expect(priced.terms.plan).toBe("plus");
    expect(priced.terms.taxaFeeCents).toBe(9_000);
    expect(priced.terms.prestamistaFeeCents).toBe(1_280);
    expect(priced.terms.feeCents).toBe(10_280);
  });

  test("commission adds 25% of the premium to 1.5% of the taxa", () => {
    // 9_000 x 1.5% = 135; 1_280 x 25% = 320; fee 10_280 + commission 455 = 10_735.
    expect(splitCommission(pricePlus({ rentCents: 100_000, tier: "bom" }).terms)).toEqual({
      commissionCents: 455,
      totalCents: 10_735,
    });
  });
});
