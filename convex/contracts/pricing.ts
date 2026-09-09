// Temporary facade over the `@convex/contracts/pricing` symbols the wizard's
// client-side preview imports (`priceContract`, `splitCommission`,
// `DEFAULT_PRICING_TABLE`), with the pre-refactor signatures. Deleted in PR4.
import type { GuaranteePlan, PriceableTier } from "../guarantees/domain";
import {
  DEFAULT_PRICING_TABLE,
  priceGuarantee,
  splitCommission as splitGuaranteeCommission,
  type CommissionSplit,
  type PricingTable,
} from "../guarantees/pricing";
import { DEFAULT_PRODUCT_SLUG } from "../products/domain";

export { DEFAULT_PRICING_TABLE };

export type PriceContractInput = {
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  tier: PriceableTier;
  plan: GuaranteePlan;
};

export type PricedContract = {
  feeCents: number;
  taxaFeeCents: number;
  prestamistaFeeCents: number;
  oneTimeActivationFeeCents: number;
  availableGuaranteeCents: number;
  totalRentCents: number;
};

export function priceContract(
  input: PriceContractInput,
  table: PricingTable = DEFAULT_PRICING_TABLE,
): PricedContract {
  const { terms, capacity } = priceGuarantee(
    {
      rentCents: input.rentCents,
      tier: input.tier,
      plan: input.plan,
      productSlug: DEFAULT_PRODUCT_SLUG,
      appliedAt: new Date().toISOString(),
    },
    table,
  );
  return {
    feeCents: terms.feeCents,
    taxaFeeCents: terms.taxaFeeCents,
    prestamistaFeeCents: terms.prestamistaFeeCents,
    oneTimeActivationFeeCents: terms.oneTimeActivationFeeCents,
    availableGuaranteeCents: capacity.availableCents,
    totalRentCents: input.rentCents + input.condoCents + input.otherFeesCents,
  };
}

export function splitCommission(
  fee: { taxaFeeCents: number; prestamistaFeeCents: number },
  table: PricingTable = DEFAULT_PRICING_TABLE,
): CommissionSplit {
  return splitGuaranteeCommission({
    taxaFeeCents: fee.taxaFeeCents,
    prestamistaFeeCents: fee.prestamistaFeeCents,
    commissionRate: table.commissionRate,
    prestamistaCommissionRate: table.prestamistaCommissionRate,
  });
}
