import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import { RESERVE_SOURCE_KIND } from "@convex/reserve/health";
import type { ReserveHealthReading } from "@convex/transparency/domain";
import {
  COVERAGE_STATE,
  coverageState,
  formatHoldingAmount,
  holdingLabel,
  isInterimReserve,
  reserveAccountView,
  reserveSectionView,
  shortenAddress,
} from "./reserve-view-model";

const VAULT = "925hnJ7MrnAHqkvhRNBB3zYLsSACWQhHeDUB3Q4V9zvC";
const EXPLORER_URL = `https://explorer.solana.com/address/${VAULT}`;
const SQUADS_ACCOUNT = {
  kind: "squads_multisig",
  address: VAULT,
  explorerUrl: EXPLORER_URL,
} as const;
const SQUADS_ACCOUNT_VIEW = {
  kind: "squads_multisig",
  address: VAULT,
  shortAddress: "925h…9zvC",
  explorerUrl: EXPLORER_URL,
  interim: true,
};

const AVAILABLE: ReserveHealthReading = {
  available: true,
  capturedAt: 1_700_000_000_000,
  source: { kind: "squads_multisig", vaultAddress: VAULT, slot: 1 },
  account: SQUADS_ACCOUNT,
  holdings: [],
  prices: { usdBrl: null, solUsd: null },
  usdStablesUncounted: false,
  balanceCents: 3_000_000,
  insuredCoverCents: 4_000_000,
  requiredCoverageRatioBps: 2_500,
  activeOfferHoldsCents: 0,
  requiredCoverageCents: 1_000_000,
  achievedCoverageRatio: 3,
  freeCapitalCents: 2_000_000,
  meetsRequiredCoverage: true,
};

describe("coverageState", () => {
  it.each([
    [{ achievedCoverageRatio: null, meetsRequiredCoverage: true }, COVERAGE_STATE.NO_REQUIREMENT],
    [{ achievedCoverageRatio: 3, meetsRequiredCoverage: true }, COVERAGE_STATE.OK],
    [{ achievedCoverageRatio: 1.2, meetsRequiredCoverage: true }, COVERAGE_STATE.OK],
    [{ achievedCoverageRatio: 1.1, meetsRequiredCoverage: true }, COVERAGE_STATE.ATTENTION],
    [{ achievedCoverageRatio: 1, meetsRequiredCoverage: true }, COVERAGE_STATE.ATTENTION],
    [{ achievedCoverageRatio: 0.5, meetsRequiredCoverage: false }, COVERAGE_STATE.BELOW_TARGET],
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

  it("falls back to the configured account when there is no snapshot", () => {
    expect(reserveSectionView({ available: false, account: SQUADS_ACCOUNT })).toEqual({
      status: "unavailable",
      account: SQUADS_ACCOUNT_VIEW,
    });
  });

  it("shows no account when none is configured", () => {
    expect(reserveSectionView({ available: false, account: null })).toEqual({
      status: "unavailable",
      account: null,
    });
  });

  it("tags an available reading with its coverage state and the account it was read from", () => {
    expect(reserveSectionView(AVAILABLE)).toMatchObject({
      status: "available",
      account: SQUADS_ACCOUNT_VIEW,
      coverageState: COVERAGE_STATE.OK,
    });
  });
});

describe("shortenAddress", () => {
  it("keeps the first and last four characters", () => {
    expect(shortenAddress(VAULT)).toBe("925h…9zvC");
  });

  it("leaves a short value whole", () => {
    expect(shortenAddress("abcdefgh")).toBe("abcdefgh");
  });
});

describe("reserve account kind", () => {
  it.each([
    ["squads_multisig", true],
    ["mutav_vault", false],
  ] as const)("%s → interim %s", (kind, interim) => {
    expect(isInterimReserve(kind)).toBe(interim);
  });

  it("adds the interim note for the Squads multisig", () => {
    expect(reserveAccountView(SQUADS_ACCOUNT)).toEqual(SQUADS_ACCOUNT_VIEW);
  });

  it("drops the interim note once the reserve is the MUTAV vault", () => {
    expect(
      reserveAccountView({ kind: "mutav_vault", address: VAULT, explorerUrl: EXPLORER_URL }),
    ).toEqual({ ...SQUADS_ACCOUNT_VIEW, kind: "mutav_vault", interim: false });
  });
});

describe("reserve account messages", () => {
  it.each([
    ["pt-BR", ptBR],
    ["en", en],
  ] as const)("%s labels every account kind", (_locale, messages) => {
    const labels = messages.transparency.reserveHealth.account.kind;
    expect(Object.keys(labels).sort()).toEqual(Object.values(RESERVE_SOURCE_KIND).sort());
  });
});
