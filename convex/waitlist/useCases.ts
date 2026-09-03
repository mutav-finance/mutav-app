import { v } from "convex/values";
import { internalQuery, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Result } from "../lib/result";
import {
  WAITLIST_ERROR_CODE,
  type WaitlistDelivery,
  type WaitlistErrorCode,
  type WaitlistId,
  isValidEmail,
  normalizeEmail,
  waitlistAudienceValidator,
} from "./domain";

type JoinSuccessResult = { waitlistId: WaitlistId; alreadyOnList: false };
type JoinErrorResult = { code: WaitlistErrorCode };

// Anonymous public mutation — no auth wrapper. Called by the marketing site
// (mutav-website) from a Next.js Server Action that bridges form submissions.
//
// Dedup: index lookup by (email, audience). Same person can join both lists
// (investidor + imobiliaria) since the index includes audience.
//
// Resend sync: scheduled as a fire-and-forget action so a Resend outage
// doesn't block the signup or surface to the user. Convex is the source of
// truth; Resend is a secondary projection for broadcast campaigns.
export const join = mutation({
  args: {
    email: v.string(),
    audience: waitlistAudienceValidator,
    ip: v.optional(v.string()),
    ua: v.optional(v.string()),
    referer: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result<JoinSuccessResult, JoinErrorResult>> => {
    const email = normalizeEmail(args.email);

    if (!isValidEmail(email)) {
      return {
        success: false,
        error: { code: WAITLIST_ERROR_CODE.INVALID_EMAIL },
        message: "Email format is invalid",
      };
    }

    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email_audience", (q) => q.eq("email", email).eq("audience", args.audience))
      .first();

    if (existing !== null) {
      return {
        success: false,
        error: { code: WAITLIST_ERROR_CODE.DUPLICATE },
        message: "Email is already on this waitlist",
      };
    }

    const waitlistId = await ctx.db.insert("waitlist", {
      email,
      audience: args.audience,
      ts: Date.now(),
      ip: args.ip,
      ua: args.ua,
      referer: args.referer,
    });

    // Both side effects take the row id, never the address. A scheduled
    // function's arguments are persisted on its `_scheduled_functions` record
    // and retained in the deployment function log — a US-hosted surface
    // outside every access control the schema has — so an address handed over
    // as an argument outlives the send. The actions resolve it through
    // `getForDeliveryInternal` instead.

    // Best-effort secondary write to Resend (broadcast campaign list).
    // Failure is logged inside the action and does not affect this mutation.
    await ctx.scheduler.runAfter(0, internal.waitlist.actions.addToResendAudience, {
      waitlistId,
    });

    // Best-effort welcome email. Same fire-and-forget contract: the action
    // skips audiences without an approved template and logs any delivery
    // failure without affecting this mutation.
    await ctx.scheduler.runAfter(0, internal.waitlist.actions.sendWelcomeEmail, {
      waitlistId,
    });

    return {
      success: true,
      data: { waitlistId, alreadyOnList: false },
      message: "Joined waitlist",
    };
  },
});

// Internal — the address lookup the delivery actions run in place of taking
// the address as an argument. Returns null when the row is gone (an erasure
// request or a manual cleanup can land between scheduling and execution);
// callers treat that as "nothing to deliver", not as an error.
//
// Projects to the two fields a send needs. The audit columns (`ip`, `ua`,
// `referer`) stay behind so they are not carried across the boundary.
export const getForDeliveryInternal = internalQuery({
  args: { waitlistId: v.id("waitlist") },
  handler: async (ctx, { waitlistId }): Promise<WaitlistDelivery | null> => {
    const row = await ctx.db.get(waitlistId);
    if (row === null) return null;
    return { email: row.email, audience: row.audience };
  },
});

// Internal — used by the backfill action to enumerate every signup of a given
// audience and replay it into the corresponding Resend audience. The
// `by_email_audience` index is leading-on-email, so a plain filter is the
// honest answer here; the waitlist table is bounded (pre-launch + curated
// growth) and this only runs ad-hoc, not on a hot path.
export const listByAudienceInternal = internalQuery({
  args: { audience: waitlistAudienceValidator },
  handler: async (ctx, { audience }) => {
    const all = await ctx.db.query("waitlist").collect();
    return all.filter((row) => row.audience === audience);
  },
});
