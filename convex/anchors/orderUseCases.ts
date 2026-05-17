import { v } from "convex/values";

import { internalMutation, internalQuery, query } from "../_generated/server";
import { PaymentMethods, PaymentStates } from "../payments/domain";
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
 * Reverse lookup for webhook reconciliation: given the provider's order
 * identifier (e.g. Etherfuse's UUID), find the local order row. O(1) via
 * the existing `by_anchor_tx` index.
 */
export const getByAnchorTxId = internalQuery({
  args: { anchorTxId: v.string() },
  handler: async (ctx, args): Promise<AnchorOrder | null> => {
    return ctx.db
      .query("anchorOrders")
      .withIndex("by_anchor_tx", (q) => q.eq("anchorTxId", args.anchorTxId))
      .unique();
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
    hostedUrl: v.optional(v.string()),
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

/**
 * Atomically patch the anchor order to terminal-completed AND mark its
 * parent payment paid in a single Convex transaction. Pollers previously
 * issued two separate runMutation calls: if the second failed, the order
 * was flipped completed but the payment stayed pending — and the next
 * poll's `isTerminal` short-circuit prevented retry forever.
 *
 * Reaches across the payments domain on purpose. Atomicity wins over
 * the usual domain boundary: payment-update logic mirrors
 * `payments/mutations.ts → markPaidByAnchor` (idempotent on anchorTxId
 * collision); keep them in sync if you change one.
 */
export const completeOrderAndMarkPaid = internalMutation({
  args: {
    orderId: v.id("anchorOrders"),
    status: anchorOrderStatusValidator,
    amountInCents: v.optional(v.number()),
    amountOutCents: v.optional(v.number()),
    feeCents: v.optional(v.number()),
    completedAt: v.optional(v.string()),
    rawPayload: v.optional(v.any()),
    paymentId: v.id("payments"),
    anchorTxId: v.string(),
    pixKey: v.string(),
    paidAt: v.string(),
  },
  handler: async (
    ctx,
    {
      orderId,
      status,
      amountInCents,
      amountOutCents,
      feeCents,
      completedAt,
      rawPayload,
      paymentId,
      anchorTxId,
      pixKey,
      paidAt,
    },
  ) => {
    await ctx.db.patch(orderId, {
      status,
      amountInCents,
      amountOutCents,
      feeCents,
      completedAt,
      rawPayload,
    });

    const payment = await ctx.db.get(paymentId);
    if (!payment) return { paymentStatus: "not_found" as const };

    if (payment.state.kind === "paid") {
      const existingTxId = payment.method?.kind === "pix" ? payment.method.txId : null;
      return existingTxId === anchorTxId
        ? { paymentStatus: "already_paid" as const }
        : { paymentStatus: "duplicate_inbound" as const };
    }

    await ctx.db.patch(paymentId, {
      state: PaymentStates.paid(paidAt),
      method: PaymentMethods.pix(pixKey, anchorTxId),
    });
    return { paymentStatus: "paid" as const };
  },
});
