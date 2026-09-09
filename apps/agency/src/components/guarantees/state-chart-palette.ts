import type { GuaranteeEvent, GuaranteeState } from "@convex/guarantees/domain";

/**
 * The composition stack is an ORDINAL ramp, not a set of categorical hues:
 * swapping two states would change the meaning, so the reader has to see the
 * order in the colour. One hue, lightness stepping monotonically with
 * severity, defined once in `globals.css` as `--chart-severity-1..5`.
 *
 * Deliberately NOT the tag tones. `--warning` and `--warning-strong` are tuned
 * for a labelled tag, where text carries the meaning; along the severity order
 * their lightness zigzags (0.569 → 0.473 → 0.705 → 0.523), which a stacked
 * area would read backwards.
 */
export const GUARANTEE_SEVERITY_RAMP = [
  "var(--color-chart-severity-1)",
  "var(--color-chart-severity-2)",
  "var(--color-chart-severity-3)",
  "var(--color-chart-severity-4)",
  "var(--color-chart-severity-5)",
] as const;

export const GUARANTEE_STATE_CHART_COLOR: Record<GuaranteeState, string> = {
  drafted: "var(--color-text-3)",
  active: GUARANTEE_SEVERITY_RAMP[0],
  in_arrears: GUARANTEE_SEVERITY_RAMP[1],
  default_verified: GUARANTEE_SEVERITY_RAMP[2],
  cover_committed: GUARANTEE_SEVERITY_RAMP[3],
  in_eviction: GUARANTEE_SEVERITY_RAMP[4],
  closed: "var(--color-text-2)",
};

/**
 * An event bar wears the colour of the band it feeds, so the two panels read
 * as one picture: the bar is the inflow to the state above it. `created` and
 * `closed` move a guarantee into a state the stack does not draw, so they take
 * the neutral context tones — grey has no chroma, which is exactly why it
 * cannot impersonate a severity step.
 */
export const GUARANTEE_EVENT_CHART_COLOR: Record<GuaranteeEvent, string> = {
  created: "var(--color-text-3)",
  activated: GUARANTEE_STATE_CHART_COLOR.active,
  default_verified: GUARANTEE_STATE_CHART_COLOR.default_verified,
  cover_paid: GUARANTEE_STATE_CHART_COLOR.cover_committed,
  closed: "var(--color-text-2)",
};

/**
 * Fill alpha for every plotted mark on this card.
 *
 * NOT shadcn's 0.4. On an ordinal ramp the gradient IS the encoding — the
 * reader is meant to see severity increase upward — and alpha compresses it:
 * composited over the card, 0.4 leaves adjacent bands ~0.032 L apart, half the
 * 0.06 floor, which is no perceptible ramp at all. shadcn's 0.4 is tuned for
 * two- and three-series demos, not a five-band single-hue stack.
 *
 * 0.85 is the lowest step where the COMPOSITED bands still pass the ordinal
 * checks in both modes: adjacent ΔL ≥ 0.067 light / 0.068 dark, and the palest
 * band still clears the surface at 2.03:1. Below it the ramp fails as drawn
 * even though the tokens pass on paper.
 *
 * The full-strength stroke on each band is what separates touching segments,
 * so there is no surface-coloured gap: a boundary drawn in the band's own
 * colour reads as the edge of that series, where a surface gap reads as empty
 * space between two things — and the white 2px stroke it replaced drew even
 * across zero-height bands, scratching a diagonal streak over the field.
 */
export const CHART_FILL_OPACITY = 0.85;
