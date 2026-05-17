import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { anchorProviderValidator } from "./domain";

/**
 * Idempotent log of inbound webhook events. Inserts a row if this is a
 * new (provider, eventId); otherwise reports the existing row.
 *
 * Returns `alreadyProcessed: true` only when a prior delivery actually
 * completed processing (processedAt is set). If a previous run crashed
 * mid-processing the row exists with processedAt null and we let the
 * caller reprocess — otherwise a single mid-flight failure could pin
 * an order forever, because Etherfuse retries would each see "already
 * recorded" and silently 200.
 */
export const recordWebhookEvent = internalMutation({
  args: {
    provider: anchorProviderValidator,
    eventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
  },
  returns: v.object({
    eventRowId: v.id("anchorWebhookEvents"),
    alreadyProcessed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("anchorWebhookEvents")
      .withIndex("by_provider_eventId", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId),
      )
      .unique();
    if (existing) {
      return {
        eventRowId: existing._id,
        alreadyProcessed: existing.processedAt !== undefined,
      };
    }
    const eventRowId = await ctx.db.insert("anchorWebhookEvents", {
      provider: args.provider,
      eventId: args.eventId,
      eventType: args.eventType,
      payload: args.payload,
      receivedAt: new Date().toISOString(),
    });
    return { eventRowId, alreadyProcessed: false };
  },
});

/**
 * Stamp `processedAt` after the handler finishes the webhook's
 * downstream side effects. Future duplicate deliveries with the same
 * eventId will then short-circuit with "already processed".
 */
export const markWebhookEventProcessed = internalMutation({
  args: { eventRowId: v.id("anchorWebhookEvents") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventRowId, { processedAt: new Date().toISOString() });
  },
});
