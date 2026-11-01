// @vitest-environment edge-runtime
import { describe, expect, test } from "vitest";
import { COVER_OPERATION_STATUS } from "../coverOperations/domain";
import { DOCUMENT_KEY, type GuaranteeDocumentStatus } from "../guarantees/domain";
import {
  AGENCY_CASE_STATUSES,
  DELINQUENCY_STATUS,
  NOTICE_CANCELLATION_REASON,
  NOTICE_EVIDENCE_SOURCE,
  NOTICE_RESOLUTION_KIND,
  SIGNED_CONTRACT_STATE,
  isCanceled,
  isOpen,
  isResolved,
  agencyCanAct,
  claimExpiryReason,
  caseGroupOf,
  coverRequestCents,
  signedContractState,
  toAgencyCaseStatus,
} from "./domain";

describe("pure predicates", () => {
  test("isOpen only true for open", () => {
    expect(isOpen(DELINQUENCY_STATUS.OPEN)).toBe(true);
    expect(isOpen(DELINQUENCY_STATUS.RESOLVED)).toBe(false);
    expect(isOpen(DELINQUENCY_STATUS.CANCELED)).toBe(false);
  });

  test("isResolved only true for resolved", () => {
    expect(isResolved(DELINQUENCY_STATUS.RESOLVED)).toBe(true);
    expect(isResolved(DELINQUENCY_STATUS.OPEN)).toBe(false);
    expect(isResolved(DELINQUENCY_STATUS.CANCELED)).toBe(false);
  });

  test("isCanceled only true for canceled", () => {
    expect(isCanceled(DELINQUENCY_STATUS.CANCELED)).toBe(true);
    expect(isCanceled(DELINQUENCY_STATUS.OPEN)).toBe(false);
    expect(isCanceled(DELINQUENCY_STATUS.RESOLVED)).toBe(false);
  });
});

describe("value-object constants", () => {
  test("resolution kinds cover the four causes a notice can settle from", () => {
    expect(Object.values(NOTICE_RESOLUTION_KIND).sort()).toEqual([
      "cover_committed",
      "staff_dispute",
      "stale",
      "tenant_cured",
    ]);
  });

  test("cancellation reasons cover the four ways a notice can be voided", () => {
    expect(Object.values(NOTICE_CANCELLATION_REASON).sort()).toEqual([
      "agency_withdrew",
      "data_error",
      "duplicate",
      "staff_dismissed",
    ]);
  });

  test("evidence sources cover the five provenance channels (pilot + future Pix)", () => {
    expect(Object.values(NOTICE_EVIDENCE_SOURCE).sort()).toEqual([
      "agency_reported",
      "bank_attested",
      "onchain_observed",
      "system_scheduled",
      "tenant_confirmed",
    ]);
  });
});

describe("toAgencyCaseStatus", () => {
  const recorded = { status: COVER_OPERATION_STATUS.RECORDED };
  const executed = { status: COVER_OPERATION_STATUS.EXECUTED };

  test.each([
    ["open", { status: DELINQUENCY_STATUS.OPEN }, null, "reported"],
    ["verified", { status: DELINQUENCY_STATUS.VERIFIED }, null, "under_review"],
    [
      "cover recorded but not paid",
      {
        status: DELINQUENCY_STATUS.RESOLVED,
        resolution: { kind: NOTICE_RESOLUTION_KIND.COVER_COMMITTED },
      },
      recorded,
      "approved",
    ],
    [
      "cover executed",
      {
        status: DELINQUENCY_STATUS.RESOLVED,
        resolution: { kind: NOTICE_RESOLUTION_KIND.COVER_COMMITTED },
      },
      executed,
      "paid",
    ],
    [
      "cover resolution whose ledger row is missing",
      {
        status: DELINQUENCY_STATUS.RESOLVED,
        resolution: { kind: NOTICE_RESOLUTION_KIND.COVER_COMMITTED },
      },
      null,
      "approved",
    ],
    [
      "tenant cured",
      {
        status: DELINQUENCY_STATUS.RESOLVED,
        resolution: { kind: NOTICE_RESOLUTION_KIND.TENANT_CURED },
      },
      null,
      "cured",
    ],
    [
      "staff dispute",
      {
        status: DELINQUENCY_STATUS.RESOLVED,
        resolution: { kind: NOTICE_RESOLUTION_KIND.STAFF_DISPUTE },
      },
      null,
      "refused",
    ],
    [
      "stale",
      { status: DELINQUENCY_STATUS.RESOLVED, resolution: { kind: NOTICE_RESOLUTION_KIND.STALE } },
      null,
      "expired",
    ],
    [
      "agency withdrew",
      {
        status: DELINQUENCY_STATUS.CANCELED,
        cancellation: { reason: NOTICE_CANCELLATION_REASON.AGENCY_WITHDREW },
      },
      null,
      "withdrawn",
    ],
    [
      "duplicate",
      {
        status: DELINQUENCY_STATUS.CANCELED,
        cancellation: { reason: NOTICE_CANCELLATION_REASON.DUPLICATE },
      },
      null,
      "withdrawn",
    ],
    [
      "data error",
      {
        status: DELINQUENCY_STATUS.CANCELED,
        cancellation: { reason: NOTICE_CANCELLATION_REASON.DATA_ERROR },
      },
      null,
      "withdrawn",
    ],
    [
      "staff dismissed",
      {
        status: DELINQUENCY_STATUS.CANCELED,
        cancellation: { reason: NOTICE_CANCELLATION_REASON.STAFF_DISMISSED },
      },
      null,
      "refused",
    ],
  ] as const)("%s → %s", (_label, notice, coverOperation, expected) => {
    expect(toAgencyCaseStatus({ notice, coverOperation })).toBe(expected);
  });

  test("every case status is reachable", () => {
    expect([...AGENCY_CASE_STATUSES].sort()).toEqual([
      "approved",
      "cured",
      "expired",
      "info_requested",
      "paid",
      "ready_to_claim",
      "refused",
      "reported",
      "under_review",
      "withdrawn",
    ]);
  });
});

describe("signedContractState", () => {
  const contract = (status: GuaranteeDocumentStatus, day: string) => ({
    key: DOCUMENT_KEY.RENTAL_CONTRACT,
    status,
    uploadedAt: `2026-10-${day}T12:00:00.000Z`,
  });

  test("no rental contract on file reads as not uploaded", () => {
    expect(signedContractState([])).toBe(SIGNED_CONTRACT_STATE.NOT_UPLOADED);
    expect(
      signedContractState([{ ...contract("approved", "01"), key: DOCUMENT_KEY.INSPECTION }]),
    ).toBe(SIGNED_CONTRACT_STATE.NOT_UPLOADED);
  });

  test("the newest live upload decides between in review and rejected", () => {
    expect(signedContractState([contract("pending_review", "01")])).toBe(
      SIGNED_CONTRACT_STATE.IN_REVIEW,
    );
    expect(
      signedContractState([contract("pending_review", "01"), contract("rejected", "02")]),
    ).toBe(SIGNED_CONTRACT_STATE.REJECTED);
    expect(
      signedContractState([contract("rejected", "01"), contract("pending_review", "02")]),
    ).toBe(SIGNED_CONTRACT_STATE.IN_REVIEW);
    expect(signedContractState([contract("superseded", "01")])).toBe(
      SIGNED_CONTRACT_STATE.NOT_UPLOADED,
    );
  });

  test("any approved file wins, even when a newer one was rejected", () => {
    expect(signedContractState([contract("approved", "01"), contract("rejected", "02")])).toBe(
      SIGNED_CONTRACT_STATE.APPROVED,
    );
  });
});

describe("agencyCanAct", () => {
  test.each([
    [DELINQUENCY_STATUS.OPEN, true],
    [DELINQUENCY_STATUS.VERIFIED, false],
    [DELINQUENCY_STATUS.RESOLVED, false],
    [DELINQUENCY_STATUS.CANCELED, false],
  ] as const)("%s → %s", (status, expected) => {
    expect(agencyCanAct(status)).toBe(expected);
  });
});

describe("caseGroupOf", () => {
  test.each([
    ["reported", "needs_you"],
    ["ready_to_claim", "needs_you"],
    ["info_requested", "needs_you"],
    ["under_review", "with_mutav"],
    ["approved", "with_mutav"],
    ["paid", "closed"],
    ["cured", "closed"],
    ["withdrawn", "closed"],
    ["refused", "closed"],
    ["expired", "closed"],
  ] as const)("%s → %s", (status, group) => {
    expect(caseGroupOf(status)).toBe(group);
  });
});

describe("claimExpiryReason", () => {
  const rules = { graceDays: 10, filingWindowDays: 90 };
  const request = (dueAt: string, resolvedAt?: string) => ({
    dueAt,
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
  });

  test.each([
    [
      "unclaimed, inside the window",
      { status: "open", rentDueDate: "2026-06-05" },
      "2026-08-01",
      null,
    ],
    [
      "unclaimed, last day of the window",
      { status: "open", rentDueDate: "2026-06-05" },
      "2026-09-03",
      null,
    ],
    [
      "unclaimed, past the window",
      { status: "open", rentDueDate: "2026-06-05" },
      "2026-09-04",
      "filing_window",
    ],
    [
      "submitted claim waiting on staff never lapses",
      { status: "open", rentDueDate: "2026-01-05", claim: { status: "submitted", requests: [] } },
      "2026-12-31",
      null,
    ],
    [
      "request not yet due",
      {
        status: "open",
        rentDueDate: "2026-06-05",
        claim: { status: "info_requested", requests: [request("2026-07-02")] },
      },
      "2026-07-02",
      null,
    ],
    [
      "request past its deadline",
      {
        status: "open",
        rentDueDate: "2026-06-05",
        claim: { status: "info_requested", requests: [request("2026-07-02")] },
      },
      "2026-07-03",
      "request_deadline",
    ],
    [
      "answered request does not count",
      {
        status: "open",
        rentDueDate: "2026-06-05",
        claim: {
          status: "info_requested",
          requests: [request("2026-07-02", "2026-07-01T10:00:00Z")],
        },
      },
      "2026-07-10",
      null,
    ],
    [
      "verified notice is staff's to close",
      { status: "verified", rentDueDate: "2026-01-05" },
      "2026-12-31",
      null,
    ],
  ] as const)("%s", (_label, notice, today, expected) => {
    expect(claimExpiryReason({ notice, rules, today })).toBe(expected);
  });
});

describe("coverRequestCents", () => {
  test("draws the claimed amount when the agency claimed less than is owed", () => {
    expect(
      coverRequestCents({ updatedAmountCents: 428_400, claim: { claimedAmountCents: 200_000 } }),
    ).toBe(200_000);
  });

  test("never draws more than the notice says is owed", () => {
    expect(
      coverRequestCents({ updatedAmountCents: 300_000, claim: { claimedAmountCents: 420_000 } }),
    ).toBe(300_000);
  });

  test("a notice without a claim draws its updated amount", () => {
    expect(coverRequestCents({ updatedAmountCents: 428_400 })).toBe(428_400);
  });
});
