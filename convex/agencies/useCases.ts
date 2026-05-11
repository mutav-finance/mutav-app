import { v } from "convex/values";
import { query } from "../_generated/server";

// ─── Agency queries ───────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("agencies").collect();
  },
});

export const getById = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.agencyId);
  },
});

export const getByCnpj = query({
  args: { cnpj: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agencies")
      .withIndex("by_cnpj", (q) => q.eq("cnpj", args.cnpj))
      .unique();
  },
});

// ─── Membership queries ───────────────────────────────────────────────────────

/** Returns all agencies a user belongs to, each enriched with their role. */
export const listAgenciesForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const results = await Promise.all(
      memberships.map(async (m) => {
        const agency = await ctx.db.get(m.agencyId);
        if (!agency) return null;
        return { ...agency, role: m.role, membershipId: m._id, joinedAt: m.joinedAt };
      }),
    );

    return results.filter(Boolean);
  },
});

/** Returns all members of an agency, each enriched with their user info and role. */
export const listMembersForAgency = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_agency", (q) => q.eq("agencyId", args.agencyId))
      .collect();

    const results = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        if (!user) return null;
        return { ...user, role: m.role, membershipId: m._id, joinedAt: m.joinedAt };
      }),
    );

    return results.filter(Boolean);
  },
});

/** Returns a single membership for a user↔agency pair. */
export const getMembership = query({
  args: { userId: v.id("users"), agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("memberships")
      .withIndex("by_user_agency", (q) => q.eq("userId", args.userId).eq("agencyId", args.agencyId))
      .unique();
  },
});
