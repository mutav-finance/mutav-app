import { describe, expect, test } from "bun:test";
import { applyInvestorFee, INVESTOR_FEE_RATE } from "./investor";

describe("applyInvestorFee", () => {
  test("rate is 0.3%", () => {
    expect(INVESTOR_FEE_RATE).toBe(0.003);
  });

  test("fee + net equals input within float tolerance", () => {
    for (const amount of [100, 1_234.56, 10_000, 999_999.99]) {
      const { feeUsd, netUsd } = applyInvestorFee(amount);
      expect(feeUsd + netUsd).toBeCloseTo(amount, 10);
    }
  });
});
