import { describe, expect, test } from "vitest";
import { canTransition, DELINQUENCY_STATUS, type DelinquencyStatus } from "./domain";

const ALL_STATUSES: readonly DelinquencyStatus[] = [
  DELINQUENCY_STATUS.OPEN,
  DELINQUENCY_STATUS.UNDER_REVIEW,
  DELINQUENCY_STATUS.PROVISIONED,
  DELINQUENCY_STATUS.PAID,
  DELINQUENCY_STATUS.CLOSED,
];

const LEGAL_EDGES: readonly [DelinquencyStatus, DelinquencyStatus][] = [
  [DELINQUENCY_STATUS.OPEN, DELINQUENCY_STATUS.UNDER_REVIEW],
  [DELINQUENCY_STATUS.UNDER_REVIEW, DELINQUENCY_STATUS.PROVISIONED],
  [DELINQUENCY_STATUS.PROVISIONED, DELINQUENCY_STATUS.PAID],
  [DELINQUENCY_STATUS.PAID, DELINQUENCY_STATUS.CLOSED],
  [DELINQUENCY_STATUS.OPEN, DELINQUENCY_STATUS.CLOSED],
  [DELINQUENCY_STATUS.UNDER_REVIEW, DELINQUENCY_STATUS.CLOSED],
];

describe("canTransition", () => {
  test.each(LEGAL_EDGES)("%s → %s is legal", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  test("open cannot skip straight into provisioned", () => {
    expect(canTransition(DELINQUENCY_STATUS.OPEN, DELINQUENCY_STATUS.PROVISIONED)).toBe(false);
  });

  test("provisioned must pass through paid before closing", () => {
    expect(canTransition(DELINQUENCY_STATUS.PROVISIONED, DELINQUENCY_STATUS.CLOSED)).toBe(false);
  });

  test("open cannot skip straight to paid", () => {
    expect(canTransition(DELINQUENCY_STATUS.OPEN, DELINQUENCY_STATUS.PAID)).toBe(false);
  });

  test("no backwards edges", () => {
    const backwards: readonly [DelinquencyStatus, DelinquencyStatus][] = [
      [DELINQUENCY_STATUS.UNDER_REVIEW, DELINQUENCY_STATUS.OPEN],
      [DELINQUENCY_STATUS.PROVISIONED, DELINQUENCY_STATUS.UNDER_REVIEW],
      [DELINQUENCY_STATUS.PROVISIONED, DELINQUENCY_STATUS.OPEN],
      [DELINQUENCY_STATUS.PAID, DELINQUENCY_STATUS.PROVISIONED],
      [DELINQUENCY_STATUS.PAID, DELINQUENCY_STATUS.UNDER_REVIEW],
      [DELINQUENCY_STATUS.PAID, DELINQUENCY_STATUS.OPEN],
    ];
    for (const [from, to] of backwards) {
      expect(canTransition(from, to)).toBe(false);
    }
  });

  test("closed is terminal", () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition(DELINQUENCY_STATUS.CLOSED, to)).toBe(false);
    }
  });

  test("self-transitions are illegal", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});
