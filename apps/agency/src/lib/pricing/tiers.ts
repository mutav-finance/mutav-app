import { SCORE_TIER_THRESHOLD } from "@convex/contracts/domain";

export const RENT_COVERAGE_MONTHS = 30;
export const EXIT_COVERAGE_MONTHS = 5;

export const SCORE_TIER_RATE = {
  high: 0.09,
  medium: 0.12,
  low: 0.15,
} as const;

export function rateForScore(score: number): number {
  if (score >= SCORE_TIER_THRESHOLD.high) return SCORE_TIER_RATE.high;
  if (score >= SCORE_TIER_THRESHOLD.medium) return SCORE_TIER_RATE.medium;
  return SCORE_TIER_RATE.low;
}

export const ACTIVATION_FEE_CENTS = 15_000;
