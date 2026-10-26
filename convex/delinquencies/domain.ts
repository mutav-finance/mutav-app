import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

// Machine + status constants are exported from `./machine` — this domain
// module owns the *auxiliary* value objects that accompany a notice row
// (resolution kind, cancellation reason, evidence source), plus the
// Doc<>/Id<> aliases so callers never touch raw generics.

export type DelinquencyNotice = Doc<"guaranteeDelinquencyNotices">;
export type DelinquencyNoticeId = Id<"guaranteeDelinquencyNotices">;

export {
  DELINQUENCY_STATUS,
  DELINQUENCY_STATUSES,
  TERMINAL_STATUSES,
  isTerminal,
  assertTransition,
  ALLOWED_TRANSITIONS,
} from "./machine";
export type { DelinquencyStatus, TransitionError, TransitionSuccess } from "./machine";

import { DELINQUENCY_STATUS, type DelinquencyStatus } from "./machine";
import { COVER_OPERATION_STATUS, type CoverOperation } from "../coverOperations/domain";

/**
 * A cover draw is only legal against a default compliance has actually
 * confirmed. Without this the notice machine alone would let
 * `open → resolved(cover_committed)` through, and a sibling notice's
 * verification would supply the guarantee state the draw checks.
 */
export const NOTICE_NOT_VERIFIED_ERROR_CODE = "NOTICE_NOT_VERIFIED";
export type NoticeNotVerifiedErrorCode = typeof NOTICE_NOT_VERIFIED_ERROR_CODE;

/**
 * One wire code for "the guarantee machine refused the state change this
 * notice disposition implies". `applyGuaranteeTransition` reports seven
 * distinct guard codes; surfacing them raw would ask every caller to carry a
 * message key per guarantee state, and the caller's remedy is the same in all
 * seven cases. The refusal's own sentence travels in `message`.
 */
export const GUARANTEE_REFUSED_ERROR_CODE = "GUARANTEE_TRANSITION_REFUSED";
export type GuaranteeRefusedErrorCode = typeof GUARANTEE_REFUSED_ERROR_CODE;

/**
 * How an `open` notice reached `resolved`. Stored on the row so the resolved
 * terminal state carries its cause. `tenant_cured` = tenant paid the landlord
 * and the agency confirmed. `cover_committed` = Mutav drew reserve to pay the
 * landlord (creates a Regressive Receivable). `staff_dispute` = staff ruled
 * the arrears claim invalid; no cover, no receivable. `stale` = notice aged
 * out without action (rare; hygiene).
 */
export const NOTICE_RESOLUTION_KIND = {
  TENANT_CURED: "tenant_cured",
  COVER_COMMITTED: "cover_committed",
  STAFF_DISPUTE: "staff_dispute",
  STALE: "stale",
} as const;

export type NoticeResolutionKind =
  (typeof NOTICE_RESOLUTION_KIND)[keyof typeof NOTICE_RESOLUTION_KIND];

export const noticeResolutionKindValidator = v.union(
  v.literal(NOTICE_RESOLUTION_KIND.TENANT_CURED),
  v.literal(NOTICE_RESOLUTION_KIND.COVER_COMMITTED),
  v.literal(NOTICE_RESOLUTION_KIND.STAFF_DISPUTE),
  v.literal(NOTICE_RESOLUTION_KIND.STALE),
);

/**
 * Why an `open` notice was canceled. `agency_withdrew` = the agency revoked
 * the notice before verification. `staff_dismissed` = internal staff rejected
 * the notice for procedural reasons. `duplicate` = a prior notice already
 * covers the same event. `data_error` = the notice was opened with wrong
 * fields (fixable by opening a corrected notice).
 */
export const NOTICE_CANCELLATION_REASON = {
  AGENCY_WITHDREW: "agency_withdrew",
  STAFF_DISMISSED: "staff_dismissed",
  DUPLICATE: "duplicate",
  DATA_ERROR: "data_error",
} as const;

export type NoticeCancellationReason =
  (typeof NOTICE_CANCELLATION_REASON)[keyof typeof NOTICE_CANCELLATION_REASON];

export const noticeCancellationReasonValidator = v.union(
  v.literal(NOTICE_CANCELLATION_REASON.AGENCY_WITHDREW),
  v.literal(NOTICE_CANCELLATION_REASON.STAFF_DISMISSED),
  v.literal(NOTICE_CANCELLATION_REASON.DUPLICATE),
  v.literal(NOTICE_CANCELLATION_REASON.DATA_ERROR),
);

/**
 * Provenance of the notice payload. Pilot rows are almost all
 * `agency_reported` — the agency logs into the portal and files the notice.
 * Post-Pix (Story 1.7), `onchain_observed` becomes a system-scheduled trigger
 * when Mutav sees rent absence directly. The evidence source is INDEPENDENT
 * from the state machine — same states, different trust-quality signal on
 * the row and on the transparency dashboard.
 */
export const NOTICE_EVIDENCE_SOURCE = {
  AGENCY_REPORTED: "agency_reported",
  TENANT_CONFIRMED: "tenant_confirmed",
  BANK_ATTESTED: "bank_attested",
  ONCHAIN_OBSERVED: "onchain_observed",
  SYSTEM_SCHEDULED: "system_scheduled",
} as const;

export type NoticeEvidenceSource =
  (typeof NOTICE_EVIDENCE_SOURCE)[keyof typeof NOTICE_EVIDENCE_SOURCE];

export const noticeEvidenceSourceValidator = v.union(
  v.literal(NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED),
  v.literal(NOTICE_EVIDENCE_SOURCE.TENANT_CONFIRMED),
  v.literal(NOTICE_EVIDENCE_SOURCE.BANK_ATTESTED),
  v.literal(NOTICE_EVIDENCE_SOURCE.ONCHAIN_OBSERVED),
  v.literal(NOTICE_EVIDENCE_SOURCE.SYSTEM_SCHEDULED),
);

/**
 * Validator for the notice status field.
 */
export const delinquencyStatusValidator = v.union(
  v.literal(DELINQUENCY_STATUS.OPEN),
  v.literal(DELINQUENCY_STATUS.VERIFIED),
  v.literal(DELINQUENCY_STATUS.RESOLVED),
  v.literal(DELINQUENCY_STATUS.CANCELED),
);

// ---- pure predicates -------------------------------------------------------

export const isOpen = (status: DelinquencyStatus): boolean => status === DELINQUENCY_STATUS.OPEN;

export const isResolved = (status: DelinquencyStatus): boolean =>
  status === DELINQUENCY_STATUS.RESOLVED;

export const isCanceled = (status: DelinquencyStatus): boolean =>
  status === DELINQUENCY_STATUS.CANCELED;

// ---- agency case status ----------------------------------------------------

/**
 * The one status an agency sees for a notice. Staff work happens in two
 * tables (the notice and its cover operation), so the agency's view is a
 * function of both: a cover resolution is only `paid` once the payout row is
 * `executed`; before that Mutav owes the money and the case is `approved`.
 */
export const AGENCY_CASE_STATUS = {
  REPORTED: "reported",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  PAID: "paid",
  CURED: "cured",
  WITHDRAWN: "withdrawn",
  REFUSED: "refused",
  EXPIRED: "expired",
} as const;

export type AgencyCaseStatus = (typeof AGENCY_CASE_STATUS)[keyof typeof AGENCY_CASE_STATUS];

export const AGENCY_CASE_STATUSES: readonly AgencyCaseStatus[] = Object.values(AGENCY_CASE_STATUS);

type CaseStatusInput = {
  notice: {
    status: DelinquencyStatus;
    resolution?: { kind: NoticeResolutionKind };
    cancellation?: { reason: NoticeCancellationReason };
  };
  coverOperation: Pick<CoverOperation, "status"> | null;
};

export function toAgencyCaseStatus({ notice, coverOperation }: CaseStatusInput): AgencyCaseStatus {
  switch (notice.status) {
    case DELINQUENCY_STATUS.OPEN:
      return AGENCY_CASE_STATUS.REPORTED;
    case DELINQUENCY_STATUS.VERIFIED:
      return AGENCY_CASE_STATUS.UNDER_REVIEW;
    case DELINQUENCY_STATUS.CANCELED:
      return notice.cancellation?.reason === NOTICE_CANCELLATION_REASON.STAFF_DISMISSED
        ? AGENCY_CASE_STATUS.REFUSED
        : AGENCY_CASE_STATUS.WITHDRAWN;
    case DELINQUENCY_STATUS.RESOLVED:
      return resolvedCaseStatus(notice.resolution?.kind, coverOperation);
  }
}

function resolvedCaseStatus(
  kind: NoticeResolutionKind | undefined,
  coverOperation: Pick<CoverOperation, "status"> | null,
): AgencyCaseStatus {
  switch (kind) {
    case NOTICE_RESOLUTION_KIND.COVER_COMMITTED:
      return coverOperation?.status === COVER_OPERATION_STATUS.EXECUTED
        ? AGENCY_CASE_STATUS.PAID
        : AGENCY_CASE_STATUS.APPROVED;
    case NOTICE_RESOLUTION_KIND.TENANT_CURED:
      return AGENCY_CASE_STATUS.CURED;
    case NOTICE_RESOLUTION_KIND.STAFF_DISPUTE:
      return AGENCY_CASE_STATUS.REFUSED;
    case NOTICE_RESOLUTION_KIND.STALE:
    case undefined:
      return AGENCY_CASE_STATUS.EXPIRED;
  }
}

/**
 * The agency's own dispositions (`markResolved`, `markCanceled`) are refused
 * once staff verify the default, so the UI offers them on `open` only.
 */
export const agencyCanAct = (status: DelinquencyStatus): boolean =>
  status === DELINQUENCY_STATUS.OPEN;
