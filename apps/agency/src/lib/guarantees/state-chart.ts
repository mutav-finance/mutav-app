import {
  GUARANTEE_EVENTS,
  GUARANTEE_STATE,
  type GuaranteeEvent,
  type GuaranteeState,
  type StateTimelineBucket,
} from "@convex/guarantees/domain";

/**
 * Bottom-to-top order of the stacked bands: the five states Mutav is on risk
 * for, least severe at the base. `drafted` and `closed` are absent by design —
 * a draft carries no coverage and a closed guarantee has left the carteira, so
 * neither is part of the book under management, and stacking `closed` pinned
 * the total flat because it only ever accumulates. The book has to be able to
 * fall.
 */
export const GUARANTEE_STATE_STACK_ORDER: readonly GuaranteeState[] = [
  GUARANTEE_STATE.ACTIVE,
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
  GUARANTEE_STATE.IN_EVICTION,
];

/** Lifecycle order, for the muted figures shown beside the legend. */
export const GUARANTEE_CONTEXT_STATES: readonly GuaranteeState[] = [
  GUARANTEE_STATE.DRAFTED,
  GUARANTEE_STATE.CLOSED,
];

export type GuaranteeStateCounts = Record<GuaranteeState, number>;

export type GuaranteeStateLegendEntry = {
  state: GuaranteeState;
  count: number;
};

/**
 * One legend row per band, bottom of the stack first, so the legend reads in
 * the same order as the plot. Every band is present even at zero: a state that
 * disappears when it empties reads as "not a thing that can happen" rather
 * than "nothing here right now", and `in_eviction` is legitimately zero for
 * most agencies.
 */
export function buildStateLegend(
  counts: GuaranteeStateCounts | null | undefined,
): GuaranteeStateLegendEntry[] | null {
  if (counts === null || counts === undefined) return null;
  return GUARANTEE_STATE_STACK_ORDER.map((state) => ({ state, count: counts[state] }));
}

/**
 * `drafted` and `closed` are not in the book, but they are the two numbers an
 * agency asks for next — the pipeline ahead of it and the history behind it.
 * They stay on the card as muted figures rather than bands, which is also what
 * retires the two identical greys the seven-band stack shipped with.
 */
export function buildContextFigures(
  counts: GuaranteeStateCounts | null | undefined,
): GuaranteeStateLegendEntry[] | null {
  if (counts === null || counts === undefined) return null;
  return GUARANTEE_CONTEXT_STATES.map((state) => ({ state, count: counts[state] }));
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

export type GuaranteeCompositionRow = { period: string } & Record<GuaranteeState, number>;

export type GuaranteeEventRow = { period: string } & Record<GuaranteeEvent, number>;

/**
 * Recharts addresses a series by a top-level key, so the nested counts are
 * flattened one level. Composition and events get their own row type because
 * `default_verified` is both a state and an event — one flat row could not
 * carry both without renaming a series the reader already knows.
 *
 * Every state is written even at zero, stack states included: a missing key
 * makes Recharts drop that point from the stack and the silhouette collapses
 * for that period.
 */
export function toCompositionRows(
  buckets: readonly StateTimelineBucket[],
): readonly GuaranteeCompositionRow[] {
  return buckets.map(({ period, countByState }) => ({ period, ...countByState }));
}

export function toEventRows(buckets: readonly StateTimelineBucket[]): readonly GuaranteeEventRow[] {
  return buckets.map(({ period, eventCount }) => ({ period, ...eventCount }));
}

/**
 * Whether the event panel has anything to draw. An all-zero panel is an empty
 * plot with axes, which reads as a broken chart rather than a quiet period —
 * the caller shows a line of copy instead.
 */
export function hasAnyEvent(rows: readonly GuaranteeEventRow[]): boolean {
  return rows.some((row) => GUARANTEE_EVENTS.some((event) => row[event] > 0));
}
