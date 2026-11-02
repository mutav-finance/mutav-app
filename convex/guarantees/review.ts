import { v } from "convex/values";
import type { Result } from "../lib/result";
import { CLOSE_REASON, GUARANTEE_STATE, type CloseReason, type GuaranteeState } from "./machine";
import { GUARANTEE_ERROR_CODE, SCORE_TIER, type PriceableTier, type ScoreTier } from "./domain";

/**
 * Mutav's underwriting review of a draft — a sub-status that lives inside
 * `drafted` rather than a new lifecycle state (ADR 0011). The lifecycle
 * machine answers "is Mutav on risk"; this one answers "where is the decision
 * to go on risk". Keeping them apart leaves the seven-state machine, its
 * aggregates and every insured-state read untouched.
 *
 * Phase-1 activation rule (issue #427, ADR amendment pending): approving the
 * signed rental contract of an `awaiting_signature` draft marks the review
 * `signed` and, in the same transaction, runs the reserve capacity check.
 * Pass → the lifecycle moves drafted → active and the review stays `signed`.
 * Fail → the review moves to `awaiting_capacity` and the draft waits; a retry
 * that passes moves it back to `signed` as the guarantee goes active.
 */
export const REVIEW_STATUS = {
  EDITING: "editing",
  ANALYSIS_REQUESTED: "analysis_requested",
  ACCEPTED: "accepted",
  AWAITING_SIGNATURE: "awaiting_signature",
  SIGNED: "signed",
  AWAITING_CAPACITY: "awaiting_capacity",
  REFUSED: "refused",
} as const;

export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  REVIEW_STATUS.EDITING,
  REVIEW_STATUS.ANALYSIS_REQUESTED,
  REVIEW_STATUS.ACCEPTED,
  REVIEW_STATUS.AWAITING_SIGNATURE,
  REVIEW_STATUS.SIGNED,
  REVIEW_STATUS.AWAITING_CAPACITY,
  REVIEW_STATUS.REFUSED,
] as const;

export const reviewStatusValidator = v.union(
  v.literal(REVIEW_STATUS.EDITING),
  v.literal(REVIEW_STATUS.ANALYSIS_REQUESTED),
  v.literal(REVIEW_STATUS.ACCEPTED),
  v.literal(REVIEW_STATUS.AWAITING_SIGNATURE),
  v.literal(REVIEW_STATUS.SIGNED),
  v.literal(REVIEW_STATUS.AWAITING_CAPACITY),
  v.literal(REVIEW_STATUS.REFUSED),
);

export const TERMINAL_REVIEW_STATUSES: ReadonlySet<ReviewStatus> = new Set([REVIEW_STATUS.REFUSED]);

/** Where a signed draft stands while it is not yet on risk. */
export const ACTIVATION_PENDING_REVIEW_STATUSES: readonly ReviewStatus[] = [
  REVIEW_STATUS.SIGNED,
  REVIEW_STATUS.AWAITING_CAPACITY,
];

/**
 * Every legal review move, keyed by the FROM status. A refusal is final for
 * that draft — the agency starts a new draft rather than reopening a refused
 * one — and an accepted draft cannot go back to editing: the terms Mutav
 * accepted are the terms that get signed. `signed ⇄ awaiting_capacity` is the
 * capacity gate: out when a check fails, back when a retry passes.
 */
export const ALLOWED_REVIEW_TRANSITIONS: Readonly<Record<ReviewStatus, readonly ReviewStatus[]>> = {
  editing: [REVIEW_STATUS.ANALYSIS_REQUESTED],
  analysis_requested: [REVIEW_STATUS.ACCEPTED, REVIEW_STATUS.REFUSED],
  accepted: [REVIEW_STATUS.AWAITING_SIGNATURE],
  awaiting_signature: [REVIEW_STATUS.SIGNED],
  signed: [REVIEW_STATUS.AWAITING_CAPACITY],
  awaiting_capacity: [REVIEW_STATUS.SIGNED],
  refused: [],
} as const;

export type ReviewTransitionError =
  | { code: "REVIEW_SELF_TRANSITION" }
  | { code: "REVIEW_TERMINAL" }
  | { code: "REVIEW_ILLEGAL_TRANSITION" };

export type ReviewTransitionSuccess = { from: ReviewStatus; to: ReviewStatus };

export const assertReviewTransition = (
  from: ReviewStatus,
  to: ReviewStatus,
): Result<ReviewTransitionSuccess, ReviewTransitionError> => {
  if (from === to) {
    return {
      success: false,
      error: { code: "REVIEW_SELF_TRANSITION" },
      message: `Refusing self-transition on review status "${from}".`,
    };
  }
  if (TERMINAL_REVIEW_STATUSES.has(from)) {
    return {
      success: false,
      error: { code: "REVIEW_TERMINAL" },
      message: `Review status "${from}" is terminal; no outbound moves permitted.`,
    };
  }
  const legalTargets = ALLOWED_REVIEW_TRANSITIONS[from];
  if (!legalTargets.includes(to)) {
    return {
      success: false,
      error: { code: "REVIEW_ILLEGAL_TRANSITION" },
      message: `Illegal review move ${from} -> ${to}. Allowed from ${from}: ${legalTargets.join(", ")}.`,
    };
  }
  return { success: true, data: { from, to }, message: `Review move ${from} -> ${to} approved.` };
};

/**
 * The review status a row inserted directly in `state` carries — for the seed
 * and test fixtures, which insert guarantees in their target state rather
 * than walking them there. An activated guarantee has, by construction, been
 * through the whole review and its contract was signed; a draft closed
 * before activation never left it, unless Mutav refused it.
 */
export function reviewStatusForInsertedState({
  state,
  closeReason,
}: {
  state: GuaranteeState;
  closeReason?: CloseReason;
}): ReviewStatus {
  if (state === GUARANTEE_STATE.DRAFTED) return REVIEW_STATUS.EDITING;
  if (closeReason === CLOSE_REASON.UNDERWRITING_REFUSED) return REVIEW_STATUS.REFUSED;
  if (closeReason === CLOSE_REASON.CANCELED_PRE_ACTIVATION) return REVIEW_STATUS.EDITING;
  return REVIEW_STATUS.SIGNED;
}

/**
 * Bounds on the guarantee-fee rate Mutav compliance may set on acceptance, in
 * basis points of monthly rent. Wide enough to price above the catalog's worst
 * tier (15%) for a tenant the bureau scored low, narrow enough that a typo
 * (a fee of 120% of rent, or of 0) is refused instead of signed.
 */
export const BASIS_POINTS_PER_UNIT = 10_000;
export const MIN_STAFF_FEE_RATE_BPS = 100;
export const MAX_STAFF_FEE_RATE_BPS = 3_000;

export function isValidStaffFeeRateBps(feeRateBps: number): boolean {
  return (
    Number.isInteger(feeRateBps) &&
    feeRateBps >= MIN_STAFF_FEE_RATE_BPS &&
    feeRateBps <= MAX_STAFF_FEE_RATE_BPS
  );
}

export function rateToBps(rate: number): number {
  return Math.round(rate * BASIS_POINTS_PER_UNIT);
}

/**
 * The tier a draft is provisionally priced at. The bureau score is an input to
 * Mutav's decision, not the decision, so a `negado` score no longer blocks a
 * draft — but the catalog carries no rate for it, so until compliance sets one
 * the draft is quoted at the worst priceable tier and the agency UI labels the
 * figure provisional.
 */
export function provisionalPricingTier(tier: ScoreTier): PriceableTier {
  return tier === SCORE_TIER.NEGADO ? SCORE_TIER.RUIM : tier;
}

/** Free-text bounds on the staff decision fields — an audit row is not a document store. */
export const MAX_REVIEW_TEXT_LENGTH = 2_000;

export const REVIEW_ERROR_CODE = {
  NOT_EDITING: "NOT_EDITING",
  INVALID_FEE_RATE: "INVALID_FEE_RATE",
  REFUSAL_REASON_REQUIRED: "REFUSAL_REASON_REQUIRED",
  TEXT_TOO_LONG: "TEXT_TOO_LONG",
} as const satisfies Record<string, string>;

/**
 * Why a signed draft cannot be activated, before the capacity check runs.
 * Each is a distinct refusal code of `retryActivation` and a distinct reason
 * the admin app shows next to the guarantee.
 */
export const ACTIVATION_ERROR_CODE = {
  REVIEW_NOT_SIGNED: "REVIEW_NOT_SIGNED",
  SIGNED_CONTRACT_NOT_APPROVED: "SIGNED_CONTRACT_NOT_APPROVED",
  AGENCY_NOT_ACTIVE: "AGENCY_NOT_ACTIVE",
} as const satisfies Record<string, string>;

export type ActivationBlocker =
  | typeof GUARANTEE_ERROR_CODE.NOT_DRAFTED
  | (typeof ACTIVATION_ERROR_CODE)[keyof typeof ACTIVATION_ERROR_CODE];

export type ActivationReadiness = {
  status: GuaranteeState;
  review: ReviewStatus;
  signedContractApproved: boolean;
  agencyActive: boolean;
};

/**
 * Every precondition an activation checks before it measures the reserve, in
 * the order it checks them. An empty list means only reserve capacity stands
 * between the draft and `active`. The mutations refuse with the first entry;
 * the admin app lists them all.
 */
export function activationBlockers(readiness: ActivationReadiness): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = [];
  if (readiness.status !== GUARANTEE_STATE.DRAFTED) blockers.push(GUARANTEE_ERROR_CODE.NOT_DRAFTED);
  if (!ACTIVATION_PENDING_REVIEW_STATUSES.includes(readiness.review)) {
    blockers.push(ACTIVATION_ERROR_CODE.REVIEW_NOT_SIGNED);
  }
  if (!readiness.signedContractApproved) {
    blockers.push(ACTIVATION_ERROR_CODE.SIGNED_CONTRACT_NOT_APPROVED);
  }
  if (!readiness.agencyActive) blockers.push(ACTIVATION_ERROR_CODE.AGENCY_NOT_ACTIVE);
  return blockers;
}
