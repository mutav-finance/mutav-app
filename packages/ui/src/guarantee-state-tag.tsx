import type { ReactNode } from "react";
import { StatusTag as UiStatusTag, type StatusTagTone } from "./status-tag";

/**
 * The guarantee lifecycle as the UI names it. Declared here rather than
 * imported from the Convex domain because `@mutav/ui` carries no backend
 * dependency; `apps/agency`'s `state-tag.test.ts` walks `GUARANTEE_STATES`
 * from the domain against this record, so a state added on the server and not
 * here fails a gate rather than rendering untoned.
 */
export const GUARANTEE_STATE_NAMES = [
  "drafted",
  "active",
  "in_arrears",
  "default_verified",
  "cover_committed",
  "in_eviction",
  "closed",
] as const;

export type GuaranteeStateName = (typeof GUARANTEE_STATE_NAMES)[number];

/**
 * Semantic tone names, one layer above the five swatches `StatusTag` paints.
 * The extra names carry meaning the swatch does not: `accent` and `muted` both
 * resolve to the neutral gray today but say different things, so the palette
 * can grow a dedicated swatch for one without re-reading every call site.
 */
export type Tone = "accent" | "success" | "error" | "neutral" | "muted" | "expiring" | "caution";

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
 * Severity read of the seven guarantee states. Lives in the shared package
 * because both `apps/agency` and `apps/admin` render the same state: a
 * guarantee that is `in_arrears` amber on the agency dashboard and something
 * else in the staff queue would read as two different facts.
 *
 * `drafted` and `closed` share a tone but not a meaning — one has not started
 * covering, the other has stopped — so they stay distinct here and can diverge
 * when the palette grows a dedicated muted swatch.
 *
 * Sharing the neutral swatch is deliberate and stays: the tag always renders
 * its label, the dot is `aria-hidden`, and no surface distinguishes these two
 * by color alone. A second gray far enough from `--text-3` to clear the ΔE 15
 * normal-vision floor would have to leave the gray ramp entirely and would
 * then read as a severity neither state carries.
 */
export const GUARANTEE_STATE_TONE: Record<GuaranteeStateName, Tone> = {
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
  state: GuaranteeStateName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <StatusTag tone={GUARANTEE_STATE_TONE[state]} pulse={state === "active"} className={className}>
      {children}
    </StatusTag>
  );
}
