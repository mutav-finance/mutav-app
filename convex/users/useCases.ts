import { v } from "convex/values";
import { query } from "../_generated/server";

/**
 * SECURITY POSTURE (MVP): unscoped public read. Load-bearing for the
 * pre-Auth0 dev shortcut — `WorkspaceContext` calls this with
 * `DEV_USER_PUBLIC_ID = "dev-user"` to resolve the current user. When Auth0
 * lands, remove this endpoint — identity comes from the JWT, not from args.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
  },
});
