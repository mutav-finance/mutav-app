"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "../_generated/server";
import { getAppUrl, getOptionalResendApiKey, getResendFromEmail } from "../lib/env";
import { logError, logWarn } from "../lib/logger";
import { INVITABLE_ROLE, invitableRoleValidator } from "./domain";
import type { InvitableRole } from "./domain";

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
 * the invitee still sees it on the welcome screen after signing in.
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
    const apiKey = getOptionalResendApiKey();
    if (!apiKey) {
      logWarn("[invites] RESEND_API_KEY not set, skipping email");
      return;
    }
    try {
      const resend = new Resend(apiKey);
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
