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
  test("exposes the three notice states aligned with the agency UI", () => {
    expect(DELINQUENCY_STATUSES).toEqual(["pendencia_aberta", "entregue", "cancelado"]);
  });

  test("DELINQUENCY_STATUS keys mirror the values (upper snake)", () => {
    expect(DELINQUENCY_STATUS.PENDENCIA_ABERTA).toBe("pendencia_aberta");
    expect(DELINQUENCY_STATUS.ENTREGUE).toBe("entregue");
    expect(DELINQUENCY_STATUS.CANCELADO).toBe("cancelado");
  });

  test("entregue and cancelado are terminal; pendencia_aberta is not", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(["cancelado", "entregue"]);
    expect(isTerminal("entregue")).toBe(true);
    expect(isTerminal("cancelado")).toBe(true);
    expect(isTerminal("pendencia_aberta")).toBe(false);
  });
});

describe("ALLOWED_TRANSITIONS — the two legal edges", () => {
  test("pendencia_aberta -> entregue is allowed (resolved: tenant cured or cover committed)", () => {
    const result = assertTransition("pendencia_aberta", "entregue");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ from: "pendencia_aberta", to: "entregue" });
  });

  test("pendencia_aberta -> cancelado is allowed (agency withdrew or staff dismissed)", () => {
    const result = assertTransition("pendencia_aberta", "cancelado");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ from: "pendencia_aberta", to: "cancelado" });
  });

  test("ALLOWED_TRANSITIONS map covers exactly the two edges above", () => {
    const flattened: Array<[string, string]> = [];
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of tos) flattened.push([from, to]);
    }
    expect(flattened.sort()).toEqual(
      [
        ["pendencia_aberta", "cancelado"],
        ["pendencia_aberta", "entregue"],
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

  test("entregue is terminal — no outbound edges", () => {
    for (const target of ALL_STATUSES) {
      if (target === "entregue") continue;
      const result = assertTransition("entregue", target);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe("TERMINAL_STATE");
    }
  });

  test("cancelado is terminal — no outbound edges", () => {
    for (const target of ALL_STATUSES) {
      if (target === "cancelado") continue;
      const result = assertTransition("cancelado", target);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe("TERMINAL_STATE");
    }
  });

  test("entregue -> cancelado rejected (both terminal, resolved cannot be cancelled)", () => {
    const result = assertTransition("entregue", "cancelado");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("TERMINAL_STATE");
  });

  test("cancelado -> entregue rejected (cancelled cannot become resolved)", () => {
    const result = assertTransition("cancelado", "entregue");
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
