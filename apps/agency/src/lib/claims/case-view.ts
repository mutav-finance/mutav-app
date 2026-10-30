import { AGENCY_CASE_STATUS, type AgencyCaseStatus } from "@convex/delinquencies/domain";

/**
 * A query result does not refresh when the date rolls over, so a case read as
 * `reported` yesterday may be `ready_to_claim` today with nothing changed in
 * the database. The server sends `claimableFrom`; this re-derives only that
 * one time-based split and trusts the server for everything else.
 */
export function liveCaseStatus(
  { caseStatus, claimableFrom }: { caseStatus: AgencyCaseStatus; claimableFrom: string },
  today: string,
): AgencyCaseStatus {
  if (
    caseStatus !== AGENCY_CASE_STATUS.REPORTED &&
    caseStatus !== AGENCY_CASE_STATUS.READY_TO_CLAIM
  ) {
    return caseStatus;
  }
  return today >= claimableFrom ? AGENCY_CASE_STATUS.READY_TO_CLAIM : AGENCY_CASE_STATUS.REPORTED;
}

/** The five steps every open case walks, in the order the stepper shows them. */
export const CASE_STEPS = ["late", "claim", "review", "approved", "paid"] as const;

/**
 * Position on the stepper (1-based), or null for a case that ended off the
 * main path (cured, withdrawn, refused, expired), which shows its ending
 * instead of a stepper.
 */
export function caseStep(status: AgencyCaseStatus): number | null {
  switch (status) {
    case AGENCY_CASE_STATUS.REPORTED:
      return 1;
    case AGENCY_CASE_STATUS.READY_TO_CLAIM:
      return 2;
    case AGENCY_CASE_STATUS.UNDER_REVIEW:
    case AGENCY_CASE_STATUS.INFO_REQUESTED:
      return 3;
    case AGENCY_CASE_STATUS.APPROVED:
      return 4;
    case AGENCY_CASE_STATUS.PAID:
      return 5;
    default:
      return null;
  }
}

export type NextStep =
  | { key: "waitUntil"; date: string }
  | { key: "fileClaim" }
  | { key: "answerRequest"; date: string | null }
  | { key: "mutavReviewing" }
  | { key: "awaitingPayment" }
  | { key: "none" };

/** The one thing that moves the case forward, and whose turn it is. */
export function nextStepFor({
  status,
  claimableFrom,
  requestDueAt,
}: {
  status: AgencyCaseStatus;
  claimableFrom: string;
  requestDueAt: string | null;
}): NextStep {
  switch (status) {
    case AGENCY_CASE_STATUS.REPORTED:
      return { key: "waitUntil", date: claimableFrom };
    case AGENCY_CASE_STATUS.READY_TO_CLAIM:
      return { key: "fileClaim" };
    case AGENCY_CASE_STATUS.INFO_REQUESTED:
      return { key: "answerRequest", date: requestDueAt };
    case AGENCY_CASE_STATUS.UNDER_REVIEW:
      return { key: "mutavReviewing" };
    case AGENCY_CASE_STATUS.APPROVED:
      return { key: "awaitingPayment" };
    default:
      return { key: "none" };
  }
}

export type CaseEvent = {
  key: "reported" | "claimed" | "infoRequested" | "verified" | "covered" | "paid" | "closed";
  at: string;
};

type CaseEventSource = {
  openedAt: string;
  verifiedAt: string | null;
  claim: { submittedAt: string; requests: { requestedAt: string }[] } | null;
  resolution: { kind: string; resolvedAt: string } | null;
  cancellation: { canceledAt: string } | null;
  cover: { executedAt: string | null } | null;
};

/** The case's own history, newest first, built from the dates it carries. */
export function caseEvents(detail: CaseEventSource): CaseEvent[] {
  const events: CaseEvent[] = [{ key: "reported", at: detail.openedAt }];
  if (detail.claim) {
    events.push({ key: "claimed", at: detail.claim.submittedAt });
    for (const request of detail.claim.requests) {
      events.push({ key: "infoRequested", at: request.requestedAt });
    }
  }
  if (detail.verifiedAt) events.push({ key: "verified", at: detail.verifiedAt });
  if (detail.resolution) {
    events.push({
      key: detail.resolution.kind === "cover_committed" ? "covered" : "closed",
      at: detail.resolution.resolvedAt,
    });
  }
  if (detail.cover?.executedAt) events.push({ key: "paid", at: detail.cover.executedAt });
  if (detail.cancellation) events.push({ key: "closed", at: detail.cancellation.canceledAt });
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
