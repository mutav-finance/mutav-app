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
 * capacity. `DEFAULT_PRICING_TABLE` is the seed constant for the default
 * product and the fallback for client-side previews before a product loads.
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
  setupInstallments: 1,
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

export function priceGuarantee(input: PriceGuaranteeInput, terms: PricingTable): PricedGuarantee {
  const taxaFeeCents = Math.round(input.rentCents * terms.tierRate[input.tier]);
  const prestamistaFeeCents =
    input.plan === GUARANTEE_PLAN.PLUS ? terms.prestamistaPremiumCents : 0;
  const coverageCeilingCents = input.rentCents * terms.coverageCeilingMultiplier;
  const exitCostCapCents = input.rentCents * terms.exitCostMultiplier;
  return {
    terms: {
      productSlug: input.productSlug,
      plan: input.plan,
      rentCents: input.rentCents,
      feeCents: taxaFeeCents + prestamistaFeeCents,
      taxaFeeCents,
      prestamistaFeeCents,
      oneTimeActivationFeeCents: terms.activationFeeCents,
      setupInstallments: terms.setupInstallments,
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

/**
 * The taxa/prestamista split of a monthly fee, recovered from the fee + plan.
 * A stored `terms` snapshot already carries both portions; this exists for
 * callers that only hold a fee and a plan (the wizard preview).
 *
 * The premium is clamped to the fee so the split never goes negative and
 * always reconciles to `feeCents`.
 */
export function feeBreakdown(
  priced: { feeCents: number; plan: GuaranteePlan },
  table: PricingTable = DEFAULT_PRICING_TABLE,
): { taxaFeeCents: number; prestamistaFeeCents: number } {
  const prestamistaFeeCents =
    priced.plan === GUARANTEE_PLAN.PLUS
      ? Math.min(table.prestamistaPremiumCents, priced.feeCents)
      : 0;
  return { taxaFeeCents: priced.feeCents - prestamistaFeeCents, prestamistaFeeCents };
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
