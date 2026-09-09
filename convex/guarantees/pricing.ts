import {
  GUARANTEE_PLAN,
  type GuaranteeCapacity,
  type GuaranteePlan,
  type GuaranteeTerms,
  type PriceableTier,
} from "./domain";
import type { ProductTerms } from "../products/domain";

/**
 * Guarantee pricing. Lives in the backend (shared by every app) so the wizard
 * preview (client) and the `create` mutation (server) price through the exact
 * same code — the fee a broker sees is the fee that gets billed.
 *
 * Parameters come from a `products` row (`ProductTerms`); the output is the
 * immutable `terms` snapshot stored on the guarantee plus its initial
 * capacity. `DEFAULT_PRICING_TABLE` is only the seed constant for the default
 * product: every caller — the server mutation and the wizard preview alike —
 * passes the parameters it read from a `products` row.
 */

export type PricingTable = ProductTerms;

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

export type PriceGuaranteeInput = {
  rentCents: number;
  tier: PriceableTier;
  plan: GuaranteePlan;
  productSlug: string;
  /** ISO timestamp the snapshot is taken at; stored as `terms.appliedAt`. */
  appliedAt: string;
};

export type PricedGuarantee = {
  terms: GuaranteeTerms;
  capacity: GuaranteeCapacity;
};

/**
 * Every money figure is rounded to whole cents: multipliers are product data
 * and may be fractional once the catalog is admin-editable, and a fractional
 * ceiling would leak into `capacity` and the platform exposure aggregate.
 */
export function priceGuarantee(input: PriceGuaranteeInput, terms: PricingTable): PricedGuarantee {
  const taxaFeeCents = Math.round(input.rentCents * terms.tierRate[input.tier]);
  const prestamistaFeeCents =
    input.plan === GUARANTEE_PLAN.PLUS ? terms.prestamistaPremiumCents : 0;
  const coverageCeilingCents = Math.round(input.rentCents * terms.coverageCeilingMultiplier);
  const exitCostCapCents = Math.round(input.rentCents * terms.exitCostMultiplier);
  return {
    terms: {
      productSlug: input.productSlug,
      plan: input.plan,
      rentCents: input.rentCents,
      feeCents: taxaFeeCents + prestamistaFeeCents,
      taxaFeeCents,
      prestamistaFeeCents,
      oneTimeActivationFeeCents: terms.activationFeeCents,
      commissionRate: terms.commissionRate,
      prestamistaCommissionRate: terms.prestamistaCommissionRate,
      coverageCeilingMultiplier: terms.coverageCeilingMultiplier,
      exitCostMultiplier: terms.exitCostMultiplier,
      coverageCeilingCents,
      exitCostCapCents,
      appliedAt: input.appliedAt,
    },
    capacity: {
      ceilingCents: coverageCeilingCents,
      availableCents: coverageCeilingCents,
      reservedCents: 0,
    },
  };
}

export type CommissionSplit = {
  /** Broker commission rounded to whole cents. */
  commissionCents: number;
  /** What the payer owes: fee + commission. Guaranteed additive. */
  totalCents: number;
};

export type CommissionTerms = Pick<
  GuaranteeTerms,
  "taxaFeeCents" | "prestamistaFeeCents" | "commissionRate" | "prestamistaCommissionRate"
>;

/**
 * Broker commission on the two fee portions, at their distinct rates: the
 * score-driven taxa at `commissionRate`, the plan-driven prestamista premium at
 * `prestamistaCommissionRate`. Reads everything from the `terms` snapshot so
 * the commission owed on a sold guarantee never moves when the product is
 * edited. `totalCents` is derived by addition so `total === fee + commission`
 * holds for every input.
 */
export function splitCommission(terms: CommissionTerms): CommissionSplit {
  const commissionCents =
    Math.round(terms.taxaFeeCents * terms.commissionRate) +
    Math.round(terms.prestamistaFeeCents * terms.prestamistaCommissionRate);
  const feeCents = terms.taxaFeeCents + terms.prestamistaFeeCents;
  return {
    commissionCents,
    totalCents: feeCents + commissionCents,
  };
}
