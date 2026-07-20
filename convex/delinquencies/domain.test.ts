// @vitest-environment edge-runtime
import { describe, expect, test } from "vitest";
import {
  DELINQUENCY_STATUS,
  NOTICE_CANCELLATION_REASON,
  NOTICE_EVIDENCE_SOURCE,
  NOTICE_RESOLUTION_KIND,
  isCancelled,
  isOpen,
  isResolved,
} from "./domain";

describe("pure predicates", () => {
  test("isOpen only true for pendencia_aberta", () => {
    expect(isOpen(DELINQUENCY_STATUS.PENDENCIA_ABERTA)).toBe(true);
    expect(isOpen(DELINQUENCY_STATUS.ENTREGUE)).toBe(false);
    expect(isOpen(DELINQUENCY_STATUS.CANCELADO)).toBe(false);
  });

  test("isResolved only true for entregue", () => {
    expect(isResolved(DELINQUENCY_STATUS.ENTREGUE)).toBe(true);
    expect(isResolved(DELINQUENCY_STATUS.PENDENCIA_ABERTA)).toBe(false);
    expect(isResolved(DELINQUENCY_STATUS.CANCELADO)).toBe(false);
  });

  test("isCancelled only true for cancelado", () => {
    expect(isCancelled(DELINQUENCY_STATUS.CANCELADO)).toBe(true);
    expect(isCancelled(DELINQUENCY_STATUS.PENDENCIA_ABERTA)).toBe(false);
    expect(isCancelled(DELINQUENCY_STATUS.ENTREGUE)).toBe(false);
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
