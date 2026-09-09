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
 * The event panel is a supporting read, so its bars sit below the area in
 * weight: same hues, one wash lighter. Full-strength bars against a
 * full-strength area make two charts compete for the same glance.
 */
export const EVENT_BAR_FILL_OPACITY = 0.6;

/**
 * Width of the surface-coloured separator drawn between touching bands. It is
 * a gap, not a border: the stroke is painted in the card's own surface colour,
 * so what the reader sees is the card showing through.
 */
export const STACK_SURFACE_GAP_PX = 2;
