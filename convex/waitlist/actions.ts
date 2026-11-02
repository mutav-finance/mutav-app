"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { type ActionCtx, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  EMAIL_NOTE_STYLE,
  EMAIL_PARAGRAPH_STYLE,
  renderEmailButton,
  renderEmailLayout,
} from "../lib/email/layout";
import {
  getAppUrlOrNull,
  getResendApiKey,
  getResendFromEmail,
  getWaitlistAudienceId,
} from "../lib/env";
import { logError, logInfo, logWarn } from "../lib/logger";
import {
  WAITLIST_AUDIENCE,
  type WaitlistDelivery,
  type WaitlistId,
  summarizeBackfillFailures,
  waitlistAudienceValidator,
} from "./domain";

// Both delivery actions take the waitlist row id, never the address itself.
// Convex persists a function's arguments — on the `_scheduled_functions`
// record for a scheduled call, and in the deployment function log, which is
// US-hosted and readable from the dashboard, a surface outside every access
// control in the security policy. An address handed over as an argument
// therefore outlives the send by the whole retention window. Resolved here
// instead, it exists only in this action's runtime memory and in the outbound
// Resend payload.
//
// Resolution runs before the vendor-config guards on purpose: whether the row
// still exists is the question that decides if there is anything to deliver at
// all, and putting it first keeps the not-found branch reachable without a
// configured vendor.
//
// Row-not-found contract: a warning, then a no-op return — never a throw. The
// row can be erased between scheduling and execution (an LGPD erasure request,
// a manual cleanup), and failing a fire-and-forget side effect over a benign
// race would put a red scheduled-function entry on the dashboard for something
// nobody needs to act on. A silent return would hide the other cause — a bad
// id, i.e. a real bug — so the miss is logged rather than swallowed.
async function resolveDelivery(
  ctx: ActionCtx,
  { waitlistId, caller }: { waitlistId: WaitlistId; caller: string },
): Promise<WaitlistDelivery | null> {
  const delivery = await ctx.runQuery(internal.waitlist.useCases.getForDeliveryInternal, {
    waitlistId,
  });

  if (delivery === null) {
    logWarn("[waitlist] row no longer exists, skipping", { caller, waitlistId });
  }

  return delivery;
}

// Best-effort write to a Resend audience so the team can run broadcast
// campaigns later. Convex is the source of truth; this is a projection.
//
// Failure modes (all logged, none re-thrown):
//   - waitlist row deleted before execution → skip
//   - RESEND_API_KEY missing → skip (common in local dev without secrets)
//   - Audience env var missing for the audience → skip
//   - Resend API rejects (rate-limit, invalid email, etc.) → log and continue.
//     The Convex row stays; backfill is a manual query+replay if needed.
export const addToResendAudience = internalAction({
  args: {
    waitlistId: v.id("waitlist"),
  },
  handler: async (ctx, { waitlistId }) => {
    const delivery = await resolveDelivery(ctx, { waitlistId, caller: "addToResendAudience" });
    if (delivery === null) return;
    const { email, audience } = delivery;

    if (!process.env.RESEND_API_KEY) {
      logWarn("[waitlist] RESEND_API_KEY not set, skipping Resend sync");
      return;
    }

    const audienceId = getWaitlistAudienceId(audience);
    if (!audienceId) {
      logWarn(`[waitlist] no Resend audience id configured for "${audience}", skipping sync`);
      return;
    }

    const resend = new Resend(getResendApiKey());

    const { error } = await resend.contacts.create({
      email,
      audienceId,
      unsubscribed: false,
    });

    if (error) {
      logError("[waitlist] Resend contacts.create failed", { audience, error });
    }
  },
});

// CTAs for the welcome email. These are marketing constants, not secrets, so
// they live in code rather than env — a copy change is a code change here.
const BOOK_A_CALL_URL = "https://calendar.app.google/41vSpkz8pMoK7Saw9";
const INSTAGRAM_URL = "https://www.instagram.com/mutav.br/";

// Best-effort welcome email, scheduled fire-and-forget from the `join`
// mutation (mirrors addToResendAudience). Convex already holds the signup;
// a delivery failure is logged, never re-thrown, so it can't affect signup.
//
// Scope: only the `imobiliaria` audience has approved copy today. Other
// audiences are skipped (logged) until their template lands — see mutav#57.
//
// Failure modes (all logged, none re-thrown):
//   - waitlist row deleted before execution → skip
//   - RESEND_API_KEY missing → skip (local dev without secrets)
//   - audience without a template → skip
//   - APP_URL missing (it hosts the logo) → skip
//   - Resend API rejects (unverified domain, invalid address, …) → log
export const sendWelcomeEmail = internalAction({
  args: {
    waitlistId: v.id("waitlist"),
  },
  handler: async (ctx, { waitlistId }) => {
    const delivery = await resolveDelivery(ctx, { waitlistId, caller: "sendWelcomeEmail" });
    if (delivery === null) return;
    const { email, audience } = delivery;

    if (!process.env.RESEND_API_KEY) {
      logWarn("[waitlist] RESEND_API_KEY not set, skipping welcome email");
      return;
    }

    if (audience !== WAITLIST_AUDIENCE.IMOBILIARIA) {
      logWarn(`[waitlist] no welcome template for "${audience}" yet, skipping`);
      return;
    }

    const appUrl = getAppUrlOrNull();
    if (appUrl === null) {
      logWarn("[waitlist] APP_URL not set, skipping welcome email");
      return;
    }

    const resend = new Resend(getResendApiKey());

    const { error } = await resend.emails.send({
      from: getResendFromEmail(),
      to: email,
      subject: "Bem-vindo à MUTAV, vamos conversar?",
      html: buildImobiliariaWelcomeHtml({ appUrl }),
    });

    if (error) {
      logError("[waitlist] welcome message delivery failed", { audience, error });
    }
  },
});

// Built on the shared branded layout; only the body copy and the calendar CTA
// are specific to the waitlist welcome.
export function buildImobiliariaWelcomeHtml({ appUrl }: { appUrl: string }): string {
  return renderEmailLayout({
    appUrl,
    title: "Bem-vindo à MUTAV",
    preheader: "Recebemos seu cadastro. Que tal uma conversa rápida com o nosso time?",
    heading: "Que bom ter você por aqui!",
    bodyHtml: `<p style="${EMAIL_NOTE_STYLE}font-style:italic;letter-spacing:0.06em;text-transform:uppercase;">Feito para quem tem muito o que fazer</p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  Recebemos seu cadastro. A MUTAV está construindo uma nova forma de garantia locatícia para imobiliárias: mais simples e mais segura para você.
                </p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  Que tal uma conversa rápida com o nosso time? Queremos entender a sua operação e mostrar como a MUTAV se encaixa no seu dia a dia.
                </p>
                <div style="margin:8px 0 20px 0;">
                ${renderEmailButton({ label: "Agendar uma conversa", url: BOOK_A_CALL_URL })}
                </div>
                <p style="${EMAIL_NOTE_STYLE}">
                  Prefere nos conhecer aos poucos? Estamos no
                  <a href="${INSTAGRAM_URL}" style="color:#6b6860;font-weight:700;text-decoration:underline;">Instagram</a>.
                </p>`,
    reason: "você se cadastrou na lista de espera da MUTAV para imobiliárias.",
  });
}

type BackfillSummary = {
  dryRun: boolean;
  audience: "investidor" | "imobiliaria";
  audienceId: string;
  totalInConvex: number;
  syncedToResend: number;
  alreadyInResend: number;
  failedCount: number;
  failureReasons: readonly string[];
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

    logInfo(
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
        failedCount: 0,
        failureReasons: [],
      };
    }

    const resend = new Resend(getResendApiKey());
    let syncedToResend = 0;
    let alreadyInResend = 0;
    const failureMessages: string[] = [];

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

      failureMessages.push(message);
      logError("[backfill] contact sync failed", { audience, error });
    }

    logInfo(
      `[backfill] done audience=${audience} synced=${syncedToResend} ` +
        `alreadyPresent=${alreadyInResend} failed=${failureMessages.length}`,
    );

    return {
      dryRun: false,
      audience,
      audienceId,
      totalInConvex,
      syncedToResend,
      alreadyInResend,
      failedCount: failureMessages.length,
      failureReasons: summarizeBackfillFailures(failureMessages),
    };
  },
});
