import { describe, expect, test } from "vitest";
import {
  checkReserveCapacity,
  coverRequirementCents,
  freeCapitalCents,
  isOfferHoldActive,
  isOfferHoldLapsed,
  isReserveBalanceFresh,
  isValidBalanceCents,
  isValidCoverageRatioBps,
  isValidOfferHoldDays,
  offerHoldExpiresAt,
  offerHoldStatus,
  requiredCoverageCents,
  resolveOfferHoldDays,
} from "./capacity";

describe("coverRequirementCents", () => {
  test("c × (coverage ceiling + exit-cost cap) from the terms snapshot", () => {
    // R$ 1.000 rent: 30× ceiling, 6× exit cap, c = 25%.
    expect(
      coverRequirementCents({
        terms: { coverageCeilingCents: 3_000_000, exitCostCapCents: 600_000 },
        coverageRatioBps: 2_500,
      }),
    ).toBe(900_000);
  });

  test("rounds up so the gate never under-reserves", () => {
    expect(
      coverRequirementCents({
        terms: { coverageCeilingCents: 1, exitCostCapCents: 0 },
        coverageRatioBps: 1,
      }),
    ).toBe(1);
    expect(
      coverRequirementCents({
        terms: { coverageCeilingCents: 3, exitCostCapCents: 0 },
        coverageRatioBps: 5_000,
      }),
    ).toBe(2);
  });
});

describe("requiredCoverageCents", () => {
  test("c × the on-risk book's remaining cover, rounded up", () => {
    expect(requiredCoverageCents({ onRiskCoverCents: 10_000_001, coverageRatioBps: 2_500 })).toBe(
      2_500_001,
    );
  });

  test("an empty book requires nothing", () => {
    expect(requiredCoverageCents({ onRiskCoverCents: 0, coverageRatioBps: 2_500 })).toBe(0);
  });
});

describe("freeCapitalCents", () => {
  test("balance − required coverage − active holds", () => {
    expect(
      freeCapitalCents({ balanceCents: 1_000, requiredCoverageCents: 300, activeHoldsCents: 200 }),
    ).toBe(500);
  });

  test("goes negative when the reserve already sits under its required coverage", () => {
    expect(
      freeCapitalCents({ balanceCents: 100, requiredCoverageCents: 300, activeHoldsCents: 0 }),
    ).toBe(-200);
  });
});

describe("checkReserveCapacity", () => {
  test("passes when the own requirement equals the free capital exactly", () => {
    expect(checkReserveCapacity({ freeCapitalCents: 900, ownRequirementCents: 900 })).toEqual({
      success: true,
      data: { remainingCents: 0 },
      message: "Fits the reserve's free capital",
    });
  });

  test("INSUFFICIENT_FREE_CAPITAL one cent short, with the shortfall", () => {
    expect(checkReserveCapacity({ freeCapitalCents: 899, ownRequirementCents: 900 })).toMatchObject(
      { success: false, error: { code: "INSUFFICIENT_FREE_CAPITAL", shortfallCents: 1 } },
    );
  });

  test("a negative free capital adds to the shortfall: it is the balance that is missing", () => {
    expect(checkReserveCapacity({ freeCapitalCents: -100, ownRequirementCents: 50 })).toMatchObject(
      { success: false, error: { shortfallCents: 150 } },
    );
  });

  test("the guarantee's own hold is excluded by the caller, so it does not count twice", () => {
    // Balance 2_000, required 500, another offer holds 300, this offer holds 900.
    const withoutOwnHold = freeCapitalCents({
      balanceCents: 2_000,
      requiredCoverageCents: 500,
      activeHoldsCents: 300,
    });
    const withOwnHold = freeCapitalCents({
      balanceCents: 2_000,
      requiredCoverageCents: 500,
      activeHoldsCents: 1_200,
    });
    expect(
      checkReserveCapacity({ freeCapitalCents: withoutOwnHold, ownRequirementCents: 900 }).success,
    ).toBe(true);
    expect(
      checkReserveCapacity({ freeCapitalCents: withOwnHold, ownRequirementCents: 900 }).success,
    ).toBe(false);
  });
});

describe("isReserveBalanceFresh", () => {
  const NOW = 10_000_000;
  const MINUTE = 60_000;

  test.each([
    ["taken just now", NOW, true],
    ["exactly 30 minutes old", NOW - 30 * MINUTE, true],
    ["one millisecond past 30 minutes", NOW - 30 * MINUTE - 1, false],
    ["stamped in the future", NOW + 1, false],
  ])("%s → %s", (_label, takenAt, fresh) => {
    expect(isReserveBalanceFresh({ balanceCents: 1, takenAt }, NOW)).toBe(fresh);
  });
});

describe("input bounds", () => {
  test.each([
    [2_500, true],
    [10_000, true],
    [1, true],
    [0, false],
    [10_001, false],
    [-1, false],
    [12.5, false],
  ])("coverage ratio %d bps valid = %s", (bps, valid) => {
    expect(isValidCoverageRatioBps(bps)).toBe(valid);
  });

  test.each([
    [0, true],
    [123_456, true],
    [-1, false],
    [1.5, false],
    [Number.MAX_SAFE_INTEGER + 1, false],
  ])("balance %d cents valid = %s", (cents, valid) => {
    expect(isValidBalanceCents(cents)).toBe(valid);
  });
});

describe("resolveOfferHoldDays", () => {
  test.each([
    [
      { contract: 3, agency: 5, product: 10, platform: 14 },
      { days: 3, source: "contract" },
    ],
    [
      { agency: 5, product: 10, platform: 14 },
      { days: 5, source: "agency" },
    ],
    [
      { product: 10, platform: 14 },
      { days: 10, source: "product" },
    ],
    [{ platform: 14 }, { days: 14, source: "platform" }],
    [{}, { days: 7, source: "default" }],
  ])("%o → %o", (settings, expected) => {
    expect(resolveOfferHoldDays(settings)).toEqual(expected);
  });

  test.each([
    [1, true],
    [7, true],
    [90, true],
    [0, false],
    [91, false],
    [2.5, false],
    [Number.NaN, false],
  ])("%d days valid = %s", (days, valid) => {
    expect(isValidOfferHoldDays(days)).toBe(valid);
  });

  test("the expiry is the hold period after the send", () => {
    expect(offerHoldExpiresAt({ sentAt: 1_000, holdDays: 7 })).toBe(1_000 + 7 * 86_400_000);
  });
});

describe("offer hold activity", () => {
  const NOW = 10_000;

  test.each([
    ["inside its period", { expiresAt: NOW + 1 }, true, false, "active"],
    ["at its expiry", { expiresAt: NOW }, false, true, "lapsed"],
    ["past its expiry", { expiresAt: NOW - 1 }, false, true, "lapsed"],
    [
      "past its expiry but signed in time",
      { expiresAt: NOW - 1, signedAt: NOW - 2 },
      true,
      false,
      "active",
    ],
    ["released", { expiresAt: NOW + 1, releasedAt: NOW - 1 }, false, false, "released"],
  ])("%s: active=%s lapsed=%s status=%s", (_label, hold, active, lapsed, status) => {
    expect(isOfferHoldActive(hold, NOW)).toBe(active);
    expect(isOfferHoldLapsed(hold, NOW)).toBe(lapsed);
    expect(offerHoldStatus(hold, NOW)).toBe(status);
  });

  test("no hold at all", () => {
    expect(offerHoldStatus(null, NOW)).toBe("none");
  });
});
