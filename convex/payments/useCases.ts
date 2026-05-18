import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query } from "../_generated/server";
import { assertAgencyAccess, queryWithAgencyScope } from "../lib/auth";
import { isChargeable } from "./domain";
import { derivePaymentMuxedAddress } from "./lib/muxedAddress";

export const listByAgency = queryWithAgencyScope({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    return ctx.db
      .query("payments")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", ctx.agencyId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/**
 * Resource-by-id read. Returns null on both "no such payment" and "not a
 * member of that agency", to avoid leaking cross-agency existence.
 */
export const getById = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return null;

    try {
      await assertAgencyAccess(ctx, payment.agencyId);
    } catch {
      return null;
    }

    return payment;
  },
});

/** Resource-by-id read keyed on publicId. Same null-on-miss semantics. */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!payment) return null;

    try {
      await assertAgencyAccess(ctx, payment.agencyId);
    } catch {
      return null;
    }

    return payment;
  },
});

/**
 * Tenant-safe shape for the public payment portal. No auth required — the
 * high-entropy `publicId` IS the bearer. Excludes agency-private fields,
 * carries the derived Stellar `M…` destination address.
 */
export const getPublicByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!payment) return null;

    const agency = await ctx.db.get(payment.agencyId);
    if (!agency) return null;

    const muxedAddress = payment.muxedId ? derivePaymentMuxedAddress(payment.muxedId) : null;

    return {
      publicId: payment.publicId,
      agencyName: agency.name,
      periodMonth: payment.periodMonth,
      issuedAt: payment.issuedAt,
      dueDate: payment.dueDate,
      totalCents: payment.totalCents,
      state: payment.state,
      method: payment.method,
      muxedAddress,
    };
  },
});

/**
 * Internal — look up a payment by its Stellar muxed-id. O(1) via
 * `by_muxedId` index. Used by the Horizon-polling reconciler.
 */
export const findByMuxedId = internalQuery({
  args: { muxedId: v.string() },
  handler: async (ctx, { muxedId }) => {
    return ctx.db
      .query("payments")
      .withIndex("by_muxedId", (q) => q.eq("muxedId", muxedId))
      .unique();
  },
});

/**
 * Internal — current Horizon cursor for a given treasury source account.
 * Used by the polling action to resume from the last seen page.
 */
export const getStellarIndexState = internalQuery({
  args: { sourceAccount: v.string() },
  handler: async (ctx, { sourceAccount }) => {
    return ctx.db
      .query("stellarIndexState")
      .withIndex("by_sourceAccount", (q) => q.eq("sourceAccount", sourceAccount))
      .unique();
  },
});

/**
 * Returns the next pending or overdue payment for the agency, ordered by
 * periodMonth ascending (earliest first).
 *
 * Uses the `by_agency_period` index — no full-table scan.
 */
export const getNextPendingPayment = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    // Walk forward through payments sorted by period (earliest first)
    // and return the first one that is pending or overdue.
    const page = await ctx.db
      .query("payments")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", ctx.agencyId))
      .order("asc")
      .collect();

    const next = page.find((p) => isChargeable(p.state));

    if (!next) return null;
    const stateKind = next.state.kind;
    if (stateKind !== "pending" && stateKind !== "overdue") return null;
    return {
      publicId: next.publicId,
      dueDate: next.dueDate,
      totalCents: next.totalCents,
      stateKind,
    };
  },
});
