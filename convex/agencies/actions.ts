"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { getAppUrl, getResendApiKey, getResendFromEmail, isEmailConfigured } from "../lib/env";
import { escapeHtml } from "../lib/email/escape";
import {
  EMAIL_NOTE_STYLE,
  EMAIL_PARAGRAPH_STYLE,
  EMAIL_QUOTE_STYLE,
  renderEmailLayout,
} from "../lib/email/layout";
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

const ONBOARDING_EMAIL_REASON = "a sua imobiliária se cadastrou na MUTAV.";

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
            html: buildApprovedHtml({
              appUrl,
              agencyName: delivery.agencyName,
              signInLink: appUrl,
            }),
          }
        : {
            subject: "Seu cadastro na MUTAV precisa de ajustes",
            html: buildRejectedHtml({
              appUrl,
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

export function buildApprovedHtml({
  appUrl,
  agencyName,
  signInLink,
}: {
  appUrl: string;
  agencyName: string;
  signInLink: string;
}): string {
  return renderEmailLayout({
    appUrl,
    title: "Cadastro aprovado — MUTAV",
    preheader: "O cadastro da sua imobiliária na MUTAV foi aprovado.",
    bodyHtml: `<p style="${EMAIL_PARAGRAPH_STYLE}">Olá, ${escapeHtml(agencyName)}!</p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  Boas notícias: o cadastro da sua imobiliária na <strong>MUTAV</strong> foi
                  analisado e aprovado pela nossa equipe.
                </p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  A partir de agora você já pode entrar no painel e emitir as primeiras
                  garantias locatícias para os seus clientes.
                </p>`,
    cta: { label: "Entrar no painel", url: signInLink },
    reason: ONBOARDING_EMAIL_REASON,
  });
}

export function buildRejectedHtml({
  appUrl,
  agencyName,
  reason,
  resubmitLink,
}: {
  appUrl: string;
  agencyName: string;
  reason: string | null;
  resubmitLink: string;
}): string {
  const reasonBlock = reason
    ? `<p style="${EMAIL_NOTE_STYLE}margin-bottom:8px;">Motivo informado pela nossa equipe:</p>
                <p style="${EMAIL_QUOTE_STYLE}">${escapeHtml(reason)}</p>`
    : "";

  return renderEmailLayout({
    appUrl,
    title: "Cadastro não aprovado — MUTAV",
    preheader: "O cadastro da sua imobiliária na MUTAV precisa de ajustes.",
    bodyHtml: `<p style="${EMAIL_PARAGRAPH_STYLE}">Olá, ${escapeHtml(agencyName)}!</p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  Analisamos o cadastro da sua imobiliária na <strong>MUTAV</strong> e, por
                  enquanto, não conseguimos aprová-lo.
                </p>
                ${reasonBlock}
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  Seus dados continuam salvos. Basta acessar o link abaixo, corrigir o que
                  for necessário e reenviar o cadastro para uma nova análise.
                </p>`,
    cta: { label: "Corrigir e reenviar", url: resubmitLink },
    reason: ONBOARDING_EMAIL_REASON,
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
      const appUrl = getAppUrl();
      const resend = new Resend(getResendApiKey());
      await resend.emails.send({
        from: getResendFromEmail(),
        to: args.email,
        subject: `Convite para a equipe ${args.agencyName} na MUTAV`,
        html: buildInviteEmailHtml({
          ...args,
          appUrl,
          acceptLink: `${appUrl}/onboarding`,
        }),
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

export function buildInviteEmailHtml(
  args: InviteEmailArgs & { appUrl: string; acceptLink: string },
): string {
  return renderEmailLayout({
    appUrl: args.appUrl,
    title: `Convite para ${args.agencyName} — MUTAV`,
    preheader: `${args.inviterName} convidou você para a equipe ${args.agencyName} na MUTAV.`,
    bodyHtml: `<p style="${EMAIL_PARAGRAPH_STYLE}">Olá!</p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  ${escapeHtml(args.inviterName)} convidou você para entrar na equipe da
                  <strong>${escapeHtml(args.agencyName)}</strong> na MUTAV como ${ROLE_LABEL_PT[args.role]}.
                </p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  Entre com este endereço de e-mail (${escapeHtml(args.email)}) e aceite o convite
                  na tela inicial. Não é preciso cadastrar uma nova imobiliária.
                </p>
                <p style="${EMAIL_NOTE_STYLE}">
                  Este convite vale até ${formatExpiry(args.expiresAt)}. Se você não esperava este
                  e-mail, pode ignorá-lo com segurança.
                </p>`,
    cta: { label: "Aceitar convite", url: args.acceptLink },
    reason: `alguém da equipe ${args.agencyName} convidou este endereço para a MUTAV.`,
  });
}
