import { v } from "convex/values";

// Machine + status constants are exported from `./machine` — this domain
// module owns the *auxiliary* value objects that accompany a notice row
// (resolution kind, cancellation reason, evidence source). Doc<>/Id<>
// aliases land here once the schema table is introduced.

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
  v.literal(DELINQUENCY_STATUS.RESOLVED),
  v.literal(DELINQUENCY_STATUS.CANCELED),
);

// ---- pure predicates -------------------------------------------------------

export const isOpen = (status: DelinquencyStatus): boolean => status === DELINQUENCY_STATUS.OPEN;

export const isResolved = (status: DelinquencyStatus): boolean =>
  status === DELINQUENCY_STATUS.RESOLVED;

export const isCanceled = (status: DelinquencyStatus): boolean =>
  status === DELINQUENCY_STATUS.CANCELED;
