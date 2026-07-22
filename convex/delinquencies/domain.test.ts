// @vitest-environment edge-runtime
import { describe, expect, test } from "vitest";
import {
  DELINQUENCY_STATUS,
  NOTICE_CANCELLATION_REASON,
  NOTICE_EVIDENCE_SOURCE,
  NOTICE_RESOLUTION_KIND,
  isCanceled,
  isOpen,
  isResolved,
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
