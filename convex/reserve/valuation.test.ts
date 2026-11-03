import { describe, expect, test } from "vitest";
import { valueReserveHoldings, type ReserveHolding } from "./valuation";

const PTAX = { rate: 5.4321, source: "BCB_PTAX_VENDA", quotedAt: "2026-10-30 13:09:27" };
const JUPITER = { price: 150.123456, source: "JUPITER_PRICE_V3" };

function holding(
  overrides: Partial<ReserveHolding> & Pick<ReserveHolding, "kind">,
): ReserveHolding {
  return {
    mint: "Mint",
    symbol: null,
    tokenProgram: "spl-token",
    decimals: 6,
    amountBaseUnits: BigInt(0),
    ...overrides,
  };
}

describe("valueReserveHoldings", () => {
  test("counts BRS 1:1 and USD stables at PTAX, rounding down", () => {
    const result = valueReserveHoldings(
      [
        holding({ kind: "brl_stable", symbol: "BRS", amountBaseUnits: BigInt(1_234_567) }),
        holding({ kind: "usd_stable", symbol: "USDC", amountBaseUnits: BigInt(1_000_001) }),
      ],
      { usdBrl: PTAX, solUsd: null },
    );
    // 1.234567 BRS + 1.000001 USDC × 5.4321 = 1.234567 + 5.432105 (floored to 6 dp)
    expect(result.countedBaseUnits).toBe(BigInt(1_234_567 + 5_432_105));
    expect(result.holdings.map((h) => [h.valueCents, h.counted])).toEqual([
      [123, true],
      [543, true],
    ]);
    expect(result.usdStablesUncounted).toBe(false);
  });

  test("values SOL through USD and PTAX but never counts it", () => {
    const result = valueReserveHoldings(
      [holding({ kind: "sol", decimals: 9, tokenProgram: "native", amountBaseUnits: BigInt(1e9) })],
      { usdBrl: PTAX, solUsd: JUPITER },
    );
    // 1 SOL × 150.123456 × 5.4321 = R$ 815.4856…
    expect(result.holdings[0]).toMatchObject({ valueCents: 81_548, counted: false });
    expect(result.countedBaseUnits).toBe(BigInt(0));
  });

  test("without PTAX, USD stables are unpriced, uncounted and flagged", () => {
    const result = valueReserveHoldings(
      [holding({ kind: "usd_stable", amountBaseUnits: BigInt(5) })],
      { usdBrl: null, solUsd: JUPITER },
    );
    expect(result.holdings[0]).toMatchObject({ valueCents: null, counted: false });
    expect(result.usdStablesUncounted).toBe(true);
  });

  test("a zero USD balance without PTAX raises no flag", () => {
    const result = valueReserveHoldings([holding({ kind: "usd_stable" })], {
      usdBrl: null,
      solUsd: null,
    });
    expect(result.usdStablesUncounted).toBe(false);
  });

  test("unknown mints carry no value and are not counted", () => {
    const result = valueReserveHoldings(
      [holding({ kind: "unknown", amountBaseUnits: BigInt(10) })],
      { usdBrl: PTAX, solUsd: JUPITER },
    );
    expect(result.holdings[0]).toMatchObject({
      amountBaseUnits: "10",
      valueCents: null,
      counted: false,
    });
  });
});
