import { describe, expect, test } from "vitest";
import { canTransitionOnboarding } from "./domain";
import type { OnboardingState } from "./domain";

const STATES: readonly OnboardingState[] = [
  "not_started",
  "in_progress",
  "submitted",
  "under_review",
  "active",
  "rejected",
];

const ALLOWED: ReadonlyArray<readonly [OnboardingState, OnboardingState]> = [
  ["not_started", "in_progress"],
  ["in_progress", "submitted"],
  ["submitted", "under_review"],
  ["submitted", "active"],
  ["submitted", "rejected"],
  ["under_review", "active"],
  ["under_review", "rejected"],
  ["rejected", "in_progress"],
];

const isAllowed = (from: OnboardingState, to: OnboardingState) =>
  ALLOWED.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to);

const ALL_PAIRS = STATES.flatMap((from) => STATES.map((to) => [from, to] as const));

describe("canTransitionOnboarding", () => {
  test.each(ALLOWED)("%s → %s is allowed", (from, to) => {
    expect(canTransitionOnboarding({ from, to })).toBe(true);
  });

  test.each(ALL_PAIRS.filter(([from, to]) => !isAllowed(from, to)))(
    "%s → %s is rejected",
    (from, to) => {
      expect(canTransitionOnboarding({ from, to })).toBe(false);
    },
  );

  test("active is terminal", () => {
    for (const to of STATES) {
      expect(canTransitionOnboarding({ from: "active", to })).toBe(false);
    }
  });
});
