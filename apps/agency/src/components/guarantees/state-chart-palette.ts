import type { GuaranteeEvent, GuaranteeState } from "@convex/guarantees/domain";
import { GUARANTEE_STATE_TONE } from "@mutav/ui/guarantee-state-tag";

type Tone = (typeof GUARANTEE_STATE_TONE)[GuaranteeState];

/**
 * The swatch colour a tone gets, matched to the dot `@mutav/ui`'s status tag
 * paints for the same tone. The count row under the chart and the status tags
 * in the table further down the page therefore show one state in one colour —
 * a state that changed colour between two places on the same screen would
 * read as two different things.
 *
 * Two tones collapse here exactly as they do on the tags: `default_verified`
 * and `cover_committed` share `warning-strong`, `drafted` and `closed` share
 * the neutral. That is the shipped tag palette, and the label beside each
 * swatch is what tells them apart.
 */
const TONE_SWATCH_COLOR: Record<Tone, string> = {
  accent: "var(--color-text-3)",
  success: "var(--color-success)",
  error: "var(--color-error)",
  neutral: "var(--color-text-3)",
  muted: "var(--color-text-3)",
  expiring: "var(--color-warning)",
  caution: "var(--color-warning-strong)",
};

export const GUARANTEE_STATE_SWATCH_COLOR: Record<GuaranteeState, string> = {
  drafted: TONE_SWATCH_COLOR[GUARANTEE_STATE_TONE.drafted],
  active: TONE_SWATCH_COLOR[GUARANTEE_STATE_TONE.active],
  in_arrears: TONE_SWATCH_COLOR[GUARANTEE_STATE_TONE.in_arrears],
  default_verified: TONE_SWATCH_COLOR[GUARANTEE_STATE_TONE.default_verified],
  cover_committed: TONE_SWATCH_COLOR[GUARANTEE_STATE_TONE.cover_committed],
  in_eviction: TONE_SWATCH_COLOR[GUARANTEE_STATE_TONE.in_eviction],
  closed: TONE_SWATCH_COLOR[GUARANTEE_STATE_TONE.closed],
};

/**
 * The book in force is one series in the brand accent — the total is the
 * subject of the panel, and the brand colour is what says "this is the
 * headline number", not a severity reading.
 */
export const IN_FORCE_AREA_COLOR = "var(--color-chart-1)";
export const AREA_FILL_OPACITY = 0.15;
export const AREA_STROKE_WIDTH = 2;

/**
 * Event colour is semantic, not ordinal: green means good, red means cost,
 * grey means no valence. A guarantee opening is the business working; a cover
 * payout is money leaving; a contract ending is neither.
 *
 * `created` and `closed` take the two neutral steps rather than a hue — a
 * draft appearing and a lease ending are both events with no valence, and
 * spending a hue on them would dilute the three that carry one.
 */
export const GUARANTEE_EVENT_CHART_COLOR: Record<GuaranteeEvent, string> = {
  created: "var(--color-text-3)",
  activated: "var(--color-success)",
  default_verified: "var(--color-warning)",
  cover_paid: "var(--color-error)",
  closed: "var(--color-text-2)",
};

/** Rounded data-end, square at the baseline. */
export const EVENT_BAR_RADIUS: [number, number, number, number] = [3, 3, 0, 0];
