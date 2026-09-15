// @vitest-environment edge-runtime
import { describe, expect, test } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  DELINQUENCY_STATUS,
  DELINQUENCY_STATUSES,
  TERMINAL_STATUSES,
  assertTransition,
  isTerminal,
} from "./machine";

const ALL_STATUSES = DELINQUENCY_STATUSES;

describe("DELINQUENCY_STATUS constants", () => {
  test("exposes the four notice states", () => {
    expect(DELINQUENCY_STATUSES).toEqual(["open", "verified", "resolved", "canceled"]);
  });

  test("DELINQUENCY_STATUS keys mirror the values (upper snake)", () => {
    expect(DELINQUENCY_STATUS.OPEN).toBe("open");
    expect(DELINQUENCY_STATUS.VERIFIED).toBe("verified");
    expect(DELINQUENCY_STATUS.RESOLVED).toBe("resolved");
    expect(DELINQUENCY_STATUS.CANCELED).toBe("canceled");
  });

  test("resolved and canceled are terminal; open and verified are not", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(["canceled", "resolved"]);
    expect(isTerminal("resolved")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(isTerminal("open")).toBe(false);
    expect(isTerminal("verified")).toBe(false);
  });
});

describe("ALLOWED_TRANSITIONS — the five legal edges", () => {
  test("open -> verified is allowed (staff confirmed the default)", () => {
    const result = assertTransition("open", "verified");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ from: "open", to: "verified" });
  });

  test("open -> resolved is allowed (tenant cured or cover committed)", () => {
    const result = assertTransition("open", "resolved");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ from: "open", to: "resolved" });
  });

  test("open -> canceled is allowed (agency withdrew or staff dismissed)", () => {
    const result = assertTransition("open", "canceled");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ from: "open", to: "canceled" });
  });

  test("verified -> resolved and verified -> canceled are allowed; verified -> open is not", () => {
    expect(assertTransition("verified", "resolved").success).toBe(true);
    expect(assertTransition("verified", "canceled").success).toBe(true);
    const back = assertTransition("verified", "open");
    expect(back.success).toBe(false);
    if (!back.success) expect(back.error.code).toBe("ILLEGAL_TRANSITION");
  });

  test("ALLOWED_TRANSITIONS map covers exactly the five edges above", () => {
    const flattened: Array<[string, string]> = [];
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of tos) flattened.push([from, to]);
    }
    expect(flattened.sort()).toEqual(
      [
        ["open", "canceled"],
        ["open", "resolved"],
        ["open", "verified"],
        ["verified", "canceled"],
        ["verified", "resolved"],
      ].sort(),
    );
  });
});

describe("assertTransition — illegal moves rejected", () => {
  test("self-transitions rejected with SELF_TRANSITION", () => {
    for (const status of ALL_STATUSES) {
      const result = assertTransition(status, status);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe("SELF_TRANSITION");
    }
  });

  test("resolved is terminal — no outbound edges", () => {
    for (const target of ALL_STATUSES) {
      if (target === "resolved") continue;
      const result = assertTransition("resolved", target);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe("TERMINAL_STATE");
    }
  });

  test("canceled is terminal — no outbound edges", () => {
    for (const target of ALL_STATUSES) {
      if (target === "canceled") continue;
      const result = assertTransition("canceled", target);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe("TERMINAL_STATE");
    }
  });

  test("resolved -> canceled rejected (both terminal; resolved cannot be canceled)", () => {
    const result = assertTransition("resolved", "canceled");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("TERMINAL_STATE");
  });

  test("canceled -> resolved rejected (canceled cannot become resolved)", () => {
    const result = assertTransition("canceled", "resolved");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("TERMINAL_STATE");
  });
});

describe("assertTransition — exhaustive coverage", () => {
  test("every (from, to) pair is explicitly allowed or explicitly rejected", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const result = assertTransition(from, to);
        if (from === to) {
          expect(result.success).toBe(false);
          if (!result.success) expect(result.error.code).toBe("SELF_TRANSITION");
        } else if (isTerminal(from)) {
          expect(result.success).toBe(false);
          if (!result.success) expect(result.error.code).toBe("TERMINAL_STATE");
        } else {
          const allowed = ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
          expect(result.success).toBe(allowed);
        }
      }
    }
  });
});
