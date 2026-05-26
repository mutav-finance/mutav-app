import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Result } from "../lib/result";
import {
  WAITLIST_ERROR_CODE,
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

    // Best-effort secondary write to Resend (broadcast campaign list).
    // Failure is logged inside the action and does not affect this mutation.
    await ctx.scheduler.runAfter(0, internal.waitlist.actions.addToResendAudience, {
      email,
      audience: args.audience,
    });

    return {
      success: true,
      data: { waitlistId, alreadyOnList: false },
      message: "Joined waitlist",
    };
  },
});
