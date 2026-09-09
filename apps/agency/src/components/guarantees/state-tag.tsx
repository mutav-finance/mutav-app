import type { ReactNode } from "react";
import { StatusTag as UiStatusTag, type StatusTagTone } from "@mutav/ui/status-tag";
import { GUARANTEE_STATE, type GuaranteeState } from "@convex/guarantees/domain";

type Tone = "accent" | "success" | "error" | "neutral" | "muted" | "expiring" | "caution";

const TONE: Record<Tone, StatusTagTone> = {
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
