import { v } from "convex/values";
import { query } from "../_generated/server";

/** List all users. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("users").collect();
  },
});

/** Resolve a user by their stable public identifier. */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
  },
});

/** Resolve a user by email address. */
export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
  },
});

/** Get a user by their internal Convex id. */
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.userId);
  },
});
