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
} from "../lib/env";
import { logError, logWarn } from "../lib/logger";
import { buildProposalEmail, buildProposalWhatsApp, type ProposalNotice } from "./notifications";

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
  if (!process.env.RESEND_API_KEY) {
    logWarn("[notifications] RESEND_API_KEY not set, skipping email");
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

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

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
    if (!process.env.RESEND_API_KEY) {
      logWarn("[notifications] RESEND_API_KEY not set, skipping document rejection email");
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
