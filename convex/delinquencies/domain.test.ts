// @vitest-environment edge-runtime
import { describe, expect, test } from "vitest";
import { COVER_OPERATION_STATUS } from "../coverOperations/domain";
import {
  AGENCY_CASE_STATUSES,
  DELINQUENCY_STATUS,
  NOTICE_CANCELLATION_REASON,
  NOTICE_EVIDENCE_SOURCE,
  NOTICE_RESOLUTION_KIND,
  isCanceled,
  isOpen,
  isResolved,
  agencyCanAct,
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
