"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "../_generated/server";
import {
  getAppUrl,
  getResendApiKey,
  getResendFromEmail,
  getWhatsAppApiUrl,
  getWhatsAppApiKey,
  isEmailConfigured,
} from "../lib/env";
import { logError, logWarn } from "../lib/logger";
import {
  buildDocumentRejectedEmail,
  buildProposalEmail,
  buildProposalWhatsApp,
  type ProposalNotice,
} from "./notifications";
import { escapeHtml } from "../lib/email/escape";
import { EMAIL_PARAGRAPH_STYLE, renderEmailButton, renderEmailLayout } from "../lib/email/layout";

// ─── Review decision → agency ─────────────────────────────────────────────────

const BASIS_POINTS_PER_PERCENT = 100;

/**
 * Tells the agency Mutav decided its draft. Scheduled by `acceptAnalysis` /
 * `refuseAnalysis` after the decision is committed, so a delivery failure
 * never rolls the decision back. Skipped, with a warning, when Resend is not
 * configured (`isEmailConfigured`). The email carries no score and no tenant identity — only the
 * guarantee id, the outcome and what the agency needs to act on it.
 */
export const sendReviewDecisionNotification = internalAction({
  args: {
    publicId: v.string(),
    recipients: v.array(v.string()),
    decision: v.union(
      v.object({ outcome: v.literal("accepted"), feeRateBps: v.number() }),
      v.object({ outcome: v.literal("refused"), reason: v.string() }),
    ),
  },
  handler: async (_ctx, args) => {
    if (!isEmailConfigured()) {
      logWarn("[notifications] email not configured, skipping review decision email");
      return;
    }
    if (args.recipients.length === 0) {
      logWarn("[notifications] review decision has no recipient", { publicId: args.publicId });
      return;
    }
    const link = `${getAppUrl()}/guarantees/${args.publicId}`;
    const accepted = args.decision.outcome === "accepted";
    const subject = accepted
      ? `Análise MUTAV aprovada — garantia ${args.publicId}`
      : `Análise MUTAV recusada — garantia ${args.publicId}`;
    const body =
      args.decision.outcome === "accepted"
        ? `<p style="${EMAIL_PARAGRAPH_STYLE}">A MUTAV aprovou a análise da garantia <strong>${escapeHtml(args.publicId)}</strong> com taxa de ${(args.decision.feeRateBps / BASIS_POINTS_PER_PERCENT).toFixed(2)}% do aluguel.</p><p style="${EMAIL_PARAGRAPH_STYLE}">O próximo passo é o envio do contrato ao inquilino para assinatura.</p>`
        : `<p style="${EMAIL_PARAGRAPH_STYLE}">A MUTAV recusou a análise da garantia <strong>${escapeHtml(args.publicId)}</strong>.</p><p style="${EMAIL_PARAGRAPH_STYLE}">Motivo: ${escapeHtml(args.decision.reason)}</p><p style="${EMAIL_PARAGRAPH_STYLE}">A proposta foi encerrada. Você pode iniciar uma nova proposta a qualquer momento.</p>`;
    const html = renderEmailLayout({
      appUrl: getAppUrl(),
      title: subject,
      preheader: subject,
      bodyHtml: `${body}${renderEmailButton({ label: "Ver garantia", url: link })}`,
      reason: "a sua imobiliária pediu uma análise de garantia à MUTAV.",
    });
    try {
      await new Resend(getResendApiKey()).emails.send({
        from: getResendFromEmail(),
        to: args.recipients,
        subject,
        html,
      });
    } catch (error) {
      logError("[notifications] review decision email rejected", { reason: error });
    }
  },
});

// ─── Notifications ────────────────────────────────────────────────────────────

export const sendProposalNotifications = internalAction({
  args: {
    publicId: v.string(),
    tenantName: v.string(),
    tenantEmail: v.string(),
    tenantPhone: v.string(),
    agencyName: v.string(),
    rentCents: v.number(),
    feeCents: v.number(),
    coverageCents: v.number(),
  },
  handler: async (_ctx, args) => {
    const { tenantEmail, tenantPhone, ...notice } = args;
    const results = await Promise.allSettled([
      sendEmail({ to: tenantEmail, notice }),
      sendWhatsApp({ phone: tenantPhone, notice }),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        logError("[notifications] delivery rejected", { reason: result.reason });
      }
    }
  },
});

async function sendEmail({ to, notice }: { to: string; notice: ProposalNotice }): Promise<void> {
  if (!isEmailConfigured()) {
    logWarn("[notifications] email not configured, skipping proposal email");
    return;
  }
  const resend = new Resend(getResendApiKey());
  const { subject, html } = buildProposalEmail(notice, { appUrl: getAppUrl() });
  await resend.emails.send({ from: getResendFromEmail(), to, subject, html });
}

async function sendWhatsApp({
  phone,
  notice,
}: {
  phone: string;
  notice: ProposalNotice;
}): Promise<void> {
  const apiUrl = getWhatsAppApiUrl();
  const apiKey = getWhatsAppApiKey();

  if (!apiUrl || !apiKey) return;

  await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ phone, message: buildProposalWhatsApp(notice) }),
  });
}

// ─── Guarantee document review ────────────────────────────────────────────────

/**
 * Tells the agency a document attached to one of its guarantees was rejected,
 * with the reviewer's reason, so it can upload a corrected file. Skips when
 * Resend is not configured — the rejection itself is already committed and
 * visible on the guarantee page.
 */
export const sendDocumentRejectedEmail = internalAction({
  args: {
    to: v.string(),
    guaranteePublicId: v.string(),
    documentKey: v.union(v.literal("rentalContract"), v.literal("inspection"), v.literal("policy")),
    rejectionReason: v.string(),
  },
  handler: async (_ctx, args) => {
    if (!isEmailConfigured()) {
      logWarn("[notifications] email not configured, skipping document rejection email");
      return;
    }
    const resend = new Resend(getResendApiKey());
    const { subject, html } = buildDocumentRejectedEmail(
      {
        guaranteePublicId: args.guaranteePublicId,
        documentKey: args.documentKey,
        rejectionReason: args.rejectionReason,
      },
      { appUrl: getAppUrl() },
    );
    try {
      await resend.emails.send({ from: getResendFromEmail(), to: args.to, subject, html });
    } catch (error) {
      logError("[notifications] document rejection email failed", { reason: error });
    }
  },
});
