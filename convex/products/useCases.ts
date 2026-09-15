import { internalQuery, type QueryCtx } from "../_generated/server";
import { queryWithAuth } from "../lib/auth";
import type { Result } from "../lib/result";
import {
  isEffective,
  isEligible,
  PRODUCT_ERROR_CODE,
  type EligibilitySubject,
  type Product,
  type PublicProduct,
} from "./domain";

/**
 * The single enabled default product. Seeded as `mutav-fianca` with today's
 * pricing constants; the admin catalog UI (later) is what makes a second row
 * possible, at which point `isDefault` is the switch that names the fallback.
 */
export async function findDefaultProduct(ctx: QueryCtx): Promise<Product | null> {
  return ctx.db
    .query("products")
    .withIndex("by_enabled_isDefault", (q) => q.eq("enabled", true).eq("isDefault", true))
    .first();
}

export async function findProductBySlug(ctx: QueryCtx, slug: string): Promise<Product | null> {
  return ctx.db
    .query("products")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

export const getDefault = internalQuery({
  args: {},
  handler: async (ctx): Promise<Product | null> => findDefaultProduct(ctx),
});

/**
 * The default product's pricing parameters, for the wizard's client-side
 * quote. The catalog is platform data, not agency data, so identity is the
 * only gate. Returns null before the catalog is seeded — the caller shows no
 * figures rather than figures priced against a constant that may not be what
 * `guarantees.create` will use.
 */
export const getDefaultPublic = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<PublicProduct | null> => {
    const product = await findDefaultProduct(ctx);
    if (product === null) return null;
    return { slug: product.slug, name: product.name, terms: product.terms };
  },
});

type ResolveProductSuccessResult = { product: Product };
type ResolveProductErrorResult = { code: typeof PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE };

/**
 * Pick the product a new guarantee prices against: the requested slug when it
 * is in effect and the subject is eligible for it, otherwise the enabled
 * default. The default is not subjected to the eligibility filter — it is the
 * product every agency can sell, by definition of being the default.
 */
export async function resolveProduct(
  ctx: QueryCtx,
  args: EligibilitySubject & { requestedSlug?: string; at: string },
): Promise<Result<ResolveProductSuccessResult, ResolveProductErrorResult>> {
  if (args.requestedSlug !== undefined) {
    const requested = await findProductBySlug(ctx, args.requestedSlug);
    if (requested && isEffective(requested, args.at) && isEligible(requested, args)) {
      return {
        success: true,
        data: { product: requested },
        message: `Resolved requested product ${requested.slug}`,
      };
    }
  }

  const fallback = await findDefaultProduct(ctx);
  if (!fallback || !isEffective(fallback, args.at)) {
    return {
      success: false,
      error: { code: PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE },
      message: "No enabled default product is in effect",
    };
  }

  return {
    success: true,
    data: { product: fallback },
    message: `Resolved default product ${fallback.slug}`,
  };
}
