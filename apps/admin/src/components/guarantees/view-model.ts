import type { GuaranteeState, SignedContractStatus } from "@convex/guarantees/domain";
import type { ActivationBlocker, ReviewStatus } from "@convex/guarantees/review";
import type { Tone } from "@mutav/ui/guarantee-state-tag";

/**
 * Pure decisions behind the staff guarantee screens: which tab a queue shows,
 * where the activation stepper stands, which message an activation outcome
 * earns. The hooks own state and toasts; the tests live here.
 */

export const ACTIVATION_TAB = {
  SIGNED: "signed",
  AWAITING_SIGNATURE: "awaiting_signature",
} as const satisfies Record<string, ReviewStatus>;

export type ActivationTab = (typeof ACTIVATION_TAB)[keyof typeof ACTIVATION_TAB];

export const ACTIVATION_TABS: readonly ActivationTab[] = [
  ACTIVATION_TAB.SIGNED,
  ACTIVATION_TAB.AWAITING_SIGNATURE,
];

export function isActivationTab(value: string): value is ActivationTab {
  return ACTIVATION_TABS.some((tab) => tab === value);
}

/**
 * The road to activation, as the staff detail page draws it. `active` is the
 * lifecycle state the last step puts the guarantee in, not a review status.
 */
export const ACTIVATION_STEPS = [
  "editing",
  "analysis_requested",
  "accepted",
  "awaiting_signature",
  "signed",
  "active",
] as const;

export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

/**
 * 1-based position for `StepIndicator`. A guarantee past `drafted` has been
 * activated (a refused draft closes without ever being on risk), so it stands
 * on the last step; a refused draft stands where the refusal happened.
 */
export function activationStepPosition({
  status,
  review,
}: {
  status: GuaranteeState;
  review: ReviewStatus;
}): number {
  if (review === "refused") return ACTIVATION_STEPS.indexOf("analysis_requested") + 1;
  if (status !== "drafted") return ACTIVATION_STEPS.length;
  return ACTIVATION_STEPS.indexOf(review) + 1;
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
  refused: "error",
};

/** Every precondition the console can name next to a disabled Activate button. */
export const ACTIVATION_BLOCKERS: readonly ActivationBlocker[] = [
  "NOT_DRAFTED",
  "REVIEW_NOT_SIGNED",
  "SIGNED_CONTRACT_NOT_APPROVED",
  "AGENCY_NOT_ACTIVE",
];

/**
 * Every code `staffActivate` can return, each with a message under
 * `staffGuarantees.errors`. Anything else falls back to `errors.unexpected`
 * rather than the server's English sentence.
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

export function errorMessageKey(code: string): string {
  return TRANSLATED_CODES.has(code) ? `errors.${code}` : UNEXPECTED_MESSAGE_KEY;
}

export type ActivationResult = { success: true } | { success: false; error: { code: string } };

export type ActivationOutcome = { kind: "success" | "error"; messageKey: string };

export function outcomeForActivation(result: ActivationResult): ActivationOutcome {
  if (!result.success) return { kind: "error", messageKey: errorMessageKey(result.error.code) };
  return { kind: "success", messageKey: ACTIVATED_MESSAGE_KEY };
}

/** The role gate throws in the wrapper instead of returning a Result. */
const FORBIDDEN_MESSAGE_PATTERN = /Requires '\w+' role or higher|Not a Mutav staff member/;

export function outcomeForThrownActivation(error: unknown): ActivationOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "error",
    messageKey: FORBIDDEN_MESSAGE_PATTERN.test(message)
      ? FORBIDDEN_MESSAGE_KEY
      : UNEXPECTED_MESSAGE_KEY,
  };
}
