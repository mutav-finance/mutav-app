import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { reserveAssetValidator, type ReserveSnapshot } from "./domain";

export const writeSnapshot = internalMutation({
  args: {
    storedValueCents: v.number(),
    assets: v.array(reserveAssetValidator),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reserveSnapshots", args);
  },
});

export const latestSnapshot = internalQuery({
  args: {},
  handler: async (ctx): Promise<ReserveSnapshot | null> => {
    return await ctx.db.query("reserveSnapshots").withIndex("by_capturedAt").order("desc").first();
  },
});
