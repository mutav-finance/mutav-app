import { GUARANTEE_STATE, type GuaranteeState } from "@convex/guarantees/domain";
import { REVIEW_STATUS, type ReviewStatus } from "@convex/guarantees/review";

/**
 * The agency-facing stepper for the road to activation: Mutav's underwriting
 * review, then the guarantee going on risk. It ends Signed → Active: under the
 * phase-1 rule (issue #427) approving the signed contract activates the
 * guarantee when the reserve has room for it. When it does not, a "Waiting
 * for reserve" step appears between the two until it fits. `active` is the
 * lifecycle state, not a review status. `refused` is not a step on the happy
 * path — it replaces everything after the request — so it is reported as a
 * flag beside the steps rather than as one of them.
 */
export const ACTIVE_STEP = GUARANTEE_STATE.ACTIVE;

export const REVIEW_STEPS = [
  REVIEW_STATUS.EDITING,
  REVIEW_STATUS.ANALYSIS_REQUESTED,
  REVIEW_STATUS.ACCEPTED,
  REVIEW_STATUS.AWAITING_SIGNATURE,
  REVIEW_STATUS.SIGNED,
  REVIEW_STATUS.AWAITING_CAPACITY,
  ACTIVE_STEP,
] as const;

export type ReviewStep = (typeof REVIEW_STEPS)[number];
export type ReviewStepState = "done" | "current" | "upcoming";

export type ReviewStepper = {
  steps: ReadonlyArray<{ step: ReviewStep; state: ReviewStepState }>;
  refused: boolean;
};

const REFUSED_AFTER_STEP: ReviewStep = REVIEW_STATUS.ANALYSIS_REQUESTED;

/** Where the stepper stands: the review status, or `active` once on risk. */
export function currentReviewStep({
  status,
  review,
}: {
  status: GuaranteeState;
  review: ReviewStatus;
}): ReviewStep | typeof REVIEW_STATUS.REFUSED {
  return status === GUARANTEE_STATE.DRAFTED || review === REVIEW_STATUS.REFUSED
    ? review
    : ACTIVE_STEP;
}

/** The steps drawn: the reserve wait only while the guarantee is in it. */
function visibleSteps(current: ReviewStep | typeof REVIEW_STATUS.REFUSED): readonly ReviewStep[] {
  return REVIEW_STEPS.filter(
    (step) =>
      step !== REVIEW_STATUS.AWAITING_CAPACITY || current === REVIEW_STATUS.AWAITING_CAPACITY,
  );
}

export function reviewStepper(status: ReviewStep | typeof REVIEW_STATUS.REFUSED): ReviewStepper {
  const steps = visibleSteps(status);
  if (status === REVIEW_STATUS.REFUSED) {
    const lastDone = steps.indexOf(REFUSED_AFTER_STEP);
    return {
      steps: steps.map((step, index) => ({
        step,
        state: index <= lastDone ? "done" : "upcoming",
      })),
      refused: true,
    };
  }
  const current = steps.indexOf(status);
  return {
    steps: steps.map((step, index) => ({
      step,
      state: index < current ? "done" : index === current ? "current" : "upcoming",
    })),
    refused: false,
  };
}

/** The agency may hand a draft to Mutav only while it is still being edited. */
export function canRequestAnalysis({
  status,
  review,
}: {
  status: GuaranteeState;
  review: ReviewStatus;
}): boolean {
  return status === GUARANTEE_STATE.DRAFTED && review === REVIEW_STATUS.EDITING;
}

/**
 * The review card is about the road to activation. It stays while the
 * guarantee is `active`, so the agency sees the completed road end at
 * "Active"; once anything else happens to it (arrears, cover, closure) the
 * review is history. A refused draft keeps the card so the agency sees why it
 * closed.
 */
export function showsReviewCard({
  status,
  review,
}: {
  status: GuaranteeState;
  review: ReviewStatus;
}): boolean {
  return (
    status === GUARANTEE_STATE.DRAFTED ||
    status === GUARANTEE_STATE.ACTIVE ||
    review === REVIEW_STATUS.REFUSED
  );
}

/**
 * The signed contract was approved but the reserve had no room for the
 * guarantee yet: the draft keeps waiting and is activated as soon as capacity
 * frees up. The figures behind it are a staff concern.
 */
export function isWaitingForReserveCapacity({
  status,
  review,
}: {
  status: GuaranteeState;
  review: ReviewStatus;
}): boolean {
  return status === GUARANTEE_STATE.DRAFTED && review === REVIEW_STATUS.AWAITING_CAPACITY;
}

const BASIS_POINTS_PER_PERCENT = 100;

/** `1300` → `13`, `1250` → `12.5` — a percent number for the locale formatter. */
export function bpsToPercent(bps: number): number {
  return bps / BASIS_POINTS_PER_PERCENT;
}

/**
 * Error codes `requestAnalysis` can return, each with a message under
 * `guaranteeDetails.review.errors`. Anything else renders the generic message
 * rather than the server's English sentence.
 */
export const REQUEST_ANALYSIS_ERROR_CODES = [
  "NOT_FOUND",
  "NOT_DRAFTED",
  "NOT_EDITING",
  "CREDIT_ASSESSMENT_REQUIRED",
] as const;

const KNOWN_REQUEST_ANALYSIS_ERRORS: ReadonlySet<string> = new Set(REQUEST_ANALYSIS_ERROR_CODES);

export function requestAnalysisErrorKey(code: string): string {
  return KNOWN_REQUEST_ANALYSIS_ERRORS.has(code) ? `errors.${code}` : "errors.UNEXPECTED";
}
