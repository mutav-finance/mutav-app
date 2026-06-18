import { describe, expect, test } from "vitest";
import { windowKeyForDay, deriveCreditAnalysis, type ProviderSignal } from "./domain";

const DAY = 24 * 60 * 60 * 1000;

describe("windowKeyForDay", () => {
  test("two timestamps in the same UTC day share a key", () => {
    expect(windowKeyForDay(5 * DAY + 1)).toBe(windowKeyForDay(5 * DAY + DAY - 1));
  });
  test("adjacent days differ", () => {
    expect(windowKeyForDay(5 * DAY)).not.toBe(windowKeyForDay(6 * DAY));
  });
});

describe("deriveCreditAnalysis", () => {
  const ok = (score: number): ProviderSignal => ({
    status: "ok",
    provider: "mock",
    capability: "credit_score",
    normalized: { score, scale: 1000 },
  });
  const err: ProviderSignal = {
    status: "error",
    provider: "bigdatacorp",
    capability: "credit_score",
    error: "boom",
  };

  test("no ok signals → unavailable", () => {
    expect(deriveCreditAnalysis([err]).status).toBe("unavailable");
  });
  test("maps the primary ok signal's score to a tier", () => {
    const out = deriveCreditAnalysis([ok(850), err]);
    expect(out).toEqual({ status: "ok", score: 850, tier: "bom" });
  });
  test("score at the high threshold maps to 'bom'", () => {
    const out = deriveCreditAnalysis([ok(800)]);
    expect(out).toEqual({ status: "ok", score: 800, tier: "bom" });
  });
});
