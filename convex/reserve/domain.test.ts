import { describe, expect, test } from "vitest";
import {
  assetRateBrl,
  assetValueCents,
  rawBalanceToCents,
  storedValueCentsFromValuedAssets,
  valueAssets,
  type ReserveAsset,
  type ReservePricing,
} from "./domain";

describe("rawBalanceToCents", () => {
  test("scales a 7-decimal balance to cents", () => {
    // 12345000000 / 10^7 = 1234.5 units -> 123450 cents
    expect(rawBalanceToCents("12345000000", 7)).toBe(123450);
  });

  test("rounds half up", () => {
    // 1 / 10^2 = 0.01 units = exactly 1 cent, no rounding
    expect(rawBalanceToCents("1", 2)).toBe(1);
    // 4 / 10^3 = 0.004 units = 0.4 cents -> rounds down to 0
    expect(rawBalanceToCents("4", 3)).toBe(0);
    // 5 / 10^3 = 0.005 units -> 0.5 cents -> rounds to 1
    expect(rawBalanceToCents("5", 3)).toBe(1);
  });

  test("handles zero and large i128 values without float drift", () => {
    expect(rawBalanceToCents("0", 7)).toBe(0);
    expect(rawBalanceToCents("100000000000000", 7)).toBe(1000000000); // 10,000,000.00
  });
});

describe("assetValueCents", () => {
  test("at rate 1 matches the BRL-1:1 primitive", () => {
    expect(assetValueCents("12345000000", 7, 1)).toBe(rawBalanceToCents("12345000000", 7));
    expect(assetValueCents("12345000000", 7, 1)).toBe(123450);
  });

  test("converts a USD balance at a non-trivial rate", () => {
    // 9925000 / 10^7 = 0.9925 USD * 5.5 BRL/USD = 5.45875 BRL -> 545.875 cents -> 546
    expect(assetValueCents("9925000", 7, 5.5)).toBe(546);
    // 100 USDC (7 decimals) = 1000000000 raw, * 5.5 = 550 BRL -> 55000 cents
    expect(assetValueCents("1000000000", 7, 5.5)).toBe(55000);
  });

  test("handles zero", () => {
    expect(assetValueCents("0", 7, 5.5)).toBe(0);
  });
});

describe("assetRateBrl", () => {
  const pricing: ReservePricing = {
    brlSymbols: ["BRLT", "BRL"],
    usdSymbols: ["USDC", "USDCMOCK"],
    usdBrlRate: 5.5,
  };

  test("returns 1 for a BRL-pegged symbol", () => {
    expect(assetRateBrl("BRLT", pricing)).toBe(1);
  });

  test("returns the USD→BRL rate for a USD-pegged symbol", () => {
    expect(assetRateBrl("USDCMOCK", pricing)).toBe(5.5);
  });

  test("returns null for an unpriced symbol", () => {
    expect(assetRateBrl("XLM", pricing)).toBeNull();
  });
});

describe("valueAssets + storedValueCentsFromValuedAssets", () => {
  const assets: ReserveAsset[] = [
    { contractAddress: "C1", symbol: "BRLT", decimals: 7, rawBalance: "12345000000" }, // 1234.50 BRL
    { contractAddress: "C2", symbol: "USDCMOCK", decimals: 7, rawBalance: "1000000000" }, // 100 USDC -> 550 BRL
    { contractAddress: "C3", symbol: "XLM", decimals: 7, rawBalance: "50000000" }, // unpriced -> 0
  ];
  const pricing: ReservePricing = {
    brlSymbols: ["BRLT", "BRL"],
    usdSymbols: ["USDC", "USDCMOCK"],
    usdBrlRate: 5.5,
  };

  test("values each asset by its symbol's rate, unpriced -> 0", () => {
    const valued = valueAssets(assets, pricing);
    expect(valued.map((a) => a.valueCents)).toEqual([123450, 55000, 0]);
  });

  test("sums the per-asset BRL cents", () => {
    const valued = valueAssets(assets, pricing);
    expect(storedValueCentsFromValuedAssets(valued)).toBe(123450 + 55000 + 0);
  });
});
