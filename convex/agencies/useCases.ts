import { v } from "convex/values";
import { query } from "../_generated/server";

export const listAgencies = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("agencies").collect();
  },
});

export const getAgency = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.agencyId);
  },
});
