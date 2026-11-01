"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { getAppUrl, getResendApiKey, getResendFromEmail, isEmailConfigured } from "../lib/env";
import { logError, logWarn } from "../lib/logger";
import {
  INVITABLE_ROLE,
  ONBOARDING_STATE,
  invitableRoleValidator,
  onboardingDecisionValidator,
} from "./domain";
import type { InvitableRole, OnboardingDecision, OnboardingState } from "./domain";

const DECISION_STATE = {
  approved: ONBOARDING_STATE.ACTIVE,
  rejected: ONBOARDING_STATE.REJECTED,
} as const satisfies Record<OnboardingDecision, OnboardingState>;

const REJECTED_PAGE_PATH = "/onboarding/rejected";

// Best-effort decision email, scheduled fire-and-forget from
// `applyOnboardingReview`. The review already committed; a delivery failure
// is logged, never re-thrown. Takes the agency id only — the address is
// resolved here so it never lands on the persisted scheduled-function args.
//
// Failure modes (all logged, none re-thrown):
//   - agency deleted, or no contact email at all → skip
//   - state moved on before execution (e.g. owner already reopened) → skip
//   - RESEND_API_KEY or RESEND_FROM_EMAIL missing → skip (unconfigured deployment)
//   - Resend API rejects → log
export const sendOnboardingDecisionEmail = internalAction({
  args: {
    agencyId: v.id("agencies"),
    decision: onboardingDecisionValidator,
  },
  handler: async (ctx, { agencyId, decision }) => {
    const delivery = await ctx.runQuery(
      internal.agencies.adminUseCases.getOnboardingDecisionDeliveryInternal,
      { agencyId },
    );
    if (delivery === null) {
      logWarn("[onboarding] no deliverable contact for decision email, skipping", { agencyId });
      return;
    }

    if (delivery.onboardingState !== DECISION_STATE[decision]) {
      logWarn("[onboarding] agency state changed before decision email, skipping", {
        agencyId,
        decision,
      });
      return;
    }

    if (!isEmailConfigured()) {
      logWarn("[onboarding] email not configured (Resend key or sender), skipping decision email");
      return;
    }

    const appUrl = getAppUrl();
    const message =
      decision === "approved"
        ? {
            subject: "Seu cadastro na MUTAV foi aprovado",
            html: buildApprovedHtml({ agencyName: delivery.agencyName, signInLink: appUrl }),
          }
        : {
            subject: "Seu cadastro na MUTAV precisa de ajustes",
            html: buildRejectedHtml({
              agencyName: delivery.agencyName,
              reason: delivery.rejectionReason,
              resubmitLink: `${appUrl}${REJECTED_PAGE_PATH}`,
            }),
          };

    const resend = new Resend(getResendApiKey());
    const { error } = await resend.emails.send({
      from: getResendFromEmail(),
      to: delivery.email,
      subject: message.subject,
      html: message.html,
    });

    if (error) {
      logError("[onboarding] decision email delivery failed", { agencyId, decision, error });
    }
  },
});

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Agency name and rejection reason are free text typed by people; never let
// them inject markup into the email.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function buildLayout({ title, body }: { title: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">
        <tr>
          <td style="padding-bottom:36px;">
            <span style="font-size:15px;font-weight:700;letter-spacing:0.1em;color:#1a1a1a;">MUTAV</span>
          </td>
        </tr>
${body}
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

function buildCta({ href, label }: { href: string; label: string }): string {
  return `        <tr>
          <td style="padding-bottom:32px;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:#c47e10;">
                  <a href="${href}"
                     style="display:block;padding:14px 32px;color:#1a1a1a;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.02em;">
                    ${label}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

export function buildApprovedHtml({
  agencyName,
  signInLink,
}: {
  agencyName: string;
  signInLink: string;
}): string {
  return buildLayout({
    title: "Cadastro aprovado — MUTAV",
    body: `        <tr>
          <td style="font-size:15px;color:#1a1a1a;line-height:1.75;">
            <p style="margin:0 0 16px;">Olá, ${escapeHtml(agencyName)}!</p>
            <p style="margin:0 0 16px;">
              Boas notícias: o cadastro da sua imobiliária na <strong>MUTAV</strong> foi
              analisado e aprovado pela nossa equipe.
            </p>
            <p style="margin:0 0 32px;">
              A partir de agora você já pode entrar no painel e emitir as primeiras
              garantias locatícias para os seus clientes.
            </p>
          </td>
        </tr>
${buildCta({ href: signInLink, label: "Entrar no painel" })}`,
  });
}

export function buildRejectedHtml({
  agencyName,
  reason,
  resubmitLink,
}: {
  agencyName: string;
  reason: string | null;
  resubmitLink: string;
}): string {
  const reasonBlock = reason
    ? `            <p style="margin:0 0 8px;font-size:13px;color:#6b6860;">Motivo informado pela nossa equipe:</p>
            <p style="margin:0 0 24px;padding:12px 16px;border-left:2px solid #c47e10;background-color:#fff8ee;">${escapeHtml(reason)}</p>`
    : "";

  return buildLayout({
    title: "Cadastro não aprovado — MUTAV",
    body: `        <tr>
          <td style="font-size:15px;color:#1a1a1a;line-height:1.75;">
            <p style="margin:0 0 16px;">Olá, ${escapeHtml(agencyName)}!</p>
            <p style="margin:0 0 16px;">
              Analisamos o cadastro da sua imobiliária na <strong>MUTAV</strong> e, por
              enquanto, não conseguimos aprová-lo.
            </p>
${reasonBlock}
            <p style="margin:0 0 32px;">
              Seus dados continuam salvos. Basta acessar o link abaixo, corrigir o que
              for necessário e reenviar o cadastro para uma nova análise.
            </p>
          </td>
        </tr>
${buildCta({ href: resubmitLink, label: "Corrigir e reenviar" })}`,
  });
}

// ─── Member invites ──────────────────────────────────────────────────────────

const ROLE_LABEL_PT: Record<InvitableRole, string> = {
  [INVITABLE_ROLE.ADMIN]: "administrador(a)",
  [INVITABLE_ROLE.MEMBER]: "membro",
};

type InviteEmailArgs = {
  email: string;
  agencyName: string;
  inviterName: string;
  role: InvitableRole;
  expiresAt: string;
};

/**
 * Delivers an agency invitation. Scheduled by `inviteMember`; the invite row is
 * already committed, so a delivery failure is logged and never rolls it back —
 * the invitee still sees it on the welcome screen after signing in. Skips the
 * send when email is not configured; `inviteMember` does not schedule it then.
 */
export const sendInviteEmail = internalAction({
  args: {
    email: v.string(),
    agencyName: v.string(),
    inviterName: v.string(),
    role: invitableRoleValidator,
    expiresAt: v.string(),
  },
  handler: async (_ctx, args) => {
    if (!isEmailConfigured()) {
      logWarn("[invites] email not configured (RESEND_API_KEY/RESEND_FROM_EMAIL), skipping send");
      return;
    }
    try {
      const resend = new Resend(getResendApiKey());
      await resend.emails.send({
        from: getResendFromEmail(),
        to: args.email,
        subject: `Convite para a equipe ${args.agencyName} na MUTAV`,
        html: buildInviteEmailHtml({ ...args, acceptLink: `${getAppUrl()}/onboarding` }),
      });
    } catch (error) {
      logError("[invites] delivery rejected", { reason: error });
    }
  },
});

function formatExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(expiresAt));
}

function buildInviteEmailHtml(args: InviteEmailArgs & { acceptLink: string }): string {
  const agencyName = escapeHtml(args.agencyName);
  const inviterName = escapeHtml(args.inviterName);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Convite para ${agencyName} — MUTAV</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">
        <tr>
          <td style="padding-bottom:36px;">
            <span style="font-size:15px;font-weight:700;letter-spacing:0.1em;color:#1a1a1a;">MUTAV</span>
          </td>
        </tr>
        <tr>
          <td style="font-size:15px;color:#1a1a1a;line-height:1.75;">
            <p style="margin:0 0 16px;">Olá!</p>
            <p style="margin:0 0 16px;">
              ${inviterName} convidou você para entrar na equipe da
              <strong>${agencyName}</strong> na MUTAV como ${ROLE_LABEL_PT[args.role]}.
            </p>
            <p style="margin:0 0 32px;">
              Entre com este endereço de e-mail (${escapeHtml(args.email)}) e aceite o convite
              na tela inicial. Não é preciso cadastrar uma nova imobiliária.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:32px;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:#c47e10;">
                  <a href="${args.acceptLink}"
                     style="display:block;padding:14px 32px;color:#1a1a1a;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.02em;">
                    Aceitar convite
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#6b6860;line-height:1.75;padding-bottom:40px;">
            <p style="margin:0;">
              Este convite vale até ${formatExpiry(args.expiresAt)}. Se você não esperava este
              e-mail, pode ignorá-lo com segurança.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
