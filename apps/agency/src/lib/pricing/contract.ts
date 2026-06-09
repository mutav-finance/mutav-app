import { ACTIVATION_FEE_CENTS, RENT_COVERAGE_MONTHS, rateForScore } from "./tiers";

export type PriceContractInput = {
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  score: number;
};

export type PricedContract = {
  feeCents: number;
  oneTimeActivationFeeCents: number;
  availableGuaranteeCents: number;
  totalRentCents: number;
};

/**
 * Single source of truth for contract pricing. Called identically from
 * the wizard preview (client) and the create mutation (server) so the
 * fee a user sees is the fee they get billed.
 *
 * Plan is fixed: 30x rent coverage, 5x exit coverage.
 * Fee rate is determined by score tier: bom=9%, regular=12%, ruim=15%.
 */
export function priceContract(input: PriceContractInput): PricedContract {
  const feeRate = rateForScore(input.score);
  const feeCents = Math.round(input.rentCents * feeRate);
  return {
    feeCents,
    oneTimeActivationFeeCents: ACTIVATION_FEE_CENTS,
    availableGuaranteeCents: input.rentCents * RENT_COVERAGE_MONTHS,
    totalRentCents: input.rentCents + input.condoCents + input.otherFeesCents,
  };
}
