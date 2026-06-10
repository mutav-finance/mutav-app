import { describe, expect, test } from "vitest";
import { rawBalanceToCents, storedValueCentsFromAssets, type ReserveAsset } from "./domain";

describe("rawBalanceToCents", () => {
  test("scales a 7-decimal balance to cents", () => {
    // 12345000000 / 10^7 = 1234.5 units -> 123450 cents
    expect(rawBalanceToCents("12345000000", 7)).toBe(123450);
  });

  test("rounds half up", () => {
    // 15 / 10^2 = 0.15 units -> 15 cents; 1 / 10^2 = 0.01 -> 1 cent
    expect(rawBalanceToCents("1", 2)).toBe(1);
    // 5 / 10^3 = 0.005 units -> 0.5 cents -> rounds to 1
    expect(rawBalanceToCents("5", 3)).toBe(1);
  });

  test("handles zero and large i128 values without float drift", () => {
    expect(rawBalanceToCents("0", 7)).toBe(0);
    expect(rawBalanceToCents("100000000000000", 7)).toBe(1000000000); // 10,000,000.00
  });
});

describe("storedValueCentsFromAssets", () => {
  const assets: ReserveAsset[] = [
    { contractAddress: "C1", symbol: "BRLT", decimals: 7, rawBalance: "12345000000" }, // 1234.50
    { contractAddress: "C2", symbol: "USDC", decimals: 7, rawBalance: "50000000" }, // 5.00 USDC (ignored)
    { contractAddress: "C3", symbol: "BRL", decimals: 2, rawBalance: "10000" }, // 100.00
  ];

  test("sums only BRL-pegged symbols", () => {
    expect(storedValueCentsFromAssets(assets, ["BRLT", "BRL"])).toBe(123450 + 10000);
  });

  test("returns 0 when no asset is pegged", () => {
    expect(storedValueCentsFromAssets(assets, ["NONE"])).toBe(0);
  });
});
