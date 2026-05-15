import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { PaymentMethods } from "../payments/domain";
import { transactionStatusValidator, type TransactionStatus } from "./domain";

// ─── Internal queries ─────────────────────────────────────────────────────────

export const getOnRampTransactionById = internalQuery({
  args: { id: v.id("anchorOnRampTransactions") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

/** Look up an on-ramp row by `(provider, providerTransactionId)`. */
export const findOnRampByProviderTxId = internalQuery({
  args: { provider: v.string(), providerTransactionId: v.string() },
  handler: async (ctx, { provider, providerTransactionId }) => {
    return ctx.db
      .query("anchorOnRampTransactions")
      .withIndex("by_providerTransactionId", (q) =>
        q.eq("provider", provider).eq("providerTransactionId", providerTransactionId),
      )
      .unique();
  },
});

/**
 * Most-recent on-ramp row for a given payment. Multiple rows can exist if a
 * payment is re-quoted after expiry; the webhook handler in WC walks the
 * latest row by default.
 */
export const findOnRampByPaymentId = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    return ctx.db
      .query("anchorOnRampTransactions")
      .withIndex("by_payment", (q) => q.eq("paymentId", paymentId))
      .order("desc")
      .first();
  },
});

/** Dedupe lookup for inbound webhook events. */
export const findWebhookEventById = internalQuery({
  args: { provider: v.string(), eventId: v.string() },
  handler: async (ctx, { provider, eventId }) => {
    return ctx.db
      .query("anchorWebhookEvents")
      .withIndex("by_provider_eventId", (q) => q.eq("provider", provider).eq("eventId", eventId))
      .unique();
  },
});

// ─── Internal mutations ───────────────────────────────────────────────────────

/**
 * Insert a new on-ramp row. `paymentInstructions` is the raw rail-specific
 * payload (PIX BR-Code, SPEI CLABE, etc.) coming back from the provider —
 * stored as `any` to avoid coupling persistence to a particular rail's schema.
 */
export const insertOnRampTransaction = internalMutation({
  args: {
    paymentId: v.id("payments"),
    agencyId: v.id("agencies"),
    provider: v.string(),
    providerTransactionId: v.string(),
    providerQuoteId: v.string(),
    status: transactionStatusValidator,
    fromAmount: v.string(),
    fromCurrency: v.string(),
    toAmount: v.string(),
    toCurrency: v.string(),
    stellarAddress: v.string(),
    paymentInstructions: v.optional(v.any()),
    feeBps: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return ctx.db.insert("anchorOnRampTransactions", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch an on-ramp row's status (and optionally the settled Stellar txHash).
 * Called by the webhook handler in WC on `transaction_updated` events.
 */
export const updateOnRampTransactionStatus = internalMutation({
  args: {
    id: v.id("anchorOnRampTransactions"),
    status: transactionStatusValidator,
    stellarTxHash: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, stellarTxHash }) => {
    const patch: { status: TransactionStatus; updatedAt: string; stellarTxHash?: string } = {
      status,
      updatedAt: new Date().toISOString(),
    };
    if (stellarTxHash !== undefined) patch.stellarTxHash = stellarTxHash;
    await ctx.db.patch(id, patch);
  },
});

/** Append an inbound webhook event. Dedupe handled by the caller via `findWebhookEventById`. */
export const insertWebhookEvent = internalMutation({
  args: {
    provider: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("anchorWebhookEvents", {
      ...args,
      receivedAt: new Date().toISOString(),
    });
  },
});

/**
 * Patches `payments.method` to the `pix_anchor` variant using the canonical
 * constructor from `convex/payments/domain.ts`. Invoked by the
 * `createPaymentOrder` action once an Etherfuse order has been opened.
 */
export const setPaymentMethodToPixAnchor = internalMutation({
  args: {
    paymentId: v.id("payments"),
    anchorOnRampTransactionId: v.id("anchorOnRampTransactions"),
    pixCode: v.string(),
    expiresAt: v.string(),
  },
  handler: async (ctx, { paymentId, anchorOnRampTransactionId, pixCode, expiresAt }) => {
    await ctx.db.patch(paymentId, {
      method: PaymentMethods.pixAnchor(anchorOnRampTransactionId, pixCode, expiresAt),
    });
  },
});
