"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  getResendApiKey,
  getResendFromEmail,
  getAppUrl,
  getWhatsAppApiUrl,
  getWhatsAppApiKey,
  getScoreProvider,
} from "../lib/env";
import { tierForScore } from "./domain";
import { resolveProvider } from "./scoreProviders";

// ─── Credit Score ────────────────────────────────────────────────────────────

/**
 * Resolves the configured provider, fetches the score, and persists via
 * `saveCreditReport`. Provider-agnostic: add new bureaus in scoreProviders.ts.
 */
export const fetchCreditScore = internalAction({
  args: { cpf: v.string(), agencyId: v.id("agencies") },
  handler: async (ctx, { cpf, agencyId }) => {
    const providerName = getScoreProvider();
    const provider = resolveProvider(providerName);

    let result: { score: number; providerRef?: string };
    try {
      result = await provider.fetchScore(cpf);
    } catch (err) {
      console.error(`[credit] ${provider.name} error, falling back to mock:`, err);
      result = await resolveProvider("mock").fetchScore(cpf);
    }

    await ctx.runMutation(internal.contracts.useCases.saveCreditReport, {
      agencyId,
      cpf,
      score: result.score,
      tier: tierForScore(result.score),
      provider: provider.name,
      providerRef: result.providerRef,
    });
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
      if (result.status === "rejected") console.error("[notifications]", result.reason);
    }
  },
});

async function sendEmail(args: NotificationArgs): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[notifications] RESEND_API_KEY not set, skipping email");
    return;
  }
  const resend = new Resend(getResendApiKey());
  const activationLink = `${getAppUrl()}/contracts/${args.publicId}`;

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

  const activationLink = `${getAppUrl()}/contracts/${args.publicId}`;
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

Falta só uma etapa: a assinatura da apólice, que é feita de forma rápida e totalmente digital pelo link abaixo.

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
              A sua apólice de garantia já está gerada e aguarda apenas a sua assinatura
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
              Após a assinatura, você receberá a confirmação da apólice e o seu contrato
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
                    Assinar minha apólice
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
              dúvida sobre a apólice e acompanhar você durante o processo de assinatura.
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
