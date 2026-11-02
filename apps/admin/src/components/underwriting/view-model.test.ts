import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import {
  daysWaiting,
  errorMessageKey,
  outcomeForResult,
  outcomeForThrown,
  parseHoldDaysInput,
  parseRatePercent,
  RATE_BOUNDS_PERCENT,
  ratePercentInput,
  UNDERWRITING_ERROR_CODES,
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

describe("parseHoldDaysInput", () => {
  it.each([
    ["", undefined],
    ["  ", undefined],
    ["7", 7],
    [" 1 ", 1],
    ["90", 90],
    ["0", null],
    ["91", null],
    ["2.5", null],
    ["abc", null],
    ["-3", null],
  ] as const)("%j → %s", (input, expected) => {
    expect(parseHoldDaysInput(input)).toBe(expected);
  });
});

describe("underwriting messages", () => {
  it.each([
    ["en", en],
    ["pt-BR", ptBR],
  ] as const)("%s carries a message for every error code", (_locale, messages) => {
    const errors: Record<string, string> = messages.underwriting.errors;
    for (const code of [...UNDERWRITING_ERROR_CODES, "FORBIDDEN", "unexpected"]) {
      expect(errors[code]).toEqual(expect.any(String));
    }
  });
});
