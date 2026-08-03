"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getResendApiKey, getResendFromEmail, getWaitlistAudienceId } from "../lib/env";
import { logError, logInfo, logWarn } from "../lib/logger";
import { WAITLIST_AUDIENCE, summarizeBackfillFailures, waitlistAudienceValidator } from "./domain";

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

// Email clients (Gmail, Outlook) strip inline SVG and block base64 images, so
// the logo must load from a public URL. It ships in the agency app's public
// dir (apps/agency/public/email/mutav-logo.png) and serves from that origin.
const MUTAV_LOGO_URL = "https://app.mutav.finance/email/mutav-logo.png";

// Best-effort welcome email, scheduled fire-and-forget from the `join`
// mutation (mirrors addToResendAudience). Convex already holds the signup;
// a delivery failure is logged, never re-thrown, so it can't affect signup.
//
// Scope: only the `imobiliaria` audience has approved copy today. Other
// audiences are skipped (logged) until their template lands — see mutav#57.
//
// Failure modes (all logged, none re-thrown):
//   - RESEND_API_KEY missing → skip (local dev without secrets)
//   - audience without a template → skip
//   - Resend API rejects (unverified domain, invalid address, …) → log
export const sendWelcomeEmail = internalAction({
  args: {
    email: v.string(),
    audience: waitlistAudienceValidator,
  },
  handler: async (_ctx, { email, audience }) => {
    if (!process.env.RESEND_API_KEY) {
      logWarn("[waitlist] RESEND_API_KEY not set, skipping welcome email");
      return;
    }

    if (audience !== WAITLIST_AUDIENCE.IMOBILIARIA) {
      logWarn(`[waitlist] no welcome template for "${audience}" yet, skipping`);
      return;
    }

    const resend = new Resend(getResendApiKey());

    const { error } = await resend.emails.send({
      from: getResendFromEmail(),
      to: email,
      subject: "Bem-vindo à MUTAV, vamos conversar?",
      html: buildImobiliariaWelcomeHtml(),
    });

    if (error) {
      logError("[waitlist] welcome message delivery failed", { audience, error });
    }
  },
});

// Single-column, inline-styled HTML — the lowest common denominator email
// clients render reliably. No external CSS, no web fonts (system stacks only).
//
// Brand grammar (Precision Brutalism): depth from stacked light surface planes
// (canvas → surface-3 header → white body → surface-2 footer), never shadows;
// 0px radius; amber (#c47e10) as the single scarcity signal; text on amber is
// always #1a1a1a, never white. The logo is the color-on-light wordmark variant.
function buildImobiliariaWelcomeHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f6f3;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-collapse:separate;">
            <tr>
              <td style="height:3px;background-color:#c47e10;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="background-color:#fff8ee;padding:28px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="${MUTAV_LOGO_URL}" width="43" height="36" alt="MUTAV" style="display:block;border:0;" />
                    </td>
                    <td style="padding-left:12px;vertical-align:middle;">
                      <span style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#c47e10;">MUTAV</span>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0 0;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-style:italic;letter-spacing:0.06em;color:#6b6860;text-transform:uppercase;">
                  Feito para quem tem muito o que fazer
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#ffffff;padding:36px 32px 8px 32px;">
                <h1 style="margin:0;font-size:26px;line-height:1.25;letter-spacing:-0.01em;color:#1a1a1a;text-transform:uppercase;">Que bom ter você por aqui!</h1>
              </td>
            </tr>
            <tr>
              <td style="background-color:#ffffff;padding:16px 32px 0 32px;">
                <p style="margin:0;font-size:16px;line-height:1.6;color:#3a3a3a;">
                  Recebemos seu cadastro. A MUTAV está construindo uma nova forma de garantia locatícia para imobiliárias: mais simples e mais segura para você.
                </p>
                <p style="margin:16px 0 0 0;font-size:16px;line-height:1.6;color:#3a3a3a;">
                  Que tal uma conversa rápida com o nosso time? Queremos entender a sua operação e mostrar como a MUTAV se encaixa no seu dia a dia.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#ffffff;padding:28px 32px 36px 32px;">
                <a href="${BOOK_A_CALL_URL}" style="display:inline-block;background-color:#c47e10;color:#fff8ee;text-decoration:none;font-size:16px;font-weight:700;letter-spacing:0.04em;padding:14px 28px;text-transform:uppercase;">
                  Agendar uma conversa
                </a>
                <p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;color:#6b6860;">
                  Prefere nos conhecer aos poucos? Estamos no
                  <a href="${INSTAGRAM_URL}" style="color:#6b6860;font-weight:700;text-decoration:underline;">Instagram</a>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#eeedea;padding:18px 32px;">
                <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:0.06em;color:#6b6860;text-transform:uppercase;">MUTAV · Garantia locatícia mais transparente do mercado</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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
