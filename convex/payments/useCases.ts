import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";
import { paymentStateKindValidator, type Payment } from "./domain";

export const listByAgency = query({
  args: {
    agencyId: v.id("agencies"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("payments")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", args.agencyId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listByStateKind = query({
  args: {
    stateKind: paymentStateKindValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("payments")
      .withIndex("by_state_kind", (q) => q.eq("state.kind", args.stateKind))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/** Public paginated list — same security caveat as contracts.useCases.list. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("payments").order("desc").paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(shapePaymentSummary),
    };
  },
});

export const getById = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.paymentId);
  },
});

export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("payments")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
  },
});

/**
 * Returns the next pending or overdue payment for the agency, ordered by
 * periodMonth ascending (earliest first).
 *
 * Uses the `by_agency_period` index — no full-table scan.
 */
export const getNextPendingPayment = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    // Walk forward through payments sorted by period (earliest first)
    // and return the first one that is pending or overdue.
    const page = await ctx.db
      .query("payments")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", agencyId))
      .order("asc")
      .collect();

    const next = page.find((p) => p.state.kind === "pending" || p.state.kind === "overdue");

    if (!next) return null;
    return {
      publicId: next.publicId,
      dueDate: next.dueDate,
      totalCents: next.totalCents,
      stateKind: next.state.kind as "pending" | "overdue",
    };
  },
});

// ─── Shape helpers ────────────────────────────────────────────────────────────

function shapePaymentSummary(doc: Payment) {
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    periodMonth: doc.periodMonth,
    issuedAt: doc.issuedAt,
    dueDate: doc.dueDate,
    totalCents: doc.totalCents,
    state: doc.state,
    method: doc.method,
    lineItemCount: doc.lineItems.length,
  };
}
