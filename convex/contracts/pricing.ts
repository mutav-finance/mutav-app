import { CONTRACT_PLAN, SCORE_TIER, type ContractPlan, type ScoreTier } from "./domain";

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
  /** Monthly premium the `plus` plan adds for the seguro prestamista. */
  prestamistaPremiumCents: number;
  /** Broker commission rate applied to the prestamista premium (distinct from
   * `commissionRate`, which applies to the score-driven taxa portion). */
  prestamistaCommissionRate: number;
};

/**
 * The active pricing table. Today these are the canonical constants; #83 turns
 * this into a versioned row read from the DB and passed in as the `table`
 * argument, at which point this constant becomes the bootstrap default.
 */
export const DEFAULT_PRICING_TABLE: PricingTable = {
  tierRate: { bom: 0.09, regular: 0.12, ruim: 0.15 },
  coverageCeilingMultiplier: 30,
  exitCostMultiplier: 6,
  activationFeeCents: 15_000,
  commissionRate: 0.015,
  // MOCK — R$ 12,80. Real premium is pending the corretora de seguros (needs
  // the CNPJ to open the seguro prestamista); swap this one number when it lands.
  prestamistaPremiumCents: 1_280,
  prestamistaCommissionRate: 0.25,
};

export type PriceContractInput = {
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  tier: PriceableTier;
  plan: ContractPlan;
};

export type PricedContract = {
  /** Total monthly fee: the score-driven taxa plus the plan's prestamista premium. */
  feeCents: number;
  /** Score-driven portion (rent × tier rate). */
  taxaFeeCents: number;
  /** Plan-driven portion (prestamista premium; 0 unless the plan is `plus`). */
  prestamistaFeeCents: number;
  oneTimeActivationFeeCents: number;
  availableGuaranteeCents: number;
  totalRentCents: number;
};

export function priceContract(
  input: PriceContractInput,
  table: PricingTable = DEFAULT_PRICING_TABLE,
): PricedContract {
  const taxaFeeCents = Math.round(input.rentCents * table.tierRate[input.tier]);
  const prestamistaFeeCents = input.plan === CONTRACT_PLAN.PLUS ? table.prestamistaPremiumCents : 0;
  return {
    feeCents: taxaFeeCents + prestamistaFeeCents,
    taxaFeeCents,
    prestamistaFeeCents,
    oneTimeActivationFeeCents: table.activationFeeCents,
    availableGuaranteeCents: input.rentCents * table.coverageCeilingMultiplier,
    totalRentCents: input.rentCents + input.condoCents + input.otherFeesCents,
  };
}

/** The taxa/prestamista split of a persisted contract's monthly fee, recovered
 * from the stored fee + plan. Used where only the contract row is on hand.
 *
 * The premium is clamped to the stored fee so the split never goes negative and
 * always reconciles to `feeCents` — a defensive guard for the case where the
 * premium is raised above a fee that was stored under the old (lower) premium.
 * The durable fix (snapshotting the price on the contract) is #83. */
export function feeBreakdown(
  rental: { feeCents: number; plan: ContractPlan },
  table: PricingTable = DEFAULT_PRICING_TABLE,
): { taxaFeeCents: number; prestamistaFeeCents: number } {
  const prestamistaFeeCents =
    rental.plan === CONTRACT_PLAN.PLUS
      ? Math.min(table.prestamistaPremiumCents, rental.feeCents)
      : 0;
  return { taxaFeeCents: rental.feeCents - prestamistaFeeCents, prestamistaFeeCents };
}

export type CommissionSplit = {
  /** Broker commission rounded to whole cents. */
  commissionCents: number;
  /** What the payer owes: fee + commission. Guaranteed additive. */
  totalCents: number;
};

/**
 * Broker commission on the two fee portions, at their distinct rates: the
 * score-driven taxa at `commissionRate`, the plan-driven prestamista premium at
 * `prestamistaCommissionRate`. `totalCents` is derived by addition so
 * `total === fee + commission` holds for every input.
 */
export function splitCommission(
  { taxaFeeCents, prestamistaFeeCents }: { taxaFeeCents: number; prestamistaFeeCents: number },
  table: PricingTable = DEFAULT_PRICING_TABLE,
): CommissionSplit {
  const commissionCents =
    Math.round(taxaFeeCents * table.commissionRate) +
    Math.round(prestamistaFeeCents * table.prestamistaCommissionRate);
  const feeCents = taxaFeeCents + prestamistaFeeCents;
  return {
    commissionCents,
    totalCents: feeCents + commissionCents,
  };
}
