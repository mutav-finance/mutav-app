import { describe, expect, test } from "vitest";
import {
  CLOSE_REASON,
  CLOSE_REASONS,
  CLOSE_REASON_ALLOWED_FROM,
  GUARANTEE_STATES,
  assertClose,
  assertTransition,
  type CloseReason,
  type GuaranteeState,
} from "./machine";

describe("CLOSE_REASON constants", () => {
  test("exposes all seven close reasons", () => {
    expect(CLOSE_REASONS).toEqual([
      "end_of_lease",
      "rescission",
      "abandonment",
      "eviction",
      "dispute_reversal",
      "canceled_pre_activation",
      "death",
    ]);
  });

  test("CLOSE_REASON keys are the uppercase mirror of values", () => {
    expect(CLOSE_REASON.END_OF_LEASE).toBe("end_of_lease");
    expect(CLOSE_REASON.RESCISSION).toBe("rescission");
    expect(CLOSE_REASON.ABANDONMENT).toBe("abandonment");
    expect(CLOSE_REASON.EVICTION).toBe("eviction");
    expect(CLOSE_REASON.DISPUTE_REVERSAL).toBe("dispute_reversal");
    expect(CLOSE_REASON.CANCELED_PRE_ACTIVATION).toBe("canceled_pre_activation");
    expect(CLOSE_REASON.DEATH).toBe("death");
  });

  test("CLOSE_REASON_ALLOWED_FROM has one entry per reason", () => {
    expect(Object.keys(CLOSE_REASON_ALLOWED_FROM).sort()).toEqual([...CLOSE_REASONS].sort());
  });
});

describe("assertClose — full (from, reason) matrix", () => {
  const allowedPairs: Array<[GuaranteeState, CloseReason]> = [
    ["drafted", "canceled_pre_activation"],

    ["active", "end_of_lease"],
    ["active", "rescission"],
    ["active", "abandonment"],
    ["active", "death"],

    ["in_arrears", "end_of_lease"],
    ["in_arrears", "rescission"],
    ["in_arrears", "abandonment"],
    ["in_arrears", "death"],

    ["default_verified", "end_of_lease"],
    ["default_verified", "rescission"],
    ["default_verified", "abandonment"],
    ["default_verified", "death"],
    ["default_verified", "dispute_reversal"],

    ["cover_committed", "end_of_lease"],
    ["cover_committed", "rescission"],
    ["cover_committed", "abandonment"],
    ["cover_committed", "death"],
    ["cover_committed", "dispute_reversal"],

    ["in_eviction", "end_of_lease"],
    ["in_eviction", "rescission"],
    ["in_eviction", "abandonment"],
    ["in_eviction", "death"],
    ["in_eviction", "eviction"],
  ];

  const rejectedPairs: Array<[GuaranteeState, CloseReason, "REASON_NOT_ALLOWED_FROM_STATE"]> = [
    ["drafted", "end_of_lease", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["drafted", "rescission", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["drafted", "abandonment", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["drafted", "eviction", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["drafted", "dispute_reversal", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["drafted", "death", "REASON_NOT_ALLOWED_FROM_STATE"],

    ["active", "eviction", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["active", "dispute_reversal", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["active", "canceled_pre_activation", "REASON_NOT_ALLOWED_FROM_STATE"],

    ["in_arrears", "eviction", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["in_arrears", "dispute_reversal", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["in_arrears", "canceled_pre_activation", "REASON_NOT_ALLOWED_FROM_STATE"],

    ["default_verified", "eviction", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["default_verified", "canceled_pre_activation", "REASON_NOT_ALLOWED_FROM_STATE"],

    ["cover_committed", "eviction", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["cover_committed", "canceled_pre_activation", "REASON_NOT_ALLOWED_FROM_STATE"],

    ["in_eviction", "dispute_reversal", "REASON_NOT_ALLOWED_FROM_STATE"],
    ["in_eviction", "canceled_pre_activation", "REASON_NOT_ALLOWED_FROM_STATE"],
  ];

  test.each(allowedPairs)("close from %s with reason %s is allowed", (from, reason) => {
    const result = assertClose(from, reason);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ from, reason });
    }
  });

  test.each(rejectedPairs)(
    "close from %s with reason %s is rejected with %s",
    (from, reason, code) => {
      const result = assertClose(from, reason);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(code);
      }
    },
  );

  test.each(CLOSE_REASONS)(
    "closing an already closed guarantee with %s is TERMINAL_STATE",
    (reason) => {
      const result = assertClose("closed", reason);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TERMINAL_STATE");
      }
    },
  );

  test("allowed + rejected + terminal rows cover the whole matrix exactly once", () => {
    const covered = new Set<string>();
    for (const [from, reason] of allowedPairs) covered.add(`${from}|${reason}`);
    for (const [from, reason] of rejectedPairs) covered.add(`${from}|${reason}`);
    for (const reason of CLOSE_REASONS) covered.add(`closed|${reason}`);
    expect(covered.size).toBe(allowedPairs.length + rejectedPairs.length + CLOSE_REASONS.length);
    expect(covered.size).toBe(GUARANTEE_STATES.length * CLOSE_REASONS.length);
  });
});

describe("assertClose composes with assertTransition(from, closed)", () => {
  test("every allowed close origin also has a legal transition to closed", () => {
    for (const reason of CLOSE_REASONS) {
      for (const from of CLOSE_REASON_ALLOWED_FROM[reason]) {
        expect(assertTransition(from, "closed").success).toBe(true);
      }
    }
  });

  test("assertClose does not replace assertTransition — closed -> closed fails on both", () => {
    expect(assertTransition("closed", "closed").success).toBe(false);
    expect(assertClose("closed", "end_of_lease").success).toBe(false);
  });
});
