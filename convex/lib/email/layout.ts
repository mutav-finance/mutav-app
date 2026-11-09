import { escapeHtml } from "./escape";

// The one support address every email footer shows. It duplicates
// `PARTNER_SUPPORT_EMAIL` in apps/agency/src/lib/support.ts because convex/
// cannot import from an app; #421 tracks a single shared source for both.
export const EMAIL_SUPPORT_ADDRESS = "contato@mutav.finance";

export const EMAIL_DESCRIPTOR = "Garantia locatícia";

// Served from the agency app's public dir (apps/agency/public/email/). Email
// clients strip inline SVG and block data: images, so the lockup loads by URL.
// The old mark-only `mutav-logo.png` stays in public/ for emails already sent.
const LOGO_PATH = "/email/mutav-lockup.png";
// The PNG is 768×128 (6:1, from brand/kit); shown at 32px tall for 4× density.
const LOGO_WIDTH = 192;
const LOGO_HEIGHT = 32;

const COLOR = {
  canvas: "#f7f6f3",
  surface: "#ffffff",
  footer: "#eeedea",
  amber: "#c47e10",
  ink: "#1a1a1a",
  body: "#3a3a3a",
  muted: "#6b6860",
  rule: "#d9d7d2",
} as const;

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type EmailCta = { label: string; url: string };

export type EmailLayoutArgs = {
  /** Origin of the agency app, e.g. from `getAppUrl()`; hosts the logo PNG. */
  appUrl: string;
  /** Document `<title>`. Plain text. */
  title: string;
  /** Inbox preview line, hidden in the body. Plain text. */
  preheader?: string;
  /** Large heading above the body. Plain text. */
  heading?: string;
  /** Trusted markup; builders escape every user value they put in it. */
  bodyHtml: string;
  cta?: EmailCta;
  /** Why the recipient got this email; completes "Você recebeu este e-mail porque …". */
  reason: string;
};

/**
 * Bulletproof button: a table cell carries the amber fill so clients that
 * ignore padding on `<a>` (Outlook) still paint it. Text on amber is ink, never
 * white (brand rule).
 */
export function renderEmailButton({ label, url }: EmailCta): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="${COLOR.amber}" style="background-color:${COLOR.amber};">
                      <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:15px;font-weight:700;letter-spacing:0.02em;color:${COLOR.ink};text-decoration:none;">${escapeHtml(label)}</a>
                    </td>
                  </tr>
                </table>`;
}

function renderLogoUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}${LOGO_PATH}`;
}

/**
 * The branded shell every MUTAV transactional email renders in: the MUTAV
 * lockup image, a body slot, an optional button, and a footer with
 * the descriptor, the support address and why the email was sent.
 * Table-based and inline-styled — the lowest common denominator email clients
 * render reliably. Pure: no env, no Node APIs.
 */
export function renderEmailLayout({
  appUrl,
  title,
  preheader,
  heading,
  bodyHtml,
  cta,
  reason,
}: EmailLayoutArgs): string {
  const preheaderBlock = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.canvas};">${escapeHtml(preheader)}</div>`
    : "";
  const headingRow = heading
    ? `<tr>
              <td style="background-color:${COLOR.surface};padding:32px 32px 0 32px;">
                <h1 style="margin:0;font-size:24px;line-height:1.3;letter-spacing:-0.01em;color:${COLOR.ink};">${escapeHtml(heading)}</h1>
              </td>
            </tr>`
    : "";
  const ctaRow = cta
    ? `<tr>
              <td style="background-color:${COLOR.surface};padding:0 32px 32px 32px;">
                ${renderEmailButton(cta)}
              </td>
            </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${COLOR.canvas};font-family:${FONT_STACK};">
    ${preheaderBlock}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.canvas}" style="background-color:${COLOR.canvas};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
            <tr>
              <td style="height:3px;background-color:${COLOR.amber};font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="background-color:${COLOR.surface};padding:24px 32px;border-bottom:1px solid ${COLOR.rule};">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="${escapeHtml(renderLogoUrl(appUrl))}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="MUTAV" style="display:block;border:0;outline:none;text-decoration:none;width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;" />
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            ${headingRow}
            <tr>
              <td style="background-color:${COLOR.surface};padding:24px 32px 8px 32px;font-size:15px;line-height:1.7;color:${COLOR.ink};">
                ${bodyHtml}
              </td>
            </tr>
            ${ctaRow}
            <tr>
              <td style="background-color:${COLOR.footer};padding:20px 32px;font-size:12px;line-height:1.6;color:${COLOR.muted};">
                <p style="margin:0 0 6px 0;font-weight:700;letter-spacing:0.04em;color:${COLOR.ink};">MUTAV · ${EMAIL_DESCRIPTOR}</p>
                <p style="margin:0 0 6px 0;">Este é um e-mail automático, não responda a esta mensagem. Dúvidas? Escreva para <a href="mailto:${EMAIL_SUPPORT_ADDRESS}" style="color:${COLOR.muted};font-weight:700;text-decoration:underline;">${EMAIL_SUPPORT_ADDRESS}</a>.</p>
                <p style="margin:0;">Você recebeu este e-mail porque ${escapeHtml(reason)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Inline style for body paragraphs, shared so every builder reads the same. */
export const EMAIL_PARAGRAPH_STYLE = `margin:0 0 16px 0;font-size:15px;line-height:1.7;color:${COLOR.ink};`;
/** Inline style for secondary, smaller copy (notes, labels). */
export const EMAIL_NOTE_STYLE = `margin:0 0 16px 0;font-size:13px;line-height:1.7;color:${COLOR.muted};`;
/** Amber-ruled quote block, e.g. for a reviewer's reason. */
export const EMAIL_QUOTE_STYLE = `margin:0 0 24px 0;padding:12px 16px;border-left:2px solid ${COLOR.amber};background-color:#fff8ee;`;
