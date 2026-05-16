import { v } from "convex/values";

import { internalMutation, query } from "../_generated/server";
import { anchorProviderValidator } from "./domain";
import { anchorOrderStatusValidator, type AnchorOrder, type AnchorOrderId } from "./orderDomain";

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getOrderById = query({
  args: { orderId: v.id("anchorOrders") },
  handler: async (ctx, args): Promise<AnchorOrder | null> => {
    return ctx.db.get(args.orderId);
  },
});

/**
 * All anchor orders for a given payment, newest first. The UI dialog
 * subscribes to this so it picks up status transitions reactively (no
 * client-side poll loop — the `pollPixOnramp` action drives updates).
 */
export const listOrdersByPayment = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args): Promise<AnchorOrder[]> => {
    return ctx.db
      .query("anchorOrders")
      .withIndex("by_payment", (q) => q.eq("paymentId", args.paymentId))
      .order("desc")
      .collect();
  },
});

// ─── Internal mutations (called from actions) ─────────────────────────────────

export const insertOrder = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    paymentId: v.id("payments"),
    provider: anchorProviderValidator,
    anchorTxId: v.string(),
    instructions: v.optional(v.any()),
    how: v.optional(v.string()),
    status: anchorOrderStatusValidator,
  },
  returns: v.id("anchorOrders"),
  handler: async (ctx, args): Promise<AnchorOrderId> => {
    return ctx.db.insert("anchorOrders", {
      ...args,
      createdAt: new Date().toISOString(),
    });
  },
});

export const updateOrderStatus = internalMutation({
  args: {
    orderId: v.id("anchorOrders"),
    status: anchorOrderStatusValidator,
    amountInCents: v.optional(v.number()),
    amountOutCents: v.optional(v.number()),
    feeCents: v.optional(v.number()),
    completedAt: v.optional(v.string()),
    rawPayload: v.optional(v.any()),
  },
  handler: async (ctx, { orderId, ...patch }) => {
    await ctx.db.patch(orderId, patch);
  },
});
