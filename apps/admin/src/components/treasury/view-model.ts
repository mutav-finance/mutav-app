import type { ReserveCoverage, ReserveSolvency } from "@convex/transparency/domain";

/**
 * Headline health of the pulse reserve for treasury staff. The contracts only
 * enforce `stable_assets ≥ coverage_required` when a cover or redemption moves
 * money; a strategy loss or a depeg can still push the vault under water
 * between moves, and that is the state staff must see first.
 */
export const SOLVENCY_STATUS = {
  SOLVENT: "solvent",
  UNDERCOVERED: "undercovered",
  NO_BOOK: "noBook",
  UNAVAILABLE: "unavailable",
} as const satisfies Record<string, string>;

export type SolvencyStatus = (typeof SOLVENCY_STATUS)[keyof typeof SOLVENCY_STATUS];

/** `null` = the query is still loading. */
export function solvencyStatus(
  coverage: ReserveCoverage | null | undefined,
): SolvencyStatus | null {
  if (coverage === null || coverage === undefined) return null;
  // A snapshot written before the pulse read landed has no solvency figures;
  // its BRL headline alone says nothing about whether the book is backed.
  if (!coverage.available || coverage.solvency === null) return SOLVENCY_STATUS.UNAVAILABLE;
  const { coverageRatio } = coverage.solvency;
  if (coverageRatio === null) return SOLVENCY_STATUS.NO_BOOK;
  return coverageRatio >= 1 ? SOLVENCY_STATUS.SOLVENT : SOLVENCY_STATUS.UNDERCOVERED;
}

/**
 * The snapshot cron runs every 15 minutes and writes nothing on a failed read
 * (see `convex/crons.ts`), so an old `capturedAt` is how a broken RPC, a
 * missing contract id or a PTAX outage shows up here. Three missed ticks is
 * past normal jitter.
 */
export const SNAPSHOT_STALE_AFTER_MS = 45 * 60 * 1000;

export function isSnapshotStale(capturedAt: number, now: number): boolean {
  return now - capturedAt > SNAPSHOT_STALE_AFTER_MS;
}

export type BookCapacity = {
  /** stable assets ÷ c — the largest raw book the vault can back. Null when c = 0. */
  ceiling: number | null;
  /** The registry's raw coverage — the book the vault backs today. */
  used: number;
  /** ceiling − used, floored at 0 (= free_capital ÷ c, up to the policy's ceil rounding). */
  remaining: number | null;
};

/**
 * Ceiling, used and remaining on one scale. The shared capacity panel's
 * headline is `free_capital`, which is collateral (already multiplied by c),
 * while its ceiling is raw book; staff reconciling the two need all three
 * figures in raw-book units so `ceiling − used = remaining` holds on screen.
 */
export function bookCapacity(
  solvency: Pick<ReserveSolvency, "capacityCeiling" | "rawCoverage">,
): BookCapacity {
  const { capacityCeiling: ceiling, rawCoverage: used } = solvency;
  return {
    ceiling,
    used,
    remaining: ceiling === null ? null : Math.max(ceiling - used, 0),
  };
}
