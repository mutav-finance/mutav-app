# Payment Flow — BRIEF

> Project: payment-flow · Brand: TGA · Front: Imobiliárias · Created: 2026-05-13
> Mode: greenfield feature on an existing codebase. Payments domain + list/detail pages already exist; this project designs the **act of paying** with multiple methods.

---

## What this flow is

The tenant-facing portal where an inquilino settles a rental payment (recurring rent or activation fee) by choosing one of three methods — **PIX**, **Boleto**, or **Stellar** — and executing it. Reached via a per-payment magic link emailed/messaged by the imobiliária. No login required.

Secondary surface (deferred to v1.1): the imobiliária-side actions on `/payments/[id]` that share the link, mark-as-paid manually, and configure agency payment instruments.

Public route shape: `/[locale]/pagar/[publicId]` (initially keyed by `payment.publicId`; production version will use a short-lived signed token).

## Who it's for

**Primary:** the **tenant** — the person paying rent. May be on mobile (PIX scanned from another device) or desktop (Boleto printed/PDF). Usually has never seen TGA before; trust must be earned in the first 2 seconds.

**Secondary:** the **imobiliária user** (Lucas) — manages payments from the existing dashboard, shares links, reconciles confirmations. Already inside the authenticated `(app)` shell.

## Why it exists

A guarantee that cannot be paid is dead capital. The payment flow is where TGA proves operational competence to the people who actually move the money — tenants. It must:

1. **Render trust in 2 seconds.** Agency name + amount due + due date visible above the fold, on light background, with the TGA mark. No marketing.
2. **Offer real choice.** Three methods, presented as equals. PIX wins on speed, Boleto on familiarity, Stellar on the protocol thesis. The flow does not push.
3. **Execute without ambiguity.** Each method has its own dedicated screen with the *one* thing the tenant must do (scan, copy, send). No detours.
4. **Confirm visibly.** When the payment lands, the tenant sees an unambiguous paid state with verifiable evidence (tx id, timestamp, machine-formatted).

## Constraints

- **Brand contract:** TGA Precision Brutalism, Imobiliárias front. 0px radius everywhere. Three-layer typography on every screen (Geist declaration · Inter explanation · JetBrains evidence). Amber under 5% pixels. No shadows, no gradients, no glass. `#1A1A1A` text on `#C47E10` amber CTA — never white text on amber.
- **Stack:** Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui, next-intl (pt-BR primary, en parity), next-themes, Convex. No new framework. No new global state library.
- **Data model:** `payments` table already supports the three methods via discriminated union `method`. No schema migration required for v1.
- **Localization:** pt-BR canonical, en parity. All copy through `useTranslations("paymentFlow.*")`.
- **Accessibility:** WCAG 2.2 AA. Touch targets ≥48px (Imobiliárias front baseline). Color is never the only state signal — square+label badge pattern from STYLE.md §3.5.
- **Mobile-first:** the most likely device is a phone. Method selection and PIX QR display must work at 360px width without horizontal scroll.

## Success criteria

| # | Criterion |
|---|-----------|
| 1 | Tenant can complete a PIX payment in ≤3 taps from landing on the magic link |
| 2 | Boleto barcode line + downloadable PDF available within 1s of method choice |
| 3 | All monetary values use JetBrains Mono `tabular-nums`, formatted via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` |
| 4 | Status anywhere is a 6×6 square + JetBrains Mono uppercase label — never color alone (STYLE.md §3.5) |
| 5 | Page passes WCAG 2.2 AA: contrast, keyboard nav, focus visible (border-color only, no ring), screen-reader hierarchy |
| 6 | No `rounded-*` classes, no raw color scales (`bg-emerald-*` etc.), no `as Type` casts, no `any` |
| 7 | i18n parity en/pt-BR with no English fallback strings appearing in pt-BR routes |
| 8 | Receipt screen renders a verifiable proof — PIX `txId`, Boleto `paidAt`, Stellar `txHash` linked to a public explorer — formatted with `font-mono tabular-nums` |
| 9 | Method selection presents all three options on first paint; no progressive disclosure of the third option |
| 10 | Empty / expired / failed states are designed up front, not retrofitted |

## Non-goals

- Real PSP integration (PIX / Boleto issuance and confirmation). v1 uses fixtures + manual confirmation. Issue #19 tracks PSP integration.
- Card payments. Surfaced as a v1.1 candidate once a PSP is selected.
- Wallet connection for Stellar. v1 accepts manual `txHash` entry; wallet-connect ships in v1.1.
- Imobiliária-side share-link button and mark-as-paid action (extends `/payments/[id]`). Defer to v1.1.
- Agency settings for payment instruments (PIX key, Stellar address). Defer.
- Authenticated portal for tenants (account history). Out of scope — magic link per payment only.
- Receipt email/PDF generation. v1 renders the receipt screen; export is v1.1.
