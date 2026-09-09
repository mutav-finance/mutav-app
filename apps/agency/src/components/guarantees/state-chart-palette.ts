import type { GuaranteeState } from "@convex/guarantees/domain";
import { GUARANTEE_STATE_TONE } from "./state-tag";

type Tone = (typeof GUARANTEE_STATE_TONE)[GuaranteeState];

/**
 * The band colour a tone gets in a chart. Derived from the same tone map the
 * status tag reads, so a state never shows one colour in a list and another in
 * a plot — and a re-stepped tone reaches both surfaces in one edit.
 */
const TONE_CHART_COLOR: Record<Tone, string> = {
  accent: "var(--color-text-3)",
  success: "var(--color-success)",
  error: "var(--color-error)",
  neutral: "var(--color-text-3)",
  muted: "var(--color-text-3)",
  expiring: "var(--color-warning)",
  caution: "var(--color-warning-strong)",
};

export const GUARANTEE_STATE_CHART_COLOR: Record<GuaranteeState, string> = {
  drafted: TONE_CHART_COLOR[GUARANTEE_STATE_TONE.drafted],
  active: TONE_CHART_COLOR[GUARANTEE_STATE_TONE.active],
  in_arrears: TONE_CHART_COLOR[GUARANTEE_STATE_TONE.in_arrears],
  default_verified: TONE_CHART_COLOR[GUARANTEE_STATE_TONE.default_verified],
  cover_committed: TONE_CHART_COLOR[GUARANTEE_STATE_TONE.cover_committed],
  in_eviction: TONE_CHART_COLOR[GUARANTEE_STATE_TONE.in_eviction],
  closed: TONE_CHART_COLOR[GUARANTEE_STATE_TONE.closed],
};

/**
 * Which band colours are too close to separate by hue alone, grouped under one
 * name. `--color-warning` and `--color-warning-strong` are two steps of the
 * same amber and sit at three consecutive positions in the stack, so a reader
 * — and every colourblind reader — sees one amber mass unless something else
 * tells the bands apart. `--color-text-3` carries `drafted` and `closed`
 * verbatim. Everything else is its own family.
 *
 * A tag can afford the near-duplicate because its label sits next to the dot;
 * a stacked band carries no adjacent label, so hue alone is not an encoding.
 */
export const CHART_COLOR_FAMILY: Record<GuaranteeState, string> = {
  drafted: "neutral",
  active: "success",
  in_arrears: "amber",
  default_verified: "amber",
  cover_committed: "amber",
  in_eviction: "error",
  closed: "neutral",
};

/**
 * Fill strength is the secondary encoding inside a colour family: every state
 * that shares a family gets its own strength, so a band is resolvable from the
 * legend swatch — painted with the same colour AND the same strength — rather
 * than from hue. Inside the amber family the strength also runs with severity,
 * darkest for the state closest to a payout.
 */
export const GUARANTEE_STATE_FILL_OPACITY: Record<GuaranteeState, number> = {
  drafted: 0.6,
  active: 0.85,
  in_arrears: 0.45,
  default_verified: 0.65,
  cover_committed: 0.85,
  in_eviction: 0.85,
  closed: 0.35,
};
