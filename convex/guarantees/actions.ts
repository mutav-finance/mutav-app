"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "../_generated/server";
import {
  getResendApiKey,
  getResendFromEmail,
  getAppUrl,
  getWhatsAppApiUrl,
  getWhatsAppApiKey,
  getOptionalResendApiKey,
} from "../lib/env";
import { logError, logWarn } from "../lib/logger";

// ─── Review decision → agency ─────────────────────────────────────────────────

const BASIS_POINTS_PER_PERCENT = 100;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Tells the agency Mutav decided its draft. Scheduled by `acceptAnalysis` /
 * `refuseAnalysis` after the decision is committed, so a delivery failure
 * never rolls the decision back. Skipped, with a warning, when Resend is not
 * configured. The email carries no score and no tenant identity — only the
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
    const apiKey = getOptionalResendApiKey();
    if (!apiKey) {
      logWarn("[notifications] RESEND_API_KEY not set, skipping review decision email");
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
      await new Resend(apiKey).emails.send({
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
 * Tells the agency Mutav activated its guarantee. Scheduled by `staffActivate`
 * after the activation is committed, so a delivery failure never rolls it
 * back. Skipped, with a warning, when Resend is not configured. Carries only
 * the guarantee id — no tenant identity, no figures.
 */
export const sendGuaranteeActivatedNotification = internalAction({
  args: { publicId: v.string(), recipients: v.array(v.string()) },
  handler: async (_ctx, args) => {
    const apiKey = getOptionalResendApiKey();
    if (!apiKey) {
      logWarn("[notifications] RESEND_API_KEY not set, skipping activation email");
      return;
    }
    if (args.recipients.length === 0) {
      logWarn("[notifications] activation has no recipient", { publicId: args.publicId });
      return;
    }
    const link = `${getAppUrl()}/guarantees/${encodeURIComponent(args.publicId)}`;
    const publicId = escapeHtml(args.publicId);
    try {
      await new Resend(apiKey).emails.send({
        from: getResendFromEmail(),
        to: args.recipients,
        subject: `Garantia ativada — ${args.publicId}`,
        html: `<!DOCTYPE html><html lang="pt-BR"><body style="font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6;"><p>A Mutav registrou o contrato assinado e ativou a garantia <strong>${publicId}</strong>.</p><p>A garantia está em vigor a partir de hoje. A taxa de ativação entra na próxima fatura mensal.</p><p><a href="${link}">Ver garantia</a></p><p style="color:#9e9c98;font-size:12px;">MUTAV · e-mail automático.</p></body></html>`,
      });
    } catch (error) {
      logError("[notifications] activation email rejected", { reason: error });
    }
  },
});

// ─── Notifications ────────────────────────────────────────────────────────────

type NotificationArgs = {
  publicId: string;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  rentCents: number;
  availableGuaranteeCents: number;
  feeCents: number;
};

export const sendProposalNotifications = internalAction({
  args: {
    publicId: v.string(),
    tenantName: v.string(),
    tenantEmail: v.string(),
    tenantPhone: v.string(),
    rentCents: v.number(),
    availableGuaranteeCents: v.number(),
    feeCents: v.number(),
  },
  handler: async (_ctx, args) => {
    const results = await Promise.allSettled([sendEmail(args), sendWhatsApp(args)]);
    for (const result of results) {
      if (result.status === "rejected") {
        logError("[notifications] delivery rejected", { reason: result.reason });
      }
    }
  },
});

async function sendEmail(args: NotificationArgs): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    logWarn("[notifications] RESEND_API_KEY not set, skipping email");
    return;
  }
  const resend = new Resend(getResendApiKey());
  const activationLink = `${getAppUrl()}/guarantees/${args.publicId}`;

  await resend.emails.send({
    from: getResendFromEmail(),
    to: args.tenantEmail,
    subject: `Proposta de garantia locatícia — ${args.publicId}`,
    html: buildEmailHtml({ ...args, activationLink }),
  });
}

async function sendWhatsApp(args: NotificationArgs): Promise<void> {
  const apiUrl = getWhatsAppApiUrl();
  const apiKey = getWhatsAppApiKey();

  if (!apiUrl || !apiKey) return;

  const activationLink = `${getAppUrl()}/guarantees/${args.publicId}`;
  const message = buildWhatsAppMessage({ ...args, activationLink });

  await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ phone: args.tenantPhone, message }),
  });
}

function buildWhatsAppMessage(args: NotificationArgs & { activationLink: string }): string {
  return `Olá, *${args.tenantName}*! 👋

Parabéns pelo novo lar! Sua *Garantia Locatícia MUTAV* está criada e pronta para entrar em vigor.

Falta só uma etapa: a assinatura da garantia, que é feita de forma rápida e totalmente digital pelo link abaixo.

👉 ${args.activationLink}

Qualquer dúvida, fale com a imobiliária responsável pela sua locação. 🏠`;
}

function buildEmailHtml(args: NotificationArgs & { activationLink: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Sua garantia locatícia está pronta — MUTAV</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">

        <!-- Logo -->
        <tr>
          <td style="padding-bottom:36px;">
            <span style="font-size:15px;font-weight:700;letter-spacing:0.1em;color:#1a1a1a;">MUTAV</span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="font-size:15px;color:#1a1a1a;line-height:1.75;">

            <p style="margin:0 0 16px;">Olá, ${args.tenantName}!</p>

            <p style="margin:0 0 16px;">
              Parabéns pelo novo lar! Ficamos muito felizes em saber que a sua locação
              contará com a proteção da <strong>Garantia Locatícia MUTAV</strong>.
              Você escolheu a forma mais moderna e descomplicada de garantir o seu contrato,
              com total segurança para você e para o locador.
            </p>

            <p style="margin:0 0 16px;">
              A sua garantia já está gerada e aguarda apenas a sua assinatura
              para entrar em vigor. O processo é 100% digital e leva menos de dois minutos:
              basta acessar o botão abaixo, confirmar os seus dados e assinar com biometria.
              Simples assim.
            </p>

            <p style="margin:0 0 16px;">
              Sabemos que a mudança para um novo imóvel é um momento cheio de etapas e
              informações. Por isso, fizemos questão de tornar essa última etapa o mais
              rápida e tranquila possível para você.
            </p>

            <p style="margin:0 0 32px;">
              Após a assinatura, você receberá a confirmação da garantia e o seu contrato
              estará completamente ativo. Bem-vindo ao seu novo lar!
            </p>

          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding-bottom:32px;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:#c47e10;">
                  <a href="${args.activationLink}"
                     style="display:block;padding:14px 32px;color:#1a1a1a;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.02em;">
                    Assinar minha garantia
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Support -->
        <tr>
          <td style="font-size:14px;color:#1a1a1a;line-height:1.75;padding-bottom:40px;">
            <p style="margin:0 0 12px;">
              O corretor ou a imobiliária responsável pela sua locação poderão tirar qualquer
              dúvida sobre a garantia e acompanhar você durante o processo de assinatura.
            </p>
            <p style="margin:0;color:#6b6860;font-size:13px;">
              Este link é válido por 30 dias. Caso tenha expirado, entre em contato com a imobiliária para solicitar o reenvio.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="border-top:1px solid #d9d7d2;padding-top:20px;">
            <p style="margin:0;font-size:12px;color:#9e9c98;line-height:1.6;">
              MUTAV · Este é um e-mail automático, não responda diretamente a esta mensagem.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
