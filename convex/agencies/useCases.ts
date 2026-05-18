import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { queryWithAgencyScope, queryWithAuth } from "../lib/auth";

// ─── Agency queries ───────────────────────────────────────────────────────────

/**
 * Fetch one agency by id. The wrapper asserts the caller is a member of the
 * requested agency before the handler runs — non-members get
 * `ForbiddenError` rather than the agency doc.
 */
export const getById = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    return ctx.db.get(ctx.agencyId);
  },
});

/**
 * Internal companion to `getById` for use from actions/schedulers where
 * caller identity may not propagate. The calling internal flow is
 * responsible for whatever authorization is appropriate at its entry point.
 */
export const getByIdInternal = internalQuery({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    return ctx.db.get(agencyId);
  },
});

// ─── Membership queries ───────────────────────────────────────────────────────

/**
 * Lists the agencies the current user belongs to. Identity is resolved by the
 * wrapper (pre-Auth0: `dev-user`; post-Auth0: JWT subject) — no client-side
 * `userId` arg, so a caller can never enumerate another user's memberships.
 */
export const listAgenciesForUser = queryWithAuth({
  args: {},
  handler: async (ctx) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
