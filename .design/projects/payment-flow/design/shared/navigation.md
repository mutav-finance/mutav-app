# Navigation

> Chunk: navigation | Phase: design | Project: payment-flow | Generated: 2026-05-13

## Pattern

**No global navigation.** The `(public)` flow is a single-purpose surface — the tenant has exactly one job (pay an invoice). Sidebars, tab bars, command palettes are aggressively absent.

The only fixed chrome:

- **Top bar (PublicShell header)** — 56px height. Renders the lowercase `tga` wordmark in Geist Bold `#C47E10` on the left. **No links.** The mark is intentionally non-clickable on this surface: the tenant cannot navigate to a TGA marketing site from inside a payment.
- **Footer meta (PublicFooterMeta)** — agency contact line + locale toggle. 16px Inter, `--color-text-2`. No legal nav, no "about", no help center.

## Within-flow movement

Tenants move between screens via three vectors:

| Vector | Trigger | Implementation |
|---|---|---|
| **Mode resolution** | `page.tsx` of `/pagar/[publicId]` runs `ModeResolver` server-side. Based on agency config + payment state, it `redirect()`s to the right sub-route. | Next.js `redirect()` from `next/navigation` inside the RSC. No client navigation. |
| **Live state subscription** | `HorizonPaymentPoller` (client island) subscribes via `useQuery`. When state flips `pending → paid`, calls `router.replace("/pagar/[publicId]/recibo")`. | `useRouter` from `@/i18n/navigation`; `router.replace` so the back button can't take Camila back to the address screen of a paid invoice. |
| **Manual mode toggle** (only when agency offers both A and B) | Tenant taps a 2-item tab strip between summary header and panel. | shadcn `Tabs` with `data-state=active` styled as 1px amber bottom border (no pill, no fill). 48px tab height. Default active = the agency's primary mode. |

## Mode toggle (when shown)

Rendered only if agency config has `acceptsAddressMode && acceptsWalletMode && STELLAR_CONTRACT_MODE` env-flagged on. In v1, **never rendered** — only Mode A is live. Design-spec included now so the build phase doesn't have to retrofit the layout.

```
┌────────────────────────────────────────────────┐
│  ENDEREÇO         │   CARTEIRA                 │
│  ─────────────    │                            │  ← 1px amber underline on active
└────────────────────────────────────────────────┘
```

| Property | Value |
|---|---|
| Container | `border-bottom: 1px solid var(--color-border)` |
| Active tab | 1px `var(--color-accent)` bottom border, text `--color-text` |
| Inactive tab | text `--color-text-2`, no border |
| Hover | text shifts to `--color-text` |
| Focus | 1px `var(--color-accent)` border around the trigger box (per STYLE.md effects vocabulary) |
| Animation | 150ms ease-out on `color` + `border-color`. No translate, no underline-slide. |
| Min target | 48px height × 50% width each |

## Locale switch

A quiet inline switcher in `PublicFooterMeta`. Two anchors: `pt-BR` (default, unprefixed) and `en` (`/en/pagar/…`). The active locale renders in `--color-text-2`, inactive in `--color-text-3` with underline on hover. No flags, no dropdown — exactly two characters of UI.

## Back behavior

| From | To | Implementation |
|---|---|---|
| `/pagar/[id]/endereco` | `/pagar/[id]` | Browser back. No custom back button — there's nowhere meaningful to "go back" except the URL Camila came from (WhatsApp). |
| `/pagar/[id]/recibo` | `/pagar/[id]/endereco` of an already-paid invoice (which would re-resolve to `/recibo`) | Same. `router.replace` on the auto-redirect prevents a back-button loop. |
| `/pagar/[id]/encerrado` | `/pagar/[id]` | Browser back; landing page detects terminal state and re-routes back to `/encerrado`. Idempotent loop, safe. |

No in-flow "Voltar" button is rendered. The tenant uses the browser back gesture / hardware back. Stripping the custom back link matches industry pattern (Mercado Pago, Stripe Checkout) and keeps the single-CTA-per-screen rule.

## Skip link

`PublicShell` includes a visible-on-focus skip link as the first focusable element: `Pular para o pagamento` (en: `Skip to payment`). Targets `#primary-action` on each execution screen — the copy button on Mode A, the Connect button on Mode B, the agency contact link on receipt/expired/error.

```
position: absolute; top: 0; left: 0;
transform: translateY(-100%);
&:focus { transform: translateY(0); }
```

(transform on focus only — not an interaction; satisfies STYLE.md's "no transform on hover/active" without violating it.)

## Responsive nav behavior

| Breakpoint | Header | Mode toggle | Footer |
|---|---|---|---|
| Mobile (<640px) | 56px, mark left, no margin auto | full-width 2-tab strip | stacked: contact line above locale toggle |
| Tablet (≥768px) | same; container max-w 56rem | same | row: contact left, locale right |
| Desktop (≥1024px) | same | same | same as tablet |

No collapse, no hamburger. There is nothing to collapse — the brand is a single wordmark and the locale toggle is two characters.
