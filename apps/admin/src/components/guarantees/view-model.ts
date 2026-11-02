import type { GuaranteeState, SignedContractStatus } from "@convex/guarantees/domain";
import type { OfferHoldStatus } from "@convex/reserve/capacity";
import type { ActivationBlocker, ReviewStatus } from "@convex/guarantees/review";
import type { Tone } from "@mutav/ui/guarantee-state-tag";

/**
 * Pure decisions behind the staff guarantee screens: which tab a queue shows,
 * where the activation stepper stands, which message an activation retry
 * earns. The hooks own state and toasts; the tests live here.
 *
 * Nobody clicks Activate. Under the phase-1 rule (issue #427) a guarantee
 * goes active when compliance approves its signed contract and the reserve
 * capacity check passes; one that does not fit waits for reserve capacity and
 * compliance can retry once the reserve has room.
 */

export const ACTIVATION_TAB = {
  AWAITING_CAPACITY: "awaiting_capacity",
  AWAITING_SIGNATURE: "awaiting_signature",
} as const satisfies Record<string, ReviewStatus>;

export type ActivationTab = (typeof ACTIVATION_TAB)[keyof typeof ACTIVATION_TAB];

export const ACTIVATION_TABS: readonly ActivationTab[] = [
  ACTIVATION_TAB.AWAITING_CAPACITY,
  ACTIVATION_TAB.AWAITING_SIGNATURE,
];

export function isActivationTab(value: string): value is ActivationTab {
  return ACTIVATION_TABS.some((tab) => tab === value);
}

/**
 * Every step the staff detail page can draw. `awaiting_capacity` shows only
 * while the guarantee waits for reserve capacity; `active` is the lifecycle
 * state a passed capacity check puts the guarantee in, not a review status.
 */
export const ACTIVATION_STEPS = [
  "editing",
  "analysis_requested",
  "accepted",
  "awaiting_signature",
  "signed",
  "awaiting_capacity",
  "active",
] as const;

export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

type StepInput = { status: GuaranteeState; review: ReviewStatus };

/** The steps drawn for this guarantee: the capacity wait appears only while it applies. */
export function activationSteps({ status, review }: StepInput): readonly ActivationStep[] {
  const waiting = status === "drafted" && review === "awaiting_capacity";
  return ACTIVATION_STEPS.filter((step) => step !== "awaiting_capacity" || waiting);
}

/**
 * 1-based position for `StepIndicator` within `activationSteps`. A guarantee
 * past `drafted` has been activated (a refused draft closes without ever
 * being on risk), so it stands on the last step; a refused draft stands where
 * the refusal happened.
 */
export function activationStepPosition(input: StepInput): number {
  const steps = activationSteps(input);
  if (input.review === "refused") return steps.indexOf("analysis_requested") + 1;
  if (input.status !== "drafted") return steps.length;
  return steps.indexOf(input.review) + 1;
}

export const SIGNED_CONTRACT_TONE: Record<SignedContractStatus, Tone> = {
  approved: "success",
  pending_review: "expiring",
  rejected: "error",
  missing: "muted",
};

export const REVIEW_STATUS_TONE: Record<ReviewStatus, Tone> = {
  editing: "neutral",
  analysis_requested: "expiring",
  accepted: "neutral",
  awaiting_signature: "expiring",
  signed: "success",
  awaiting_capacity: "expiring",
  refused: "error",
};

export const OFFER_HOLD_TONE: Record<OfferHoldStatus, Tone> = {
  none: "muted",
  active: "success",
  lapsed: "error",
  released: "muted",
};

/** Every precondition the admin app can name next to a guarantee it cannot activate. */
export const ACTIVATION_BLOCKERS: readonly ActivationBlocker[] = [
  "NOT_DRAFTED",
  "REVIEW_NOT_SIGNED",
  "SIGNED_CONTRACT_NOT_APPROVED",
  "AGENCY_NOT_ACTIVE",
];

/**
 * Every error code `retryActivation` can return, each with a message under
 * `staffGuarantees.errors`. Anything else falls back to `errors.unexpected`
 * rather than the server's English sentence. Waiting for reserve capacity is
 * not here: it is an outcome, not an error.
 */
export const ACTIVATION_ERROR_CODES = [
  "NOT_FOUND",
  ...ACTIVATION_BLOCKERS,
  "CAPACITY_INVARIANT_BROKEN",
  "SELF_TRANSITION",
  "TERMINAL_STATE",
  "ILLEGAL_TRANSITION",
] as const;

const TRANSLATED_CODES: ReadonlySet<string> = new Set(ACTIVATION_ERROR_CODES);

export const UNEXPECTED_MESSAGE_KEY = "errors.unexpected";
export const FORBIDDEN_MESSAGE_KEY = "errors.FORBIDDEN";
export const ACTIVATED_MESSAGE_KEY = "toast.activated";
export const STILL_WAITING_MESSAGE_KEY = "toast.stillWaiting";
export const RESERVE_UNAVAILABLE_MESSAGE_KEY = "toast.reserveUnavailable";

export function errorMessageKey(code: string): string {
  return TRANSLATED_CODES.has(code) ? `errors.${code}` : UNEXPECTED_MESSAGE_KEY;
}

export type RetryActivationResult =
  | {
      success: true;
      data:
        | { outcome: "activated" }
        | { outcome: "awaiting_capacity"; reason: string; shortfallCents: number | null };
    }
  | { success: false; error: { code: string } };

export type ActivationOutcome =
  | { kind: "activated"; messageKey: string }
  | { kind: "waiting"; messageKey: string; shortfallCents: number | null }
  | { kind: "error"; messageKey: string };

export function outcomeForRetry(result: RetryActivationResult): ActivationOutcome {
  if (!result.success) return { kind: "error", messageKey: errorMessageKey(result.error.code) };
  if (result.data.outcome === "activated") {
    return { kind: "activated", messageKey: ACTIVATED_MESSAGE_KEY };
  }
  if (result.data.shortfallCents === null) {
    return { kind: "waiting", messageKey: RESERVE_UNAVAILABLE_MESSAGE_KEY, shortfallCents: null };
  }
  return {
    kind: "waiting",
    messageKey: STILL_WAITING_MESSAGE_KEY,
    shortfallCents: result.data.shortfallCents,
  };
}

/** The role gate throws in the wrapper instead of returning a Result. */
const FORBIDDEN_MESSAGE_PATTERN = /Requires '\w+' role or higher|Not a Mutav staff member/;

export function outcomeForThrownRetry(error: unknown): ActivationOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "error",
    messageKey: FORBIDDEN_MESSAGE_PATTERN.test(message)
      ? FORBIDDEN_MESSAGE_KEY
      : UNEXPECTED_MESSAGE_KEY,
  };
}
