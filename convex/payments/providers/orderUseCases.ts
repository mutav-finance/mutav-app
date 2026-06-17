import { v } from "convex/values";

import { internalMutation, internalQuery, query } from "../../_generated/server";
import { assertAgencyAccess } from "../../lib/auth";
import { InvoiceMethods, InvoiceStates } from "../../invoices/domain";
import { SettlementMethods } from "../domain";
import { recordSettlement } from "../settlement";
import { anchorProviderValidator } from "./domain";
import {
  providerOrderStatusValidator,
  type ProviderOrder,
  type ProviderOrderId,
} from "./orderDomain";

// ─── Queries ──────────────────────────────────────────────────────────────────

// Null on miss-or-forbidden so cross-agency existence doesn't leak.
export const getOrderById = query({
  args: { orderId: v.id("providerOrders") },
  handler: async (ctx, args): Promise<ProviderOrder | null> => {
    const order = await ctx.db.get(args.orderId);
    if (!order) return null;

    try {
      await assertAgencyAccess(ctx, order.agencyId);
    } catch {
      return null;
    }

    return order;
  },
});

// Companion for `pollPixOnramp` (webhook) + `pollAnchorTestOnramp` (UI),
// both of which run without user identity.
export const getOrderByIdInternal = internalQuery({
  args: { orderId: v.id("providerOrders") },
  handler: async (ctx, args): Promise<ProviderOrder | null> => {
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
  handler: async (ctx, args): Promise<ProviderOrder | null> => {
    return ctx.db
      .query("providerOrders")
      .withIndex("by_anchor_tx", (q) => q.eq("anchorTxId", args.anchorTxId))
      .unique();
  },
});

// ─── Internal mutations (called from actions) ─────────────────────────────────

export const insertOrder = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    invoiceId: v.id("invoices"),
    provider: anchorProviderValidator,
    anchorTxId: v.string(),
    instructions: v.optional(v.any()),
    how: v.optional(v.string()),
    hostedUrl: v.optional(v.string()),
    status: providerOrderStatusValidator,
  },
  returns: v.id("providerOrders"),
  handler: async (ctx, args): Promise<ProviderOrderId> => {
    return ctx.db.insert("providerOrders", {
      ...args,
      createdAt: new Date().toISOString(),
    });
  },
});

export const updateOrderStatus = internalMutation({
  args: {
    orderId: v.id("providerOrders"),
    status: providerOrderStatusValidator,
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
 * parent invoice paid in a single Convex transaction. Pollers previously
 * issued two separate runMutation calls: if the second failed, the order
 * was flipped completed but the invoice stayed open — and the next
 * poll's `isTerminal` short-circuit prevented retry forever.
 *
 * Reaches across the invoices domain on purpose. Atomicity wins over
 * the usual domain boundary: invoice-update logic mirrors
 * `invoices/mutations.ts → markPaidByAnchor` (idempotent on anchorTxId
 * collision); keep them in sync if you change one.
 */
export const completeOrderAndMarkPaid = internalMutation({
  args: {
    orderId: v.id("providerOrders"),
    status: providerOrderStatusValidator,
    amountInCents: v.optional(v.number()),
    amountOutCents: v.optional(v.number()),
    feeCents: v.optional(v.number()),
    completedAt: v.optional(v.string()),
    rawPayload: v.optional(v.any()),
    invoiceId: v.id("invoices"),
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
      invoiceId,
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

    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) return { paymentStatus: "not_found" as const };

    if (invoice.state.kind === "paid") {
      const existingTxId = invoice.method?.kind === "pix" ? invoice.method.txId : null;
      return existingTxId === anchorTxId
        ? { paymentStatus: "already_paid" as const }
        : { paymentStatus: "duplicate_inbound" as const };
    }

    await ctx.db.patch(invoiceId, {
      state: InvoiceStates.paid(paidAt),
      method: InvoiceMethods.pix(pixKey, anchorTxId),
    });

    await recordSettlement(ctx, {
      agencyId: invoice.agencyId,
      invoiceId,
      status: "succeeded",
      amountCents: invoice.totalCents,
      paidAt,
      externalRef: anchorTxId,
      providerOrderId: orderId,
      method: SettlementMethods.pix(pixKey, anchorTxId),
    });

    return { paymentStatus: "paid" as const };
  },
});
