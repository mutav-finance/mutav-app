import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { reserveAssetValidator, type ReserveSnapshot } from "./domain";

export const writeSnapshot = internalMutation({
  args: {
    storedValueCents: v.number(),
    fxUsdBrl: v.number(),
    assets: v.array(reserveAssetValidator),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reserveSnapshots", args);
  },
});

// Deletes every reserveSnapshots row. Used to reset dev data after a required
// schema change; also a generic ops primitive for clearing stale snapshots.
export const clearSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("reserveSnapshots").collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});

export const latestSnapshot = internalQuery({
  args: {},
  handler: async (ctx): Promise<ReserveSnapshot | null> => {
    return await ctx.db.query("reserveSnapshots").withIndex("by_capturedAt").order("desc").first();
  },
});
