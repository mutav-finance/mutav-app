import { v } from "convex/values";
import { query, internalMutation } from "../_generated/server";
import { queryWithAuth } from "../lib/auth";

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

/**
 * Returns the currently authenticated user.
 * Auth-gated — throws UnauthenticatedError if called without a valid JWT.
 *
 * Replaces `getByPublicId` once Auth0 is wired. The client calls this instead
 * of passing `DEV_USER_PUBLIC_ID` so the user id is always server-derived.
 */
export const getMe = queryWithAuth({
  args: {},
  handler: async (ctx) => {
    const { _id, name, email, subject } = ctx.user;
    return { _id, name, email, subject };
  },
});

/**
 * Idempotent first-login provisioning.
 * Called server-side (internal) after Auth0 issues the JWT.
 * Looks up the user by `subject` (JWT `sub` claim); creates a new row if absent.
 *
 * Flow:
 *   1. Auth0 redirects to /api/auth/callback
 *   2. The route handler resolves the session and calls this mutation
 *   3. Returns the Convex user row — caller uses _id for subsequent queries
 */
export const getOrCreateByIdentity = internalMutation({
  args: {
    subject: v.string(),
    name: v.string(),
    email: v.string(),
  },
  handler: async (ctx, { subject, name, email }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();

    if (existing) {
      // Keep name/email in sync with Auth0 profile in case they changed.
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }

    // Check if a legacy row with the same email exists (pre-Auth0 import).
    const byEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (byEmail) {
      // Link the existing row to the Auth0 subject.
      await ctx.db.patch(byEmail._id, { subject, name });
      return byEmail._id;
    }

    const userId = await ctx.db.insert("users", {
      publicId: subject,
      subject,
      name,
      email,
      createdAt: new Date().toISOString(),
    });

    return userId;
  },
});
