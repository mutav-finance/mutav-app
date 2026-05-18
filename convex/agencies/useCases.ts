import { v } from "convex/values";
import { query } from "../_generated/server";

// ─── Agency queries ───────────────────────────────────────────────────────────

export const getById = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.agencyId);
  },
});

// ─── Membership queries ───────────────────────────────────────────────────────

/**
 * SECURITY POSTURE (MVP): unscoped public read. Load-bearing for the
 * pre-Auth0 dev shortcut — `WorkspaceContext` calls this to populate the
 * agency switcher. When Auth0 lands, this becomes an authenticated query
 * that derives `userId` from the session rather than accepting it from args.
 */
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
