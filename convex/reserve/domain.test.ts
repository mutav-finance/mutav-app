import { describe, expect, test } from "vitest";
import {
  assetRateBrl,
  assetValueCents,
  deriveSolvencyFigures,
  findCoverageRatioBps,
  parseStrategyAllocations,
  rawBalanceToCents,
  rawToUnits,
  storedValueCentsFromValuedAssets,
  valueAssets,
  type ReserveAsset,
  type ReservePricing,
  type ReserveSolvencySnapshot,
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

// ── mutav-pulse solvency read ─────────────────────────────────────────────────
// Figures mirror the live MUSD testnet reserve at the time of writing:
// 359 485.66 cUSD in the vault, 126 000 cUSD reserved behind the book at c = 1.

const PULSE_SNAPSHOT: ReserveSolvencySnapshot = {
  vaultId: "CVAULT",
  policyId: "CPOLICY",
  registryId: "CREGISTRY",
  assetContractId: "CUSDSAC",
  assetSymbol: "cUSD",
  assetDecimals: 7,
  totalAssetsRaw: "3594856574762",
  stableAssetsRaw: "3594856574762",
  freeCapitalRaw: "2334856574762",
  coverageRequiredRaw: "1260000000000",
  rawCoverageRaw: "1260000000000",
  coverageRatioBps: 10_000,
  positions: [
    { kind: "idle", address: "CVAULT", volatile: false, rawBalance: "2100000000" },
    { kind: "strategy", address: "CSTRAT", volatile: false, rawBalance: "3592756574762" },
  ],
};

describe("rawToUnits", () => {
  test("scales an i128 string by the token decimals", () => {
    expect(rawToUnits("3594856574762", 7)).toBeCloseTo(359485.6574762, 7);
  });

  test("keeps the whole part exact past 2^53 raw", () => {
    expect(rawToUnits("12345678901234567890", 7)).toBeCloseTo(1234567890123.4568, 3);
  });

  test("treats an empty or zero balance as zero", () => {
    expect(rawToUnits("0", 7)).toBe(0);
    expect(rawToUnits("", 7)).toBe(0);
  });

  test("preserves the sign of a negative balance", () => {
    expect(rawToUnits("-15000000", 7)).toBe(-1.5);
  });
});

describe("parseStrategyAllocations", () => {
  test("reads address + volatile from the vault's strategies() native value", () => {
    expect(
      parseStrategyAllocations([
        { address: "CSTRAT", weight_bps: 10000, volatile: false },
        { address: "CVOL", weight_bps: 0, volatile: true },
      ]),
    ).toEqual([
      { address: "CSTRAT", volatile: false },
      { address: "CVOL", volatile: true },
    ]);
  });

  test("an empty book is an empty list, not a failure", () => {
    expect(parseStrategyAllocations([])).toEqual([]);
  });

  test.each([
    ["not an array", { address: "CSTRAT" }],
    ["missing volatile", [{ address: "CSTRAT", weight_bps: 1 }]],
    ["non-string address", [{ address: 7, volatile: false }]],
    ["null entry", [null]],
  ])("rejects a malformed shape (%s)", (_label, raw) => {
    expect(parseStrategyAllocations(raw)).toBeNull();
  });
});

describe("findCoverageRatioBps", () => {
  test("picks the CoverageRatioBps entry out of the policy instance storage", () => {
    expect(
      findCoverageRatioBps([
        { key: ["Admin"], val: "GADMIN" },
        { key: ["CoverageRatioBps"], val: 12_500 },
        { key: ["GraceSecs"], val: BigInt(432000) },
      ]),
    ).toBe(12_500);
  });

  test("returns null when the key is absent", () => {
    expect(findCoverageRatioBps([{ key: ["Admin"], val: "GADMIN" }])).toBeNull();
  });

  test("returns null when the stored value is not a non-negative integer", () => {
    expect(findCoverageRatioBps([{ key: ["CoverageRatioBps"], val: "10000" }])).toBeNull();
    expect(findCoverageRatioBps([{ key: ["CoverageRatioBps"], val: -1 }])).toBeNull();
  });
});

describe("deriveSolvencyFigures", () => {
  test("scales every on-chain aggregate into whole asset units", () => {
    const figures = deriveSolvencyFigures(PULSE_SNAPSHOT);
    expect(figures.totalAssets).toBeCloseTo(359485.6574762, 7);
    expect(figures.stableAssets).toBeCloseTo(359485.6574762, 7);
    expect(figures.coverageRequired).toBe(126000);
    expect(figures.rawCoverage).toBe(126000);
  });

  test("coverage ratio = stable assets / coverage required", () => {
    expect(deriveSolvencyFigures(PULSE_SNAPSHOT).coverageRatio).toBeCloseTo(2.8530607736, 9);
  });

  test("coverage ratio is null when nothing is reserved — a ratio needs a denominator", () => {
    const figures = deriveSolvencyFigures({
      ...PULSE_SNAPSHOT,
      coverageRequiredRaw: "0",
      rawCoverageRaw: "0",
    });
    expect(figures.coverageRatio).toBeNull();
    expect(figures.capacityUtilization).toBe(0);
  });

  test("remaining capacity = free capital, ceiling = stable assets / c", () => {
    const figures = deriveSolvencyFigures({ ...PULSE_SNAPSHOT, coverageRatioBps: 12_500 });
    expect(figures.requiredCoverageRatio).toBe(1.25);
    expect(figures.capacityCeiling).toBeCloseTo(287588.52598096, 7);
    expect(figures.remainingCapacity).toBeCloseTo(233485.6574762, 7);
  });

  test("capacity ceiling is null when c = 0 — the policy then reserves nothing", () => {
    const figures = deriveSolvencyFigures({ ...PULSE_SNAPSHOT, coverageRatioBps: 0 });
    expect(figures.capacityCeiling).toBeNull();
  });

  test("utilization = coverage required / stable assets", () => {
    expect(deriveSolvencyFigures(PULSE_SNAPSHOT).capacityUtilization).toBeCloseTo(0.3505007707, 9);
  });

  test("utilization is null and the ceiling zero on an empty vault", () => {
    const figures = deriveSolvencyFigures({
      ...PULSE_SNAPSHOT,
      totalAssetsRaw: "0",
      stableAssetsRaw: "0",
      freeCapitalRaw: "0",
      positions: [],
    });
    expect(figures.capacityUtilization).toBeNull();
    expect(figures.capacityCeiling).toBe(0);
  });

  test("each position carries its balance and share of total assets", () => {
    const [idle, strategy] = deriveSolvencyFigures(PULSE_SNAPSHOT).positions;
    expect(idle).toMatchObject({ kind: "idle", address: "CVAULT", volatile: false, balance: 210 });
    expect(idle?.share).toBeCloseTo(0.00058416795, 10);
    expect(strategy).toMatchObject({ kind: "strategy", address: "CSTRAT", volatile: false });
    expect(strategy?.balance).toBeCloseTo(359275.6574762, 7);
    expect(strategy?.share).toBeCloseTo(0.99941583205, 10);
  });

  test("position share is null on an empty vault", () => {
    const figures = deriveSolvencyFigures({
      ...PULSE_SNAPSHOT,
      totalAssetsRaw: "0",
      positions: [{ kind: "idle", address: "CVAULT", volatile: false, rawBalance: "0" }],
    });
    expect(figures.positions[0]?.share).toBeNull();
  });
});
