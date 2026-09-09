import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { AgencyId } from "../agencies/domain";
import type { PropertyKind } from "../leases/domain";
import { propertyKindValidator } from "../leases/domain";
import { priceableTierValidator, type PriceableTier } from "../guarantees/domain";

export type Product = Doc<"products">;
export type ProductId = Id<"products">;
export type ProductTerms = Product["terms"];
export type ProductEligibility = Product["eligibility"];

export const productTermsValidator = v.object({
  tierRate: v.object({
    bom: v.number(),
    regular: v.number(),
    ruim: v.number(),
  }),
  coverageCeilingMultiplier: v.number(),
  exitCostMultiplier: v.number(),
  activationFeeCents: v.number(),
  commissionRate: v.number(),
  prestamistaPremiumCents: v.number(),
  prestamistaCommissionRate: v.number(),
  setupInstallments: v.number(),
});

export const eligibilityValidator = v.object({
  agencyIds: v.union(v.array(v.id("agencies")), v.null()),
  regionUFs: v.union(v.array(v.string()), v.null()),
  minTier: v.union(priceableTierValidator, v.null()),
  propertyKinds: v.union(v.array(propertyKindValidator), v.null()),
});

/** Slug of the product seeded with today's constants; the fallback when no requested slug is eligible. */
export const DEFAULT_PRODUCT_SLUG = "mutav-fianca";

export type EligibilitySubject = {
  agencyId: AgencyId;
  uf: string | null;
  tier: PriceableTier;
  propertyKind: PropertyKind;
};

// Credit quality ascending: `minTier` is the worst tier still eligible, so a
// product with `minTier: "regular"` accepts `regular` and `bom` but not `ruim`.
const TIER_RANK: Record<PriceableTier, number> = { ruim: 0, regular: 1, bom: 2 };

export function isEligible(
  product: Pick<Product, "eligibility">,
  subject: EligibilitySubject,
): boolean {
  const { agencyIds, regionUFs, minTier, propertyKinds } = product.eligibility;
  if (agencyIds !== null && !agencyIds.includes(subject.agencyId)) return false;
  if (regionUFs !== null && (subject.uf === null || !regionUFs.includes(subject.uf))) return false;
  if (minTier !== null && TIER_RANK[subject.tier] < TIER_RANK[minTier]) return false;
  if (propertyKinds !== null && !propertyKinds.includes(subject.propertyKind)) return false;
  return true;
}

export function isEffective(
  product: Pick<Product, "enabled" | "effectiveFrom" | "effectiveTo">,
  at: string,
): boolean {
  if (!product.enabled) return false;
  if (product.effectiveFrom > at) return false;
  if (product.effectiveTo !== undefined && product.effectiveTo <= at) return false;
  return true;
}

export const PRODUCT_ERROR_CODE = {
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
} as const satisfies Record<string, string>;

export type ProductErrorCode = (typeof PRODUCT_ERROR_CODE)[keyof typeof PRODUCT_ERROR_CODE];
