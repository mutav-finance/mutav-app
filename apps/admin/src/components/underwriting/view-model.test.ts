import { describe, expect, it } from "vitest";
import {
  daysWaiting,
  errorMessageKey,
  outcomeForResult,
  outcomeForThrown,
  parseRatePercent,
  RATE_BOUNDS_PERCENT,
  ratePercentInput,
} from "./view-model";

describe("parseRatePercent", () => {
  it.each([
    ["13", 1_300],
    ["12,5", 1_250],
    ["12.75", 1_275],
    [" 1 ", 100],
    ["30", 3_000],
  ])("%j → %i bps", (input, bps) => {
    expect(parseRatePercent(input)).toBe(bps);
  });

  it.each(["", "abc", "0.99", "30.01", "31", "-5", "12,345", "100"])("%j is refused", (input) => {
    expect(parseRatePercent(input)).toBeNull();
  });

  it("exposes the server bounds as percents", () => {
    expect(RATE_BOUNDS_PERCENT).toEqual({ min: 1, max: 30 });
  });
});

describe("ratePercentInput", () => {
  it("prefills the quoted rate as a percent string", () => {
    expect(ratePercentInput(1_500)).toBe("15");
    expect(ratePercentInput(1_250)).toBe("12.5");
  });
});

describe("outcomes", () => {
  it("maps success per action", () => {
    expect(outcomeForResult({ action: "accept", result: { success: true } })).toEqual({
      kind: "success",
      messageKey: "toast.accepted",
    });
    expect(outcomeForResult({ action: "send", result: { success: true } }).messageKey).toBe(
      "toast.sent",
    );
  });

  it("maps a known error code and falls back on an unknown one", () => {
    expect(errorMessageKey("INVALID_FEE_RATE")).toBe("errors.INVALID_FEE_RATE");
    expect(errorMessageKey("REVIEW_ILLEGAL_TRANSITION")).toBe("errors.REVIEW_ILLEGAL_TRANSITION");
    expect(errorMessageKey("WHATEVER")).toBe("errors.unexpected");
  });

  it("reads a role-gate throw as forbidden", () => {
    expect(outcomeForThrown(new Error("Requires 'compliance' role or higher")).messageKey).toBe(
      "errors.FORBIDDEN",
    );
    expect(outcomeForThrown(new Error("boom")).messageKey).toBe("errors.unexpected");
  });
});

describe("daysWaiting", () => {
  it("floors elapsed days and never goes negative", () => {
    const now = Date.parse("2026-10-05T12:00:00.000Z");
    expect(daysWaiting({ requestedAt: "2026-10-03T13:00:00.000Z", now })).toBe(1);
    expect(daysWaiting({ requestedAt: "2026-10-06T00:00:00.000Z", now })).toBe(0);
  });
});
