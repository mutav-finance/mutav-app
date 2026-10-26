import type { GuaranteeState, SignedContractStatus } from "@convex/guarantees/domain";
import type { OfferHoldStatus } from "@convex/reserve/registration";
import type { RegistrationBlocker, ReviewStatus } from "@convex/guarantees/review";
import type { Tone } from "@mutav/ui/guarantee-state-tag";

/**
 * Pure decisions behind the staff guarantee screens: which tab a queue shows,
 * where the activation stepper stands, which message a registration outcome
 * earns. The hooks own state and toasts; the tests live here.
 *
 * Nobody clicks Activate (ADR 0010): a guarantee goes on risk when staff
 * record the operator's `register_guarantee` and Convex verifies it on chain.
 */

export const ACTIVATION_TAB = {
  PENDING_REGISTRATION: "pending_registration",
  AWAITING_SIGNATURE: "awaiting_signature",
} as const satisfies Record<string, ReviewStatus>;

export type ActivationTab = (typeof ACTIVATION_TAB)[keyof typeof ACTIVATION_TAB];

export const ACTIVATION_TABS: readonly ActivationTab[] = [
  ACTIVATION_TAB.PENDING_REGISTRATION,
  ACTIVATION_TAB.AWAITING_SIGNATURE,
];

export function isActivationTab(value: string): value is ActivationTab {
  return ACTIVATION_TABS.some((tab) => tab === value);
}

/**
 * The road to activation, as the staff detail page draws it. `signed` is a
 * moment the review passes through on the way to `pending_registration`;
 * `active` is the lifecycle state the confirmed registration puts the
 * guarantee in, not a review status.
 */
export const ACTIVATION_STEPS = [
  "editing",
  "analysis_requested",
  "accepted",
  "awaiting_signature",
  "signed",
  "pending_registration",
  "active",
] as const;

export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

/**
 * 1-based position for `StepIndicator`. A guarantee past `drafted` has been
 * registered (a refused draft closes without ever being on risk), so it
 * stands on the last step; a refused draft stands where the refusal happened.
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
  pending_registration: "expiring",
  refused: "error",
};

export const OFFER_HOLD_TONE: Record<OfferHoldStatus, Tone> = {
  none: "muted",
  active: "success",
  lapsed: "error",
  released: "muted",
};

/** Every precondition the console can name next to the disabled registration form. */
export const REGISTRATION_BLOCKERS: readonly RegistrationBlocker[] = [
  "NOT_DRAFTED",
  "REVIEW_NOT_PENDING_REGISTRATION",
  "SIGNED_CONTRACT_NOT_APPROVED",
  "AGENCY_NOT_ACTIVE",
];

/**
 * Every code `confirmRegistration` can return, each with a message under
 * `staffGuarantees.errors`. Anything else falls back to `errors.unexpected`
 * rather than the server's English sentence. `REGISTRATION_REFUSED` is not
 * here: the reserve's refusal is a state, shown with the program's error.
 */
export const REGISTRATION_ERROR_CODES = [
  "NOT_FOUND",
  ...REGISTRATION_BLOCKERS,
  "CAPACITY_INVARIANT_BROKEN",
  "SELF_TRANSITION",
  "TERMINAL_STATE",
  "ILLEGAL_TRANSITION",
  "INVALID_TX_SIGNATURE",
  "RESERVE_READER_UNAVAILABLE",
  "TX_NOT_FOUND",
  "NOT_REGISTER_GUARANTEE",
  "ARGS_MISMATCH",
] as const;

const TRANSLATED_CODES: ReadonlySet<string> = new Set(REGISTRATION_ERROR_CODES);

export const UNEXPECTED_MESSAGE_KEY = "errors.unexpected";
export const FORBIDDEN_MESSAGE_KEY = "errors.FORBIDDEN";
export const REGISTERED_MESSAGE_KEY = "toast.registered";
export const REFUSED_MESSAGE_KEY = "toast.registrationRefused";

export function errorMessageKey(code: string): string {
  return TRANSLATED_CODES.has(code) ? `errors.${code}` : UNEXPECTED_MESSAGE_KEY;
}

export type RegistrationResult =
  | { success: true }
  | { success: false; error: { code: string; programErrorName?: string } };

export type RegistrationOutcome =
  | { kind: "success"; messageKey: string }
  | { kind: "refused"; messageKey: string; programErrorName: string }
  | { kind: "error"; messageKey: string };

export function outcomeForRegistration(result: RegistrationResult): RegistrationOutcome {
  if (result.success) return { kind: "success", messageKey: REGISTERED_MESSAGE_KEY };
  if (result.error.code === "REGISTRATION_REFUSED") {
    return {
      kind: "refused",
      messageKey: REFUSED_MESSAGE_KEY,
      programErrorName: result.error.programErrorName ?? "",
    };
  }
  return { kind: "error", messageKey: errorMessageKey(result.error.code) };
}

/** The role gate throws in the wrapper instead of returning a Result. */
const FORBIDDEN_MESSAGE_PATTERN = /Requires '\w+' role or higher|Not a Mutav staff member/;

export function outcomeForThrownRegistration(error: unknown): RegistrationOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "error",
    messageKey: FORBIDDEN_MESSAGE_PATTERN.test(message)
      ? FORBIDDEN_MESSAGE_KEY
      : UNEXPECTED_MESSAGE_KEY,
  };
}

/** A Solana signature is 64 bytes in base58: 86–88 characters, no 0/O/I/l. */
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

export function isTxSignatureInput(value: string): boolean {
  return BASE58_SIGNATURE.test(value.trim());
}

const BASE_UNITS_PER_CENT = BigInt(10_000);

/**
 * Reserve base units (BRS, 6 decimals) as whole cents for the money
 * formatter. Covers are whole cents by construction; a hold rounds up, so it
 * can carry a fraction of a cent, which is rounded up here too — the figure
 * is never shown smaller than what the reserve holds.
 */
export function baseUnitsToCents(baseUnits: string): number {
  const units = BigInt(baseUnits);
  return Number((units + BASE_UNITS_PER_CENT - BigInt(1)) / BASE_UNITS_PER_CENT);
}
