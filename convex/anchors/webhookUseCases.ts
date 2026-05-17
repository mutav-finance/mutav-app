import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { anchorProviderValidator } from "./domain";

/**
 * Idempotent log of inbound webhook events. Returns true if this is the
 * first time we've seen (provider, eventId), false if a duplicate.
 * Etherfuse can deliver the same event twice — the docs flag this
 * explicitly — so dedupe is required, not optional.
 */
export const recordWebhookEvent = internalMutation({
  args: {
    provider: anchorProviderValidator,
    eventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
  },
  returns: v.object({
    inserted: v.boolean(),
    eventRowId: v.union(v.id("anchorWebhookEvents"), v.null()),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("anchorWebhookEvents")
      .withIndex("by_provider_eventId", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId),
      )
      .unique();
    if (existing) {
      return { inserted: false, eventRowId: existing._id };
    }
    const eventRowId = await ctx.db.insert("anchorWebhookEvents", {
      provider: args.provider,
      eventId: args.eventId,
      eventType: args.eventType,
      payload: args.payload,
      receivedAt: new Date().toISOString(),
    });
    return { inserted: true, eventRowId };
  },
});
