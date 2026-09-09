import type { ReactNode } from "react";
import { StatusTag as UiStatusTag, type StatusTagTone } from "@mutav/ui/status-tag";
import { GUARANTEE_STATE, type GuaranteeState } from "@convex/guarantees/domain";

type Tone = "accent" | "success" | "error" | "neutral" | "muted" | "expiring" | "caution";

export const TONE: Record<Tone, StatusTagTone> = {
  accent: "neutral",
  success: "positive",
  error: "critical",
  neutral: "neutral",
  muted: "neutral",
  expiring: "warning",
  caution: "warning-strong",
};

/**
 * Severity read of the seven guarantee states. `drafted` and `closed` share a
 * tone but not a meaning — one has not started covering, the other has stopped
 * — so they stay distinct here and can diverge when the palette grows a
 * dedicated muted swatch.
 *
 * Sharing the neutral swatch is deliberate and stays: the tag always renders
 * its label, the dot is `aria-hidden`, and no surface distinguishes these two
 * by color alone. A second gray far enough from `--text-3` to clear the ΔE 15
 * normal-vision floor would have to leave the gray ramp entirely and would
 * then read as a severity neither state carries.
 */
export const GUARANTEE_STATE_TONE: Record<GuaranteeState, Tone> = {
  drafted: "neutral",
  active: "success",
  in_arrears: "expiring",
  default_verified: "caution",
  cover_committed: "caution",
  in_eviction: "error",
  closed: "muted",
};

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

export function StatusTag({
  tone,
  children,
  pulse = false,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <UiStatusTag tone={TONE[tone]} pulse={pulse} className={className}>
      {children}
    </UiStatusTag>
  );
}

/**
 * The live dot is reserved for `active`: it reads as "covering right now", and
 * a pulsing dot on every state would make the one that matters invisible.
 */
export function GuaranteeStateTag({
  state,
  children,
  className,
}: {
  state: GuaranteeState;
  children: ReactNode;
  className?: string;
}) {
  return (
    <StatusTag
      tone={GUARANTEE_STATE_TONE[state]}
      pulse={state === GUARANTEE_STATE.ACTIVE}
      className={className}
    >
      {children}
    </StatusTag>
  );
}
