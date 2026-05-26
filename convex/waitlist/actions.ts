"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "../_generated/server";
import { getResendApiKey, getWaitlistAudienceId } from "../lib/env";
import { waitlistAudienceValidator } from "./domain";

// Best-effort write to a Resend audience so the team can run broadcast
// campaigns later. Convex is the source of truth; this is a projection.
//
// Failure modes (all logged, none re-thrown):
//   - RESEND_API_KEY missing → skip (common in local dev without secrets)
//   - Audience env var missing for the audience → skip
//   - Resend API rejects (rate-limit, invalid email, etc.) → log and continue.
//     The Convex row stays; backfill is a manual query+replay if needed.
export const addToResendAudience = internalAction({
  args: {
    email: v.string(),
    audience: waitlistAudienceValidator,
  },
  handler: async (_ctx, { email, audience }) => {
    if (!process.env.RESEND_API_KEY) {
      console.warn("[waitlist] RESEND_API_KEY not set, skipping Resend sync");
      return;
    }

    const audienceId = getWaitlistAudienceId(audience);
    if (!audienceId) {
      console.warn(`[waitlist] no Resend audience id configured for "${audience}", skipping sync`);
      return;
    }

    const resend = new Resend(getResendApiKey());

    const { error } = await resend.contacts.create({
      email,
      audienceId,
      unsubscribed: false,
    });

    if (error) {
      console.error(`[waitlist] Resend contacts.create failed for ${audience}:${email}`, error);
    }
  },
});
