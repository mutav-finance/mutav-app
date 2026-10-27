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
  READY_TO_CLAIM: "ready_to_claim",
  UNDER_REVIEW: "under_review",
  INFO_REQUESTED: "info_requested",
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
    claim?: { status: ClaimStatus };
  };
  coverOperation: Pick<CoverOperation, "status"> | null;
  /**
   * When the claim may be filed, and today's date. Together they split an
   * unclaimed notice into `reported` (still in the grace period) and
   * `ready_to_claim`; without them an unclaimed notice reads `reported`.
   */
  claimableFrom?: string | null;
  today?: string;
};

export function toAgencyCaseStatus({
  notice,
  coverOperation,
  claimableFrom,
  today,
}: CaseStatusInput): AgencyCaseStatus {
  switch (notice.status) {
    case DELINQUENCY_STATUS.OPEN:
      return openCaseStatus({ claim: notice.claim, claimableFrom, today });
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

function openCaseStatus({
  claim,
  claimableFrom,
  today,
}: {
  claim: { status: ClaimStatus } | undefined;
  claimableFrom: string | null | undefined;
  today: string | undefined;
}): AgencyCaseStatus {
  if (claim?.status === CLAIM_STATUS.INFO_REQUESTED) return AGENCY_CASE_STATUS.INFO_REQUESTED;
  if (claim?.status === CLAIM_STATUS.SUBMITTED) return AGENCY_CASE_STATUS.UNDER_REVIEW;
  if (claimableFrom && today && today >= claimableFrom) return AGENCY_CASE_STATUS.READY_TO_CLAIM;
  return AGENCY_CASE_STATUS.REPORTED;
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

// ---- reporting late rent ---------------------------------------------------

const BRAZIL_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;

/**
 * Today's date (`YYYY-MM-DD`) on the Brazilian calendar the leases are written
 * against. Brazil has kept UTC-3 since dropping daylight saving in 2019; a
 * UTC date would roll over at 21:00 local time and call rent late a few hours
 * early.
 */
export function brazilToday(nowMs: number): string {
  return new Date(nowMs + BRAZIL_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Rent is late from the day after it falls due, so a notice for a due date of
 * today or later is premature.
 */
export const isRentOverdue = ({ rentDueDate, today }: { rentDueDate: string; today: string }) =>
  rentDueDate < today;

// ---- claims (acionamento) --------------------------------------------------

/**
 * Where the agency's request for cover stands while the notice is still open.
 * `submitted` waits on staff; `info_requested` waits on the agency. Once staff
 * verify, the notice's own status takes over and the claim stays `submitted`.
 */
export const CLAIM_STATUS = {
  SUBMITTED: "submitted",
  INFO_REQUESTED: "info_requested",
} as const;

export type ClaimStatus = (typeof CLAIM_STATUS)[keyof typeof CLAIM_STATUS];

export const claimStatusValidator = v.union(
  v.literal(CLAIM_STATUS.SUBMITTED),
  v.literal(CLAIM_STATUS.INFO_REQUESTED),
);

/** The two files every claim carries. */
export const CLAIM_EVIDENCE_KIND = {
  NON_PAYMENT_PROOF: "nonPaymentProof",
  TENANT_NOTICE: "tenantNotice",
} as const;

export type ClaimEvidenceKind = (typeof CLAIM_EVIDENCE_KIND)[keyof typeof CLAIM_EVIDENCE_KIND];

export const CLAIM_EVIDENCE_KINDS: readonly ClaimEvidenceKind[] =
  Object.values(CLAIM_EVIDENCE_KIND);

export const claimEvidenceKindValidator = v.union(
  v.literal(CLAIM_EVIDENCE_KIND.NON_PAYMENT_PROOF),
  v.literal(CLAIM_EVIDENCE_KIND.TENANT_NOTICE),
);

/**
 * `accepted` is set when staff verify the default; `rejected` when they ask
 * for that file again; `superseded` when the agency replaced a pending file.
 */
export const CLAIM_EVIDENCE_STATUS = {
  PENDING_REVIEW: "pending_review",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  SUPERSEDED: "superseded",
} as const;

export type ClaimEvidenceStatus =
  (typeof CLAIM_EVIDENCE_STATUS)[keyof typeof CLAIM_EVIDENCE_STATUS];

/**
 * Placeholder values until the product decision is made: a claim opens
 * `graceDays` after the rent fell due and stays fileable for
 * `filingWindowDays`. A product's own `claimRules` overrides both.
 */
export const CLAIM_GRACE_DAYS_DEFAULT = 10;
export const CLAIM_FILING_WINDOW_DAYS_DEFAULT = 90;

export type ClaimRules = { graceDays: number; filingWindowDays: number };

export const CLAIM_RULES_DEFAULT: ClaimRules = {
  graceDays: CLAIM_GRACE_DAYS_DEFAULT,
  filingWindowDays: CLAIM_FILING_WINDOW_DAYS_DEFAULT,
};

/** Bumped whenever the attestation text the agency accepts changes. */
export const CLAIM_DECLARATION_VERSION = "2026-10-26";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** The first day the claim for a rent due on `rentDueDate` may be filed. */
export function claimableFromDate({
  rentDueDate,
  rules,
}: {
  rentDueDate: string;
  rules: ClaimRules;
}): string {
  return addDays(rentDueDate, rules.graceDays);
}

export type ClaimRequirement = ClaimEvidenceKind | "signedContract";

/**
 * What still stands between this notice and a fileable claim. Evidence counts
 * while its newest live file is pending review or accepted; a rejected file
 * must be replaced. The signed rental contract is a precondition on the
 * guarantee, not a claim upload, but it gates the claim the same way.
 */
export function missingClaimRequirements({
  evidence,
  signedContractApproved,
}: {
  evidence: readonly { kind: ClaimEvidenceKind; status: ClaimEvidenceStatus }[];
  signedContractApproved: boolean;
}): ClaimRequirement[] {
  const usable = new Set(
    evidence
      .filter(
        (file) =>
          file.status === CLAIM_EVIDENCE_STATUS.PENDING_REVIEW ||
          file.status === CLAIM_EVIDENCE_STATUS.ACCEPTED,
      )
      .map((file) => file.kind),
  );
  const missing: ClaimRequirement[] = CLAIM_EVIDENCE_KINDS.filter((kind) => !usable.has(kind));
  return signedContractApproved ? missing : ["signedContract", ...missing];
}
