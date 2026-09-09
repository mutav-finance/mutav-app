// @vitest-environment edge-runtime
import { describe, expect, test } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  GUARANTEE_STATE,
  GUARANTEE_STATES,
  TERMINAL_STATES,
  assertTransition,
  isTerminal,
} from "./machine";

const ALL_STATES = GUARANTEE_STATES;

describe("GUARANTEE_STATE constants", () => {
  test("exposes all seven states from the scenarios doc", () => {
    expect(GUARANTEE_STATES).toEqual([
      "drafted",
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
      "closed",
    ]);
  });

  test("GUARANTEE_STATE keys are the uppercase mirror of values", () => {
    for (const state of GUARANTEE_STATES) {
      expect(GUARANTEE_STATE[state.toUpperCase() as keyof typeof GUARANTEE_STATE]).toBe(state);
    }
  });

  test("closed is the only terminal state", () => {
    expect([...TERMINAL_STATES]).toEqual(["closed"]);
    expect(isTerminal("closed")).toBe(true);
    expect(isTerminal("active")).toBe(false);
    expect(isTerminal("in_eviction")).toBe(false);
    expect(isTerminal("cover_committed")).toBe(false);
  });
});

describe("ALLOWED_TRANSITIONS — every valid edge per contract-default-scenarios.md", () => {
  const validEdges: Array<[string, string]> = [
    // drafted
    ["drafted", "active"],
    ["drafted", "closed"],

    // active
    ["active", "in_arrears"],
    ["active", "closed"],
    ["active", "in_eviction"],

    // in_arrears
    ["in_arrears", "active"],
    ["in_arrears", "default_verified"],
    ["in_arrears", "closed"],
    ["in_arrears", "in_eviction"],

    // default_verified
    ["default_verified", "cover_committed"],
    ["default_verified", "active"],
    ["default_verified", "closed"],
    ["default_verified", "in_eviction"],

    // cover_committed — the crux of the scenarios doc's correction
    ["cover_committed", "active"],
    ["cover_committed", "in_arrears"],
    ["cover_committed", "closed"],
    ["cover_committed", "in_eviction"],

    // in_eviction
    ["in_eviction", "closed"],
  ];

  test.each(validEdges)("%s -> %s is allowed", (from, to) => {
    const result = assertTransition(from as never, to as never);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ from, to });
    }
  });

  test("ALLOWED_TRANSITIONS map covers exactly the valid edges above", () => {
    const flattened: Array<[string, string]> = [];
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of tos) {
        flattened.push([from, to]);
      }
    }
    expect(flattened.sort()).toEqual(validEdges.map((e) => [...e]).sort());
  });
});

describe("assertTransition — illegal moves rejected", () => {
  test("self-transitions rejected with SELF_TRANSITION", () => {
    for (const state of ALL_STATES) {
      const result = assertTransition(state, state);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("SELF_TRANSITION");
      }
    }
  });

  test("closed has no outbound edges (every closed -> X is rejected)", () => {
    for (const target of ALL_STATES) {
      if (target === "closed") continue;
      const result = assertTransition("closed", target);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TERMINAL_STATE");
      }
    }
  });

  test("active -> default_verified rejected (must go through in_arrears)", () => {
    const result = assertTransition("active", "default_verified");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  test("active -> cover_committed rejected (must go through in_arrears + default_verified)", () => {
    const result = assertTransition("active", "cover_committed");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  test("drafted -> in_arrears rejected (must activate first)", () => {
    const result = assertTransition("drafted", "in_arrears");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  test("drafted -> in_eviction rejected (never activated)", () => {
    const result = assertTransition("drafted", "in_eviction");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  test("in_eviction -> active rejected (evictions terminate to closed)", () => {
    const result = assertTransition("in_eviction", "active");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  test("cover_committed -> default_verified rejected (verified was the prior step)", () => {
    const result = assertTransition("cover_committed", "default_verified");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });
});

describe("assertTransition — scenarios-doc corrections", () => {
  test("cover_committed -> active supports cure-after-cover (receivable stays open)", () => {
    const result = assertTransition("cover_committed", "active");
    expect(result.success).toBe(true);
  });

  test("cover_committed -> in_arrears supports re-default after prior cover", () => {
    const result = assertTransition("cover_committed", "in_arrears");
    expect(result.success).toBe(true);
  });

  test("default_verified -> active supports cure before Mutav paid", () => {
    const result = assertTransition("default_verified", "active");
    expect(result.success).toBe(true);
  });

  test("any non-terminal state can enter in_eviction (except drafted)", () => {
    const nonTerminalPostActive = ["active", "in_arrears", "default_verified", "cover_committed"];
    for (const from of nonTerminalPostActive) {
      const result = assertTransition(from as never, "in_eviction");
      expect(result.success).toBe(true);
    }
  });
});

describe("assertTransition — exhaustive coverage", () => {
  test("every (from, to) pair is either explicitly allowed or explicitly rejected", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const result = assertTransition(from, to);
        if (from === to) {
          expect(result.success).toBe(false);
          if (!result.success) expect(result.error.code).toBe("SELF_TRANSITION");
        } else if (from === "closed") {
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
