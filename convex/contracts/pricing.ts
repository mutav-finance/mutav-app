import { SCORE_TIER, type ScoreTier } from "./domain";

/**
 * Contract pricing. Lives in the backend (shared by every app) so the wizard
 * preview (client, via `@convex/contracts/pricing`) and the `create` mutation
 * (server) price through the exact same code — the fee a broker sees is the fee
 * that gets billed.
 */

/**
 * Score tiers that can be priced. `negado` has no rate: a denied tenant is
 * rejected before pricing (see the `create` mutation), so it is excluded from
 * the rate table at the type level — pricing a denied tier is a compile error.
 */
export type PriceableTier = Exclude<ScoreTier, typeof SCORE_TIER.NEGADO>;

export type PricingTable = {
  tierRate: Record<PriceableTier, number>;
  coverageCeilingMultiplier: number;
  exitCostMultiplier: number;
  activationFeeCents: number;
  commissionRate: number;
};

/**
 * The active pricing table. Today these are the canonical constants; #83 turns
 * this into a versioned row read from the DB and passed in as the `table`
 * argument, at which point this constant becomes the bootstrap default.
 */
export const DEFAULT_PRICING_TABLE: PricingTable = {
  tierRate: { bom: 0.09, regular: 0.12, ruim: 0.15 },
  coverageCeilingMultiplier: 30,
  exitCostMultiplier: 5,
  activationFeeCents: 15_000,
  commissionRate: 0.015,
};

export type PriceContractInput = {
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  tier: PriceableTier;
};

export type PricedContract = {
  feeCents: number;
  oneTimeActivationFeeCents: number;
  availableGuaranteeCents: number;
  totalRentCents: number;
};

export function priceContract(
  input: PriceContractInput,
  table: PricingTable = DEFAULT_PRICING_TABLE,
): PricedContract {
  const feeCents = Math.round(input.rentCents * table.tierRate[input.tier]);
  return {
    feeCents,
    oneTimeActivationFeeCents: table.activationFeeCents,
    availableGuaranteeCents: input.rentCents * table.coverageCeilingMultiplier,
    totalRentCents: input.rentCents + input.condoCents + input.otherFeesCents,
  };
}

export type CommissionSplit = {
  /** Broker commission rounded to whole cents. */
  commissionCents: number;
  /** What the payer owes: fee + commission. Guaranteed additive. */
  totalCents: number;
};

/**
 * Split a base fee into its commission component and the total owed. Derives
 * `totalCents` by addition so `total === fee + commission` holds for every
 * input — the `Math.round(fee * 1.015)` form does not.
 */
export function splitCommission(
  feeCents: number,
  table: PricingTable = DEFAULT_PRICING_TABLE,
): CommissionSplit {
  const commissionCents = Math.round(feeCents * table.commissionRate);
  return {
    commissionCents,
    totalCents: feeCents + commissionCents,
  };
}
