import {
  GUARANTEE_STATE,
  INSURED_STATES,
  type GuaranteeEvent,
  type GuaranteeState,
  type StateTimelineBucket,
} from "@convex/guarantees/domain";

/**
 * The five states Mutav is on risk for, in severity order. They are what the
 * area counts and the order the count row lists.
 *
 * `drafted` and `closed` are excluded by design — a draft carries no coverage
 * and a closed guarantee has left the carteira, so neither is under
 * management, and counting `closed` pinned the total flat because it only ever
 * accumulates. The book has to be able to fall as well as rise.
 */
export const GUARANTEE_IN_FORCE_STATES: readonly GuaranteeState[] = INSURED_STATES;

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
  return GUARANTEE_IN_FORCE_STATES.map((state) => ({ state, count: counts[state] }));
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

export type GuaranteeInForceRow = { period: string; inForce: number };

/**
 * One series: how many guarantees Mutav was on risk for at the end of each
 * period. Per-state granularity lives in the count row beside the chart, not
 * inside the plot — a five-band stack of one hue turned the trend into a mass
 * and cost the reader the only line they actually track.
 */
export function toInForceRows(
  buckets: readonly StateTimelineBucket[],
): readonly GuaranteeInForceRow[] {
  return buckets.map(({ period, countByState }) => ({
    period,
    inForce: GUARANTEE_IN_FORCE_STATES.reduce((sum, state) => sum + countByState[state], 0),
  }));
}

export type GuaranteeChartRow = GuaranteeInForceRow & Record<GuaranteeEvent, number>;

/**
 * One row feeding one plot: the book in force plus that period's events.
 *
 * They share a row because they share an axis. A separate y scale per unit is
 * the dual-axis failure — at a couple of hundred guarantees in force and two
 * events a month, an independently scaled bar axis would paint one event as
 * tall as a quarter of the whole book. On the book's own scale a small month
 * looks small, which is the truth.
 */
export function toChartRows(buckets: readonly StateTimelineBucket[]): readonly GuaranteeChartRow[] {
  return buckets.map(({ period, countByState, eventCount }) => ({
    period,
    inForce: GUARANTEE_IN_FORCE_STATES.reduce((sum, state) => sum + countByState[state], 0),
    ...eventCount,
  }));
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

export function maxInForce(rows: readonly GuaranteeInForceRow[]): number {
  return rows.reduce((peak, row) => Math.max(peak, row.inForce), 0);
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
