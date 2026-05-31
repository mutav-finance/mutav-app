import { SCORE_TIER_THRESHOLD } from "@convex/contracts/domain";

export type RentMultiplier = "24x" | "36x" | "48x";
export type ExitCostMultiplier = "3x" | "5x" | "7x";

export const RENT_MULTIPLIERS: readonly RentMultiplier[] = ["24x", "36x", "48x"] as const;
export const EXIT_COST_MULTIPLIERS: readonly ExitCostMultiplier[] = ["3x", "5x", "7x"] as const;

export const SCORE_TIER_RATE = {
  high: 0.075,
  medium: 0.1,
  low: 0.125,
} as const;

export function rateForScore(score: number): number {
  if (score >= SCORE_TIER_THRESHOLD.high) return SCORE_TIER_RATE.high;
  if (score >= SCORE_TIER_THRESHOLD.medium) return SCORE_TIER_RATE.medium;
  return SCORE_TIER_RATE.low;
}

export const COVERAGE_MULT: Record<RentMultiplier, number> = {
  "24x": 1.0,
  "36x": 1.05,
  "48x": 1.1,
};

export const EXIT_MULT: Record<ExitCostMultiplier, number> = {
  "3x": 1.0,
  "5x": 1.02,
  "7x": 1.05,
};

export const RENT_MULT_MONTHS: Record<RentMultiplier, number> = {
  "24x": 24,
  "36x": 36,
  "48x": 48,
};

export const EXIT_MULT_MONTHS: Record<ExitCostMultiplier, number> = {
  "3x": 3,
  "5x": 5,
  "7x": 7,
};

export const ACTIVATION_FEE_CENTS = 15_000;
