import type { StatusTagTone } from "@mutav/ui/status-tag";

/**
 * The measured half of the guarantee-state palette. The tone map and the tag
 * components live in `@mutav/ui/guarantee-state-tag` so `apps/admin` paints a
 * state the same colour; what stays here is the agency-side proof that those
 * tones resolve to colours a colorblind reader can separate, which is read out
 * of THIS app's `globals.css` by `state-tag.test.ts`.
 */
export const COLOR_SCHEMES = ["light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/** The brand token each tone paints with, per `src/app/globals.css`. */
export const STATE_TONE_TOKEN: Record<StatusTagTone, string> = {
  neutral: "--text-3",
  positive: "--success",
  warning: "--warning",
  "warning-strong": "--warning-strong",
  critical: "--error",
};

/**
 * What those tokens resolve to, restated so the palette can be measured
 * without a browser. `state-tag.test.ts` reads `globals.css` and fails if
 * either half drifts, so a token edit that reintroduces a color pair a
 * colorblind reader cannot separate trips there rather than in production.
 */
export const STATE_TONE_HEX: Record<ColorScheme, Record<StatusTagTone, string>> = {
  light: {
    neutral: "#9e9c98",
    positive: "#2e8b5a",
    warning: "#92400e",
    "warning-strong": "#f97316",
    critical: "#b83232",
  },
  dark: {
    neutral: "#555b66",
    positive: "#3dab72",
    warning: "#fbbf24",
    "warning-strong": "#f97316",
    critical: "#c94040",
  },
};

/**
 * Reading order of the tones, mildest first. Two tones only have to be
 * separable when they can sit beside each other in this ramp — the guarantee
 * list sorts by it, and the breakdown card lays the states out along it.
 */
export const STATE_TONE_SEVERITY_ORDER: readonly StatusTagTone[] = [
  "neutral",
  "positive",
  "warning",
  "warning-strong",
  "critical",
];
