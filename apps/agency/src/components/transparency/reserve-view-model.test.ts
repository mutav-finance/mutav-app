import { describe, expect, it } from "vitest";
import type { ReserveHealthReading } from "@convex/transparency/domain";
import {
  COVERAGE_STATE,
  coverageState,
  formatHoldingAmount,
  holdingLabel,
  reserveSectionView,
} from "./reserve-view-model";

const VAULT = "925hnJ7MrnAHqkvhRNBB3zYLsSACWQhHeDUB3Q4V9zvC";

const AVAILABLE: ReserveHealthReading = {
  available: true,
  capturedAt: 1_700_000_000_000,
  source: { kind: "squads_multisig", vaultAddress: VAULT, slot: 1 },
  vaultExplorerUrl: `https://explorer.solana.com/address/${VAULT}`,
  holdings: [],
  prices: { usdBrl: null, solUsd: null },
  usdStablesUncounted: false,
  balanceCents: 3_000_000,
  insuredCoverCents: 4_000_000,
  coverageRatioBps: 2_500,
  activeOfferHoldsCents: 0,
  requiredCoverageCents: 1_000_000,
  coverageRatio: 3,
  freeCapitalCents: 2_000_000,
  meetsRequiredCoverage: true,
};

describe("coverageState", () => {
  it.each([
    [{ coverageRatio: null, meetsRequiredCoverage: true }, COVERAGE_STATE.NO_REQUIREMENT],
    [{ coverageRatio: 3, meetsRequiredCoverage: true }, COVERAGE_STATE.OK],
    [{ coverageRatio: 1.2, meetsRequiredCoverage: true }, COVERAGE_STATE.OK],
    [{ coverageRatio: 1.1, meetsRequiredCoverage: true }, COVERAGE_STATE.ATTENTION],
    [{ coverageRatio: 1, meetsRequiredCoverage: true }, COVERAGE_STATE.ATTENTION],
    [{ coverageRatio: 0.5, meetsRequiredCoverage: false }, COVERAGE_STATE.BELOW_TARGET],
  ])("%o → %s", (input, expected) => {
    expect(coverageState(input)).toBe(expected);
  });
});

describe("holdingLabel", () => {
  it("uses the registry symbol", () => {
    expect(holdingLabel({ symbol: "BRS", mint: "BRSx" })).toBe("BRS");
  });

  it("shortens an unknown mint", () => {
    expect(
      holdingLabel({ symbol: null, mint: "Unkn0wnMintxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1" }),
    ).toBe("Unkn…xxx1");
  });
});

describe("formatHoldingAmount", () => {
  it("keeps four decimals for SOL so the rent balance is visible", () => {
    expect(
      formatHoldingAmount({ amountBaseUnits: "2039280", decimals: 9, kind: "sol" }, "pt-BR"),
    ).toBe("0,0020");
  });

  it("shows stablecoins with two decimals in the active locale", () => {
    expect(
      formatHoldingAmount(
        { amountBaseUnits: "12345670000", decimals: 6, kind: "brl_stable" },
        "en",
      ),
    ).toBe("12,345.67");
  });

  it("never shows more decimals than the token has", () => {
    expect(
      formatHoldingAmount({ amountBaseUnits: "999", decimals: 0, kind: "unknown" }, "en"),
    ).toBe("999");
  });
});

describe("reserveSectionView", () => {
  it("is loading until the query answers", () => {
    expect(reserveSectionView(undefined)).toEqual({ status: "loading" });
    expect(reserveSectionView(null)).toEqual({ status: "loading" });
  });

  it("is unavailable without a snapshot, keeping the vault link", () => {
    expect(
      reserveSectionView({ available: false, vaultExplorerUrl: "https://explorer.solana.com/x" }),
    ).toEqual({ status: "unavailable", vaultExplorerUrl: "https://explorer.solana.com/x" });
  });

  it("tags an available reading with its coverage state", () => {
    expect(reserveSectionView(AVAILABLE)).toMatchObject({
      status: "available",
      coverageState: COVERAGE_STATE.OK,
    });
  });
});
