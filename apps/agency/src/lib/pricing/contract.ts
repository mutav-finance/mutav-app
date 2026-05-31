import {
  ACTIVATION_FEE_CENTS,
  COVERAGE_MULT,
  EXIT_MULT,
  type ExitCostMultiplier,
  RENT_MULT_MONTHS,
  type RentMultiplier,
  rateForScore,
} from "./tiers";

export type PriceContractInput = {
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  score: number;
  rentMultiplier: RentMultiplier;
  exitCostMultiplier: ExitCostMultiplier;
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
 */
export function priceContract(input: PriceContractInput): PricedContract {
  const feeRate = rateForScore(input.score);
  const feeCents = Math.round(
    input.rentCents *
      feeRate *
      COVERAGE_MULT[input.rentMultiplier] *
      EXIT_MULT[input.exitCostMultiplier],
  );
  return {
    feeCents,
    oneTimeActivationFeeCents: ACTIVATION_FEE_CENTS,
    availableGuaranteeCents: input.rentCents * RENT_MULT_MONTHS[input.rentMultiplier],
    totalRentCents: input.rentCents + input.condoCents + input.otherFeesCents,
  };
}
