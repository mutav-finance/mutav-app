import {
  GUARANTEE_STATE,
  GUARANTEE_STATES,
  type GuaranteeState,
  type StateTimelineBucket,
} from "@convex/guarantees/domain";

/**
 * Bottom-to-top order of the stacked bands.
 *
 * The five in-force states sit at the bottom as one contiguous block ordered
 * by severity — that block IS the exposure, and a reader tracking risk should
 * not have to add up bands separated by context. `drafted` and `closed` ride
 * on top: they belong in the composition (every bucket sums to the size of the
 * book) but Mutav is not on risk for either.
 */
export const GUARANTEE_STATE_STACK_ORDER: readonly GuaranteeState[] = [
  GUARANTEE_STATE.ACTIVE,
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
  GUARANTEE_STATE.IN_EVICTION,
  GUARANTEE_STATE.DRAFTED,
  GUARANTEE_STATE.CLOSED,
];

export type GuaranteeStateCounts = Record<GuaranteeState, number>;

export type GuaranteeStateLegendEntry = {
  state: GuaranteeState;
  count: number;
};

/**
 * One legend row per state, in lifecycle order — the same order and the same
 * labels as the guarantee list tabs. Every state is present even at zero: a
 * state that disappears when it empties reads as "not a thing that can happen"
 * rather than "nothing here right now", and `in_eviction` is legitimately zero
 * for most agencies.
 */
export function buildStateLegend(
  counts: GuaranteeStateCounts | null | undefined,
): GuaranteeStateLegendEntry[] | null {
  if (counts === null || counts === undefined) return null;
  return GUARANTEE_STATES.map((state) => ({ state, count: counts[state] }));
}

/**
 * The range toggle slices client-side: the query always returns the full
 * window (12 months or 52 weeks) and the reader picks how much of its tail to
 * look at.
 */
export function sliceRecentPeriods(
  buckets: readonly StateTimelineBucket[] | null | undefined,
  periods: number,
): StateTimelineBucket[] {
  if (!buckets) return [];
  if (periods >= buckets.length) return [...buckets];
  return buckets.slice(buckets.length - periods);
}

export type GuaranteeStateChartRow = { period: string } & GuaranteeStateCounts;

/**
 * Recharts addresses a series by a top-level key, so the nested `countByState`
 * is flattened one level. Every state is written even at zero — a missing key
 * makes Recharts drop that point from the stack and the bucket stops summing
 * to the size of the book.
 */
export function toChartRows(
  buckets: readonly StateTimelineBucket[],
): readonly GuaranteeStateChartRow[] {
  return buckets.map(({ period, countByState }) => ({
    period,
    drafted: countByState.drafted,
    active: countByState.active,
    in_arrears: countByState.in_arrears,
    default_verified: countByState.default_verified,
    cover_committed: countByState.cover_committed,
    in_eviction: countByState.in_eviction,
    closed: countByState.closed,
  }));
}
