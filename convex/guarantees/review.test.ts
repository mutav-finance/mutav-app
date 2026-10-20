import { describe, expect, test } from "vitest";
import {
  ALLOWED_REVIEW_TRANSITIONS,
  assertReviewTransition,
  isValidStaffFeeRateBps,
  provisionalPricingTier,
  rateToBps,
  REVIEW_STATUSES,
  reviewStatusForInsertedState,
  type ReviewStatus,
} from "./review";

describe("review status value object", () => {
  test("lists the six sub-statuses in pipeline order", () => {
    expect(REVIEW_STATUSES).toEqual([
      "editing",
      "analysis_requested",
      "accepted",
      "awaiting_signature",
      "signed",
      "refused",
    ]);
  });

  test("the transition map has one entry per status", () => {
    expect(Object.keys(ALLOWED_REVIEW_TRANSITIONS).sort()).toEqual([...REVIEW_STATUSES].sort());
  });
});

describe("assertReviewTransition — exhaustive 6×6 matrix", () => {
  const legal: Array<[ReviewStatus, ReviewStatus]> = [
    ["editing", "analysis_requested"],
    ["analysis_requested", "accepted"],
    ["analysis_requested", "refused"],
    ["accepted", "awaiting_signature"],
    ["awaiting_signature", "signed"],
  ];
  const legalKeys = new Set(legal.map(([from, to]) => `${from}|${to}`));
  const terminal: ReadonlySet<ReviewStatus> = new Set(["signed", "refused"]);

  const matrix = REVIEW_STATUSES.flatMap((from) =>
    REVIEW_STATUSES.map((to): [ReviewStatus, ReviewStatus] => [from, to]),
  );

  test("covers all 36 pairs", () => {
    expect(matrix).toHaveLength(36);
  });

  test.each(legal)("%s → %s is allowed", (from, to) => {
    expect(assertReviewTransition(from, to)).toEqual({
      success: true,
      data: { from, to },
      message: `Review move ${from} -> ${to} approved.`,
    });
  });

  test.each(REVIEW_STATUSES.map((status) => [status] as const))(
    "%s → itself is REVIEW_SELF_TRANSITION",
    (status) => {
      const result = assertReviewTransition(status, status);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe("REVIEW_SELF_TRANSITION");
    },
  );

  test.each(matrix.filter(([from, to]) => from !== to && terminal.has(from)))(
    "terminal %s → %s is REVIEW_TERMINAL",
    (from, to) => {
      const result = assertReviewTransition(from, to);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe("REVIEW_TERMINAL");
    },
  );

  test.each(
    matrix.filter(
      ([from, to]) => from !== to && !terminal.has(from) && !legalKeys.has(`${from}|${to}`),
    ),
  )("%s → %s is REVIEW_ILLEGAL_TRANSITION", (from, to) => {
    const result = assertReviewTransition(from, to);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("REVIEW_ILLEGAL_TRANSITION");
  });

  test("an accepted draft cannot go back to editing and a refused one cannot reopen", () => {
    expect(assertReviewTransition("accepted", "editing").success).toBe(false);
    expect(assertReviewTransition("refused", "editing").success).toBe(false);
    expect(assertReviewTransition("refused", "analysis_requested").success).toBe(false);
  });
});

describe("staff fee rate bounds", () => {
  test.each([
    [100, true],
    [1_300, true],
    [3_000, true],
    [99, false],
    [3_001, false],
    [0, false],
    [-500, false],
    [1_250.5, false],
    [Number.NaN, false],
  ])("%d bps valid = %s", (bps, valid) => {
    expect(isValidStaffFeeRateBps(bps)).toBe(valid);
  });

  test("rateToBps rounds a catalog fraction to whole basis points", () => {
    expect(rateToBps(0.09)).toBe(900);
    expect(rateToBps(0.12)).toBe(1_200);
    expect(rateToBps(0.15)).toBe(1_500);
  });
});

describe("provisionalPricingTier", () => {
  test.each([
    ["bom", "bom"],
    ["regular", "regular"],
    ["ruim", "ruim"],
    ["negado", "ruim"],
  ] as const)("%s is quoted at %s", (tier, quoted) => {
    expect(provisionalPricingTier(tier)).toBe(quoted);
  });
});

describe("reviewStatusForInsertedState", () => {
  test.each([
    [{ state: "drafted" as const }, "editing"],
    [{ state: "active" as const }, "signed"],
    [{ state: "in_eviction" as const }, "signed"],
    [{ state: "closed" as const, closeReason: "end_of_lease" as const }, "signed"],
    [{ state: "closed" as const, closeReason: "canceled_pre_activation" as const }, "editing"],
    [{ state: "closed" as const, closeReason: "underwriting_refused" as const }, "refused"],
  ])("%o → %s", (input, expected) => {
    expect(reviewStatusForInsertedState(input)).toBe(expected);
  });
});
