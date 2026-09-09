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

/**
 * Recharts places a category series differently per chart type: an area gets a
 * POINT scale (first sample flush to the left edge, spacing `width/(n-1)`)
 * while bars get a BAND scale (samples at band centres, spacing `width/n`).
 * Two panels drawn that way disagree about where a given month is by half a
 * band — measured at 44px on a 1052px frame over 12 months — which makes the
 * shared time axis a lie.
 *
 * So both panels declare `scale="band"`. These two functions exist to state
 * the difference the fix removes, and to keep a regression guard on it.
 */
export const SHARED_X_AXIS_SCALE = "band";

type PlotFrame = { plotLeft: number; plotWidth: number; periods: number };

export function bandScalePositions({ plotLeft, plotWidth, periods }: PlotFrame): number[] {
  const step = plotWidth / periods;
  return Array.from({ length: periods }, (_, index) => plotLeft + step * index + step / 2);
}

export function pointScalePositions({ plotLeft, plotWidth, periods }: PlotFrame): number[] {
  if (periods === 1) return [plotLeft];
  const step = plotWidth / (periods - 1);
  return Array.from({ length: periods }, (_, index) => plotLeft + step * index);
}

export function maxStackedTotal(rows: readonly GuaranteeCompositionRow[]): number {
  return rows.reduce(
    (peak, row) =>
      Math.max(
        peak,
        GUARANTEE_STATE_STACK_ORDER.reduce((sum, state) => sum + row[state], 0),
      ),
    0,
  );
}

export function maxEventCount(rows: readonly GuaranteeEventRow[]): number {
  return rows.reduce(
    (peak, row) => Math.max(peak, ...GUARANTEE_EVENTS.map((event) => row[event])),
    0,
  );
}

const NICE_STEP_MULTIPLES: readonly number[] = [1, 2, 5, 10];
const TARGET_TICK_COUNT = 8;

/** The smallest 1/2/5-decade step at or above `minimum`, never below 1. */
function niceStep(minimum: number): number {
  if (minimum <= 1) return 1;
  const decade = 10 ** Math.floor(Math.log10(minimum));
  return (
    NICE_STEP_MULTIPLES.map((multiple) => multiple * decade).find(
      (candidate) => candidate >= minimum,
    ) ?? decade * 10
  );
}

/**
 * A y-max a clear tick above the peak, so the top of the data is not the top
 * of the panel. Without headroom the stack fills its frame edge to edge and
 * reads as a solid block rather than a book that rises and falls.
 *
 * The step comes off the usual 1/2/5 decade ladder so the axis lands on
 * numbers a reader recognises, and a peak that lands exactly on a tick is
 * pushed up a whole step — otherwise the headroom is nominal.
 */
export function axisUpperBound(peak: number): number {
  if (peak <= 0) return 1;
  const step = niceStep(peak / TARGET_TICK_COUNT);
  const rounded = Math.ceil(peak / step) * step;
  return rounded - peak < step / 2 ? rounded + step : rounded;
}
