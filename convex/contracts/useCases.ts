import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";
import type { Contract, ContractHistory } from "./domain";
import { contractsByStatus } from "./aggregate";
import { CONTRACT_STATUS } from "./domain";

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
 * Real-time pipeline summary for one agency.
 *
 * Returns the count of contracts in each status using the `contractsByStatus`
 * aggregate — O(log n), no full-table scan.
 *
 * Used by `section-cards.tsx` (Painel) to display KPI tiles.
 */
export const getPipelineSummary = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    const statuses = [
      CONTRACT_STATUS.ATIVO,
      CONTRACT_STATUS.PENDENTE,
      CONTRACT_STATUS.ENCERRADO,
      CONTRACT_STATUS.CANCELADO,
    ] as const;

    const counts = await contractsByStatus.countBatch(
      ctx,
      statuses.map((status) => ({
        namespace: agencyId,
        bounds: {
          lower: { key: status, inclusive: true },
          upper: { key: status, inclusive: true },
        },
      })),
    );

    return {
      ativo: counts[0] ?? 0,
      pendente: counts[1] ?? 0,
      encerrado: counts[2] ?? 0,
      cancelado: counts[3] ?? 0,
    };
  },
});

/** Monthly contract counts for the given agency, up to the last 12 months. */
export const countByMonth = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    const now = new Date();
    // Build the last 12 calendar months as "YYYY-MM" labels
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }

    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", args.agencyId))
      .collect();

    return months.map((month) => {
      let netActive = 0;
      let activated = 0;
      let cancelled = 0;
      let expired = 0;

      for (const c of contracts) {
        // activations this month
        if (c.activatedAt && c.activatedAt.slice(0, 7) === month) activated++;

        // deactivations this month
        if (c.deactivatedAt && c.deactivatedAt.slice(0, 7) === month) {
          if (c.status === "cancelado") cancelled++;
          else if (c.status === "encerrado") expired++;
        }

        // net active snapshot at end of month
        if (!c.activatedAt) continue;
        if (c.activatedAt.slice(0, 7) > month) continue;
        const deactivated = c.deactivatedAt ?? null;
        if (deactivated && deactivated.slice(0, 7) <= month) continue;
        netActive++;
      }

      return { month, netActive, activated, cancelled, expired };
    });
  },
});

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
