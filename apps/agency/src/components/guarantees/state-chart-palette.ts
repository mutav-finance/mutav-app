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
 * Five tones carry seven states, so `drafted`/`closed` and
 * `default_verified`/`cover_committed` land on the same hue. In a tag that is
 * harmless — the label sits next to the dot — but two stacked bands of one
 * colour are unreadable. Fill strength separates the members of a pair, and the
 * legend swatch is painted with the same colour AND the same strength, so a
 * band is always resolvable from the legend rather than from hue alone.
 */
export const GUARANTEE_STATE_FILL_OPACITY: Record<GuaranteeState, number> = {
  drafted: 0.6,
  active: 0.85,
  in_arrears: 0.85,
  default_verified: 0.85,
  cover_committed: 0.45,
  in_eviction: 0.85,
  closed: 0.35,
};
