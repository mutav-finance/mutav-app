import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Public read of one contract by its human-facing public id.
 *
 * SECURITY POSTURE (MVP):
 *   This query is intentionally public — anyone with a `publicId` can read
 *   the contract. There is no identity check today because no JWT provider
 *   is wired (`convex/auth.config.ts` has an empty providers array).
 *
 *   Before going to production:
 *     1. Wire a JWT provider in `convex/auth.config.ts`.
 *     2. Replace the body below with `await requireIdentity(ctx)` and an
 *        ownership check — only the imobiliária / investor / tenant on the
 *        record (or their delegated operator) should be able to read it.
 *     3. Consider rate-limiting unauthenticated probes.
 *
 *   Until then, treat any contract id as effectively guessable.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    if (!contract) {
      return null;
    }

    // Append-only history table — bounded fetch protects the response payload.
    const history = await ctx.db
      .query("contractHistory")
      .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
      .order("desc")
      .take(100);

    return shapeContract(contract, history);
  },
});

/**
 * Public paginated list of contracts.
 *
 * Same security posture as `getByPublicId`. Replace with an authenticated,
 * ownership-scoped query before shipping to real users.
 */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("contracts").order("desc").paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((doc) => ({
        id: doc.publicId,
        status: doc.status,
        nextRenewalDate: doc.nextRenewalDate,
        availableGuaranteeBRL: doc.availableGuaranteeBRL,
        tenantName: doc.tenant.fullName,
      })),
    };
  },
});

/**
 * Reshape a Convex `contracts` doc + its history rows into the existing
 * `Contract` TS type used by the UI. Strips system fields (_id,
 * _creationTime) and renames publicId → id.
 */
function shapeContract(doc: Doc<"contracts">, history: Doc<"contractHistory">[]) {
  return {
    id: doc.publicId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeBRL: doc.availableGuaranteeBRL,
    rental: doc.rental,
    property: doc.property,
    optional: doc.optional,
    documents: doc.documents,
    tenant: doc.tenant,
    history: history.map((h) => ({
      at: h.at,
      username: h.username,
      message: h.message,
    })),
  };
}
