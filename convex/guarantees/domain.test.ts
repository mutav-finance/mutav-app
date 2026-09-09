import { describe, expect, it, test } from "vitest";
import {
  expiringRenewalBounds,
  getUrgencyTier,
  GUARANTEE_STATE,
  INSURED_STATES,
  isInsured,
  GUARANTEE_STATES,
  tierForScore,
  urgencySortKey,
} from "./domain";

const REFERENCE_DATE = "2026-07-18";

describe("getUrgencyTier", () => {
  it("returns inactive for closed regardless of date", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.CLOSED,
        nextRenewalDate: "2026-08-18",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("inactive");
  });

  it("returns drafted for a draft regardless of date", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.DRAFTED,
        nextRenewalDate: "2026-07-17",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("drafted");
  });

  test.each(INSURED_STATES)("returns overdue for an insured %s renewing yesterday", (status) => {
    expect(
      getUrgencyTier({ status, nextRenewalDate: "2026-07-17", referenceDate: REFERENCE_DATE }),
    ).toBe("overdue");
  });

  it("returns expiring at 0 days (today)", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.ACTIVE,
        nextRenewalDate: "2026-07-18",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("expiring");
  });

  it("returns expiring at 30 days (upper bound)", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.ACTIVE,
        nextRenewalDate: "2026-08-17",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("expiring");
  });

  it("returns critical at 31 days", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.IN_ARREARS,
        nextRenewalDate: "2026-08-18",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("critical");
  });

  it("returns critical at 60 days (upper bound)", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.ACTIVE,
        nextRenewalDate: "2026-09-16",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("critical");
  });

  it("returns warning at 61 days", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.COVER_COMMITTED,
        nextRenewalDate: "2026-09-17",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("warning");
  });

  it("returns warning at 120 days (upper bound)", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.ACTIVE,
        nextRenewalDate: "2026-11-15",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("warning");
  });

  it("returns ok at 121 days", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.IN_EVICTION,
        nextRenewalDate: "2026-11-16",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("ok");
  });

  it("returns inactive for an unparseable renewal date", () => {
    expect(
      getUrgencyTier({
        status: GUARANTEE_STATE.ACTIVE,
        nextRenewalDate: "not-a-date",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("inactive");
  });
});

describe("urgencySortKey", () => {
  it("orders overdue first and inactive last", () => {
    expect(urgencySortKey("overdue")).toBe(0);
    expect(urgencySortKey("expiring")).toBe(1);
    expect(urgencySortKey("critical")).toBe(2);
    expect(urgencySortKey("warning")).toBe(3);
    expect(urgencySortKey("drafted")).toBe(4);
    expect(urgencySortKey("ok")).toBe(5);
    expect(urgencySortKey("inactive")).toBe(6);
  });
});

describe("expiringRenewalBounds", () => {
  it("spans [today, today + 60 days] in UTC YYYY-MM-DD", () => {
    expect(expiringRenewalBounds(REFERENCE_DATE)).toEqual({
      gte: "2026-07-18",
      lte: "2026-09-16",
    });
  });
});

describe("INSURED_STATES / isInsured", () => {
  it("is every state except drafted and closed", () => {
    expect(new Set(INSURED_STATES)).toEqual(
      new Set(["active", "in_arrears", "default_verified", "cover_committed", "in_eviction"]),
    );
    const outside = GUARANTEE_STATES.filter((state) => !INSURED_STATES.includes(state));
    expect(new Set(outside)).toEqual(new Set(["drafted", "closed"]));
  });

  test.each(GUARANTEE_STATES)("isInsured(%s) matches membership", (status) => {
    expect(isInsured({ status })).toBe(INSURED_STATES.includes(status));
  });
});

describe("tierForScore", () => {
  test.each([
    [800, "bom"],
    [799, "regular"],
    [600, "regular"],
    [599, "ruim"],
    [400, "ruim"],
    [399, "negado"],
  ] as const)("score %i → %s", (score, tier) => {
    expect(tierForScore(score)).toBe(tier);
  });
});
