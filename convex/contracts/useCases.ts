import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";
import type { Contract, ContractHistory } from "./domain";

/**
 * Public read of one contract by its human-facing public id.
 *
 * SECURITY POSTURE (MVP):
 * No identity check today (`auth.config.ts` has empty providers). Replace
 * the body with `await requireIdentity(ctx)` + an agency-scoped ownership
 * check before going to production.
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

    const history = await ctx.db
      .query("contractHistory")
      .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
      .order("desc")
      // Hard cap; if contracts exceed 100 history entries we'll need pagination.
      .take(100);

    return shapeContract(contract, history);
  },
});

/** Public paginated list — same security caveat as `getByPublicId`. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("contracts").order("desc").paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map(shapeContractSummary),
    };
  },
});

/** Paginated list scoped to one agency. */
export const listByAgency = query({
  args: {
    agencyId: v.id("agencies"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", args.agencyId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map(shapeContractSummary),
    };
  },
});

/**
 * Lightweight summary of a contract for list views — drops the heavy
 * `rental`/`property`/`optional`/`documents`/`tenant` fields.
 * Use shapeContract for the detail view.
 */
function shapeContractSummary(doc: Contract) {
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeCents: doc.availableGuaranteeCents,
    tenantName: doc.tenant.fullName,
    creationTime: doc._creationTime,
  };
}

/**
 * Reshape a Convex `contracts` doc + history into the UI Contract type.
 * Strips system fields (`_id`, `_creationTime`); renames publicId → id.
 */
function shapeContract(doc: Contract, history: ContractHistory[]) {
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeCents: doc.availableGuaranteeCents,
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
