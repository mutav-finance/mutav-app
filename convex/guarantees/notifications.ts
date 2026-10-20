/**
 * Tenant-facing proposal notices, sent once when an agency registers a
 * guarantee. Informational only: the agency collects the signed contract
 * offline, uploads it and activates the guarantee, so there is no step the
 * tenant takes in the app — and no link, since every guarantee page lives in
 * the login-gated agency app. A tenant-facing page arrives with #57.
 *
 * Pure builders (no `"use node"`) so the copy is testable outside the action.
 */

export type ProposalNotice = {
  publicId: string;
  tenantName: string;
  agencyName: string;
  rentCents: number;
  feeCents: number;
  coverageCents: number;
};

export type ProposalEmail = {
  subject: string;
  html: string;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function buildProposalWhatsApp(notice: ProposalNotice): string {
  return `Olá, *${notice.tenantName}*!

A imobiliária *${notice.agencyName}* registrou uma *Garantia Locatícia MUTAV* para a sua locação (garantia ${notice.publicId}).

• Aluguel: ${formatCents(notice.rentCents)}
• Taxa mensal da garantia: ${formatCents(notice.feeCents)}
• Cobertura: até ${formatCents(notice.coverageCents)}

Você não precisa fazer nada agora: a imobiliária vai entrar em contato para a assinatura do contrato. Qualquer dúvida, fale com ela.`;
}

export function buildProposalEmail(notice: ProposalNotice): ProposalEmail {
  const tenantName = escapeHtml(notice.tenantName);
  const agencyName = escapeHtml(notice.agencyName);
  const publicId = escapeHtml(notice.publicId);
  const row = (label: string, value: string) => `
              <tr>
                <td style="padding:6px 0;color:#6b6860;">${label}</td>
                <td style="padding:6px 0;text-align:right;font-weight:600;">${value}</td>
              </tr>`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Garantia locatícia registrada — MUTAV</title></head>
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
            <p style="margin:0 0 16px;">Olá, ${tenantName}!</p>
            <p style="margin:0 0 16px;">
              A imobiliária <strong>${agencyName}</strong> registrou uma
              <strong>Garantia Locatícia MUTAV</strong> para a sua locação.
              Estes são os dados principais:
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding-bottom:24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1a1a1a;border-top:1px solid #d9d7d2;border-bottom:1px solid #d9d7d2;">${row("Garantia", publicId)}${row("Aluguel", formatCents(notice.rentCents))}${row("Taxa mensal da garantia", formatCents(notice.feeCents))}${row("Cobertura", `até ${formatCents(notice.coverageCents)}`)}
            </table>
          </td>
        </tr>

        <tr>
          <td style="font-size:15px;color:#1a1a1a;line-height:1.75;padding-bottom:40px;">
            <p style="margin:0 0 16px;">
              Você não precisa fazer nada agora. A imobiliária vai entrar em contato
              para a assinatura do contrato de garantia, e a garantia entra em vigor
              depois que o contrato assinado for registrado.
            </p>
            <p style="margin:0;">
              Qualquer dúvida sobre a garantia ou a sua locação, fale com a imobiliária.
            </p>
          </td>
        </tr>

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

  return {
    subject: `Garantia locatícia registrada pela ${notice.agencyName} — ${notice.publicId}`,
    html,
  };
}
