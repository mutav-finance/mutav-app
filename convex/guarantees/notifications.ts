/**
 * Tenant-facing proposal notices, sent once, when MUTAV has accepted the draft
 * and the contract is first sent for signature (`sendForSignature`) — never at
 * draft creation, when nothing has been decided yet. Informational only: the
 * guarantee becomes active when Mutav approves the signed contract and the
 * reserve capacity check passes (issue #427), so there is no step the tenant
 * takes in the app — and no link, since
 * every guarantee page lives in the login-gated agency app. A tenant-facing
 * page arrives with #57.
 *
 * Pure builders (no `"use node"`) so the copy is testable outside the action.
 */

import { escapeHtml } from "../lib/email/escape";
import {
  EMAIL_NOTE_STYLE,
  EMAIL_PARAGRAPH_STYLE,
  EMAIL_QUOTE_STYLE,
  renderEmailButton,
  renderEmailLayout,
} from "../lib/email/layout";

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

export function buildProposalWhatsApp(notice: ProposalNotice): string {
  return `Olá, *${notice.tenantName}*!

A imobiliária *${notice.agencyName}* solicitou uma *Garantia Locatícia MUTAV* para a sua locação (garantia ${notice.publicId}).

• Aluguel: ${formatCents(notice.rentCents)}
• Taxa mensal da garantia: ${formatCents(notice.feeCents)}
• Cobertura: até ${formatCents(notice.coverageCents)}

Você não precisa fazer nada agora: a imobiliária vai entrar em contato para a assinatura do contrato. Qualquer dúvida, fale com ela.`;
}

export function buildProposalEmail(
  notice: ProposalNotice,
  { appUrl }: { appUrl: string },
): ProposalEmail {
  const tenantName = escapeHtml(notice.tenantName);
  const agencyName = escapeHtml(notice.agencyName);
  const publicId = escapeHtml(notice.publicId);
  const row = (label: string, value: string) => `
                  <tr>
                    <td style="padding:6px 0;color:#6b6860;">${label}</td>
                    <td style="padding:6px 0;text-align:right;font-weight:600;">${value}</td>
                  </tr>`;

  const html = renderEmailLayout({
    appUrl,
    title: "Garantia locatícia solicitada — MUTAV",
    preheader: `A imobiliária ${notice.agencyName} solicitou uma Garantia Locatícia MUTAV para a sua locação.`,
    bodyHtml: `<p style="${EMAIL_PARAGRAPH_STYLE}">Olá, ${tenantName}!</p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  A imobiliária <strong>${agencyName}</strong> solicitou uma
                  <strong>Garantia Locatícia MUTAV</strong> para a sua locação.
                  Estes são os dados principais:
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;font-size:14px;color:#1a1a1a;border-top:1px solid #d9d7d2;border-bottom:1px solid #d9d7d2;">${row("Garantia", publicId)}${row("Aluguel", formatCents(notice.rentCents))}${row("Taxa mensal da garantia", formatCents(notice.feeCents))}${row("Cobertura", `até ${formatCents(notice.coverageCents)}`)}
                </table>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  Você não precisa fazer nada agora. A imobiliária vai entrar em contato
                  para a assinatura do contrato de garantia, e a garantia entra em vigor
                  depois que o contrato assinado for aprovado e a garantia registrada pela MUTAV.
                </p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">
                  Qualquer dúvida sobre a garantia ou a sua locação, fale com a imobiliária.
                </p>`,
    reason: `a imobiliária ${notice.agencyName} solicitou uma garantia locatícia MUTAV para a sua locação.`,
  });

  return {
    subject: `Garantia locatícia solicitada pela ${notice.agencyName} — ${notice.publicId}`,
    html,
  };
}

// ─── Guarantee document review ────────────────────────────────────────────────

export type RejectedDocumentKey = "rentalContract" | "inspection" | "policy";

const DOCUMENT_LABEL_PT: Record<RejectedDocumentKey, string> = {
  rentalContract: "Contrato de locação assinado",
  inspection: "Vistoria",
  policy: "Apólice",
};

export type DocumentRejectedNotice = {
  guaranteePublicId: string;
  documentKey: RejectedDocumentKey;
  rejectionReason: string;
};

/** Agency-facing: a document on one of its guarantees was rejected by staff. */
export function buildDocumentRejectedEmail(
  notice: DocumentRejectedNotice,
  { appUrl }: { appUrl: string },
): ProposalEmail {
  const guaranteeLink = `${appUrl}/guarantees/${encodeURIComponent(notice.guaranteePublicId)}`;
  const label = DOCUMENT_LABEL_PT[notice.documentKey];
  const html = renderEmailLayout({
    appUrl,
    title: "Documento recusado — MUTAV",
    preheader: `${label} da garantia ${notice.guaranteePublicId} foi recusado.`,
    bodyHtml: `<p style="${EMAIL_PARAGRAPH_STYLE}">
                  O documento <strong>${escapeHtml(label)}</strong> enviado para a garantia
                  <strong>${escapeHtml(notice.guaranteePublicId)}</strong> foi recusado pela equipe MUTAV.
                </p>
                <p style="${EMAIL_PARAGRAPH_STYLE}margin-bottom:8px;"><strong>Motivo:</strong></p>
                <p style="${EMAIL_QUOTE_STYLE}">${escapeHtml(notice.rejectionReason)}</p>
                <p style="${EMAIL_PARAGRAPH_STYLE}">Envie um novo arquivo pela página da garantia.</p>
                ${renderEmailButton({ label: "Abrir a garantia", url: guaranteeLink })}
                <p style="${EMAIL_NOTE_STYLE}margin-top:24px;">
                  Se o botão não abrir, copie este endereço:
                  <a href="${escapeHtml(guaranteeLink)}" style="color:#6b6860;">${escapeHtml(guaranteeLink)}</a>
                </p>`,
    reason: "a sua imobiliária enviou um documento para uma garantia na MUTAV.",
  });
  return {
    subject: `Documento recusado — garantia ${notice.guaranteePublicId}`,
    html,
  };
}
