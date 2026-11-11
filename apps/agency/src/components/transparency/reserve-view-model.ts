import type { ReserveAccount, ReserveHealthReading } from "@convex/transparency/domain";
import { RESERVE_SOURCE_KIND, type ReserveSourceKind } from "@convex/reserve/health";
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
  achievedCoverageRatio,
  meetsRequiredCoverage,
}: {
  achievedCoverageRatio: number | null;
  meetsRequiredCoverage: boolean;
}): CoverageState {
  if (achievedCoverageRatio === null) return COVERAGE_STATE.NO_REQUIREMENT;
  if (!meetsRequiredCoverage) return COVERAGE_STATE.BELOW_TARGET;
  if (achievedCoverageRatio < COVERAGE_ATTENTION_MULTIPLE) return COVERAGE_STATE.ATTENTION;
  return COVERAGE_STATE.OK;
}

const SHORT_ADDRESS_EDGE = 4;

/** `925h…9zvC` — the first and last four characters of a base58 address. */
export function shortenAddress(address: string): string {
  if (address.length <= SHORT_ADDRESS_EDGE * 2) return address;
  return `${address.slice(0, SHORT_ADDRESS_EDGE)}…${address.slice(-SHORT_ADDRESS_EDGE)}`;
}

/** The registry symbol, or a shortened mint for an asset the registry does not know. */
export function holdingLabel(holding: Pick<ValuedReserveHolding, "symbol" | "mint">): string {
  if (holding.symbol) return holding.symbol;
  return shortenAddress(holding.mint);
}

/**
 * Account kinds that hold the reserve only until the audited MUTAV vault goes
 * live (ADR 0012). The page adds the interim note for these.
 */
const INTERIM_RESERVE_KINDS: ReadonlySet<ReserveSourceKind> = new Set([
  RESERVE_SOURCE_KIND.SQUADS_MULTISIG,
]);

export function isInterimReserve(kind: ReserveSourceKind): boolean {
  return INTERIM_RESERVE_KINDS.has(kind);
}

export type ReserveAccountView = {
  /** Picks the type tag: `transparency.reserveHealth.account.kind.<kind>`. */
  kind: ReserveSourceKind;
  address: string;
  shortAddress: string;
  explorerUrl: string;
  interim: boolean;
};

export function reserveAccountView(account: ReserveAccount): ReserveAccountView {
  return {
    kind: account.kind,
    address: account.address,
    shortAddress: shortenAddress(account.address),
    explorerUrl: account.explorerUrl,
    interim: isInterimReserve(account.kind),
  };
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
  | { status: "unavailable"; account: ReserveAccountView | null }
  | {
      status: "available";
      reading: Extract<ReserveHealthReading, { available: true }>;
      account: ReserveAccountView;
      coverageState: CoverageState;
    };

/** `null`/`undefined` while the query loads; the reading otherwise. */
export function reserveSectionView(
  reading: ReserveHealthReading | null | undefined,
): ReserveSectionView {
  if (reading === null || reading === undefined) return { status: "loading" };
  if (!reading.available) {
    return {
      status: "unavailable",
      account: reading.account ? reserveAccountView(reading.account) : null,
    };
  }
  return {
    status: "available",
    reading,
    account: reserveAccountView(reading.account),
    coverageState: coverageState(reading),
  };
}

/** Σ BRL value of every priced holding — the table's total, counted or not. */
export function totalHoldingsValueCents(
  holdings: readonly Pick<ValuedReserveHolding, "valueCents">[],
): number {
  return holdings.reduce((sum, holding) => sum + (holding.valueCents ?? 0), 0);
}

/** A holding's slice of the priced total, 0..1. Null when it is unpriced or nothing is priced. */
export function holdingShare({
  valueCents,
  totalCents,
}: {
  valueCents: number | null;
  totalCents: number;
}): number | null {
  if (valueCents === null || totalCents <= 0) return null;
  return valueCents / totalCents;
}
