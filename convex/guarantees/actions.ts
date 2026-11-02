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
  buildProposalEmail,
  buildProposalWhatsApp,
  escapeHtml,
  type ProposalNotice,
} from "./notifications";

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
      ? `Análise Mutav aprovada — garantia ${args.publicId}`
      : `Análise Mutav recusada — garantia ${args.publicId}`;
    const body =
      args.decision.outcome === "accepted"
        ? `<p>A Mutav aprovou a análise da garantia <strong>${escapeHtml(args.publicId)}</strong> com taxa de ${(args.decision.feeRateBps / BASIS_POINTS_PER_PERCENT).toFixed(2)}% do aluguel.</p><p>O próximo passo é o envio do contrato ao inquilino para assinatura.</p>`
        : `<p>A Mutav recusou a análise da garantia <strong>${escapeHtml(args.publicId)}</strong>.</p><p>Motivo: ${escapeHtml(args.decision.reason)}</p><p>A proposta foi encerrada. Você pode iniciar uma nova proposta a qualquer momento.</p>`;
    try {
      await new Resend(getResendApiKey()).emails.send({
        from: getResendFromEmail(),
        to: args.recipients,
        subject,
        html: `<!DOCTYPE html><html lang="pt-BR"><body style="font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6;">${body}<p><a href="${link}">Ver garantia</a></p><p style="color:#9e9c98;font-size:12px;">MUTAV · e-mail automático.</p></body></html>`,
      });
    } catch (error) {
      logError("[notifications] review decision email rejected", { reason: error });
    }
  },
});

/**
 * Tells the agency its guarantee is active. Scheduled by `activateSignedDraft`
 * once the activation is committed (signed contract approved and reserve
 * capacity check passed), so a delivery failure never rolls it back. Skipped,
 * with a warning, when Resend is not configured. Carries only the guarantee
 * id — no tenant identity, no figures.
 */
export const sendGuaranteeActivatedNotification = internalAction({
  args: { publicId: v.string(), recipients: v.array(v.string()) },
  handler: async (_ctx, args) => {
    if (!isEmailConfigured()) {
      logWarn("[notifications] email not configured, skipping activation email");
      return;
    }
    if (args.recipients.length === 0) {
      logWarn("[notifications] activation has no recipient", { publicId: args.publicId });
      return;
    }
    const link = `${getAppUrl()}/guarantees/${encodeURIComponent(args.publicId)}`;
    const publicId = escapeHtml(args.publicId);
    try {
      await new Resend(getResendApiKey()).emails.send({
        from: getResendFromEmail(),
        to: args.recipients,
        subject: `Garantia ativada — ${args.publicId}`,
        html: `<!DOCTYPE html><html lang="pt-BR"><body style="font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6;"><p>A garantia <strong>${publicId}</strong> foi aprovada pela Mutav e está ativa.</p><p>A garantia está em vigor a partir de hoje. A taxa de ativação entra na próxima fatura mensal.</p><p><a href="${link}">Ver garantia</a></p><p style="color:#9e9c98;font-size:12px;">MUTAV · e-mail automático.</p></body></html>`,
      });
    } catch (error) {
      logError("[notifications] activation email rejected", { reason: error });
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
  const { subject, html } = buildProposalEmail(notice);
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

const DOCUMENT_LABEL_PT: Record<"rentalContract" | "inspection" | "policy", string> = {
  rentalContract: "Contrato de locação assinado",
  inspection: "Vistoria",
  policy: "Apólice",
};

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
    const guaranteeLink = `${getAppUrl()}/guarantees/${encodeURIComponent(args.guaranteePublicId)}`;
    const label = DOCUMENT_LABEL_PT[args.documentKey];
    try {
      await resend.emails.send({
        from: getResendFromEmail(),
        to: args.to,
        subject: `Documento recusado — garantia ${args.guaranteePublicId}`,
        html: `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Documento recusado — MUTAV</title></head>
<body style="margin:0;padding:24px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <p style="font-size:15px;font-weight:700;letter-spacing:0.1em;">MUTAV</p>
  <p>O documento <strong>${escapeHtml(label)}</strong> enviado para a garantia
  <strong>${escapeHtml(args.guaranteePublicId)}</strong> foi recusado pela equipe Mutav.</p>
  <p><strong>Motivo:</strong> ${escapeHtml(args.rejectionReason)}</p>
  <p>Envie um novo arquivo pela página da garantia:
  <a href="${escapeHtml(guaranteeLink)}">${escapeHtml(guaranteeLink)}</a></p>
  <p style="font-size:12px;color:#9e9c98;">Este é um e-mail automático, não responda diretamente a esta mensagem.</p>
</body>
</html>`,
      });
    } catch (error) {
      logError("[notifications] document rejection email failed", { reason: error });
    }
  },
});
