import type { ReserveHealthReading } from "@convex/transparency/domain";
import type { ValuedReserveHolding } from "@convex/reserve/valuation";

/**
 * Pure view logic for the reserve section of `/transparency`: the coverage
 * state the index is tagged with, and how each holding is labelled and sized.
 * Copy built on these says the book is "gated by required coverage", never
 * "solvency".
 */

/**
 * Below this multiple of the required coverage the index is tagged
 * "attention": still covered, but one or two new guarantees from the line.
 */
export const COVERAGE_ATTENTION_MULTIPLE = 1.2;

export const COVERAGE_STATE = {
  /** Nothing in force, so nothing is required. */
  NO_REQUIREMENT: "noRequirement",
  OK: "ok",
  ATTENTION: "attention",
  BELOW_TARGET: "belowTarget",
} as const satisfies Record<string, string>;

export type CoverageState = (typeof COVERAGE_STATE)[keyof typeof COVERAGE_STATE];

export function coverageState({
  coverageRatio,
  meetsRequiredCoverage,
}: {
  coverageRatio: number | null;
  meetsRequiredCoverage: boolean;
}): CoverageState {
  if (coverageRatio === null) return COVERAGE_STATE.NO_REQUIREMENT;
  if (!meetsRequiredCoverage) return COVERAGE_STATE.BELOW_TARGET;
  if (coverageRatio < COVERAGE_ATTENTION_MULTIPLE) return COVERAGE_STATE.ATTENTION;
  return COVERAGE_STATE.OK;
}

const SHORT_MINT_EDGE = 4;

/** The registry symbol, or a shortened mint for an asset the registry does not know. */
export function holdingLabel(holding: Pick<ValuedReserveHolding, "symbol" | "mint">): string {
  if (holding.symbol) return holding.symbol;
  const { mint } = holding;
  if (mint.length <= SHORT_MINT_EDGE * 2) return mint;
  return `${mint.slice(0, SHORT_MINT_EDGE)}…${mint.slice(-SHORT_MINT_EDGE)}`;
}

const SOL_DISPLAY_DECIMALS = 4;
const TOKEN_DISPLAY_DECIMALS = 2;

/** Base units → a locale-formatted amount. SOL keeps 4 decimals so the rent balance is not "0,00". */
export function formatHoldingAmount(
  holding: Pick<ValuedReserveHolding, "amountBaseUnits" | "decimals" | "kind">,
  locale: string,
): string {
  const units = Number(holding.amountBaseUnits) / 10 ** holding.decimals;
  const digits = Math.min(
    holding.decimals,
    holding.kind === "sol" ? SOL_DISPLAY_DECIMALS : TOKEN_DISPLAY_DECIMALS,
  );
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(units);
}

export type ReserveSectionView =
  | { status: "loading" }
  | { status: "unavailable"; vaultExplorerUrl: string | null }
  | {
      status: "available";
      reading: Extract<ReserveHealthReading, { available: true }>;
      coverageState: CoverageState;
    };

/** `null`/`undefined` while the query loads; the reading otherwise. */
export function reserveSectionView(
  reading: ReserveHealthReading | null | undefined,
): ReserveSectionView {
  if (reading === null || reading === undefined) return { status: "loading" };
  if (!reading.available) {
    return { status: "unavailable", vaultExplorerUrl: reading.vaultExplorerUrl };
  }
  return { status: "available", reading, coverageState: coverageState(reading) };
}
