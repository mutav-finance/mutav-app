"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
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

type BackfillSummary = {
  dryRun: boolean;
  audience: "investidor" | "imobiliaria";
  audienceId: string;
  totalInConvex: number;
  syncedToResend: number;
  alreadyInResend: number;
  errors: Array<{ email: string; message: string }>;
};

// One-shot backfill — enumerates every Convex waitlist row for the given
// audience and replays it into the corresponding Resend audience. Idempotent
// against Resend: contacts.create returns an "already exists" error for
// addresses already in the audience, which is treated as success.
//
// Run via convex CLI (dry-run by default — returns a count without touching
// Resend; pass `dryRun: false` once the count looks right):
//
//   npx convex run --prod waitlist/actions:backfillResendAudience \
//     '{"audience":"imobiliaria"}'
//   npx convex run --prod waitlist/actions:backfillResendAudience \
//     '{"audience":"imobiliaria","dryRun":false}'
//
// Use case: the website's `/imobiliaria` LP was launched before the
// `RESEND_IMOBILIARIA_AUDIENCE_ID` env var was provisioned, so the
// per-signup `addToResendAudience` action skipped the sync. Convex retained
// every row; this rebuilds the Resend projection from the source of truth.
export const backfillResendAudience = internalAction({
  args: {
    audience: waitlistAudienceValidator,
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { audience, dryRun = true }): Promise<BackfillSummary> => {
    const audienceId = getWaitlistAudienceId(audience);
    if (!audienceId) {
      throw new Error(
        `RESEND_${audience.toUpperCase()}_AUDIENCE_ID is not set on this deployment — set it before running the backfill.`,
      );
    }

    const rows = await ctx.runQuery(internal.waitlist.useCases.listByAudienceInternal, {
      audience,
    });
    const totalInConvex = rows.length;

    console.log(
      `[backfill] ${dryRun ? "DRY RUN — " : ""}audience=${audience} ` +
        `audienceId=${audienceId} totalInConvex=${totalInConvex}`,
    );

    if (dryRun) {
      return {
        dryRun: true,
        audience,
        audienceId,
        totalInConvex,
        syncedToResend: 0,
        alreadyInResend: 0,
        errors: [],
      };
    }

    const resend = new Resend(getResendApiKey());
    let syncedToResend = 0;
    let alreadyInResend = 0;
    const errors: Array<{ email: string; message: string }> = [];

    for (const row of rows) {
      const { error } = await resend.contacts.create({
        email: row.email,
        audienceId,
        unsubscribed: false,
      });

      if (!error) {
        syncedToResend++;
        continue;
      }

      const message = error.message ?? String(error);
      if (/already exist/i.test(message)) {
        alreadyInResend++;
        continue;
      }

      errors.push({ email: row.email, message });
      console.error(`[backfill] failed for ${audience}:${row.email}`, error);
    }

    console.log(
      `[backfill] done audience=${audience} synced=${syncedToResend} ` +
        `alreadyPresent=${alreadyInResend} errors=${errors.length}`,
    );

    return {
      dryRun: false,
      audience,
      audienceId,
      totalInConvex,
      syncedToResend,
      alreadyInResend,
      errors,
    };
  },
});
