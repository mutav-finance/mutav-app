# Screen 04 — Receipt

> Chunk: screen-04-receipt | Phase: design | Project: payment-flow | Generated: 2026-05-13
> Route: `/[locale]/pagar/[publicId]/recibo`

## Purpose

Confirmation without celebration. The page proves three things, in this order:

1. **The payment landed.** Status badge + Geist Bold declaration.
2. **The exact amount and timestamp.** Mono evidence.
3. **The independently-verifiable proof.** `stellar.expert` link to the txHash on-chain.

The receipt is a destination, not a flash. The tenant lands here from either the live `HorizonPaymentPoller` redirect (Screens 02 / 03) or by manually re-visiting the magic link of a paid invoice. The screen is **fully shareable and printable** — a tenant can screenshot it for a WhatsApp group, or print it on paper, and the brand chrome remains coherent.

Per recommendations.md C2 and content-strategy.md voice rules: **no confetti, no checkmark animation, no "obrigado". The 4px `#2E8B5A` top-edge stripe on the Card is the entire celebration.**

## User flow position

```
[Screen 02 or 03: HorizonPaymentPoller fires router.replace]
                          OR
[Tenant re-visits magic link of an already-paid invoice]
                          ↓
                /pagar/[publicId]/recibo          ← THIS SCREEN
                          │
                          └─ (terminal — no further automatic flow)
```

## Layout (mobile, 360px baseline)

```
┌────────────────────────────────────────┐
│  tga                            pt-BR  │  ← PublicShell header
├────────────────────────────────────────┤
│                                        │
│   Imobiliária Costa & Filhos           │  ← PaymentSummaryHeader
│   R$ 2.847,00                          │     (paidAt replaces due date)
│   Pago em 13 de maio, 18h22            │     ← Mono evidence
│                                        │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │  ← 4px #2E8B5A top stripe
│   ┌──────────────────────────────────┐ │     (border-top on Card)
│   │  ▪ PAGO                          │ │  ← PaymentStateTag
│   │  Pagamento confirmado            │ │  ← Geist Bold 24px declaration
│   │                                  │ │
│   │  124,7805 XLM                    │ │  ← AssetAmount
│   │  ≈ R$ 2.847,00                   │ │
│   │                                  │ │
│   │  ─────────────────────────       │ │  ← Separator
│   │                                  │ │
│   │  Hash da transação Stellar       │ │  ← Inter Medium 13 label
│   │  a3f8b2…9c7e1d  [↗]              │ │  ← CopyableValue (Mono)
│   │                                  │ │     + StellarExplorerLink icon
│   │  Bloco                           │ │
│   │  61,234,567                      │ │  ← Mono evidence (ledger #)
│   │                                  │ │
│   │  Confirmado em                   │ │
│   │  13/05/2026 às 18h22:14          │ │  ← Mono (full timestamp)
│   │                                  │ │
│   │  ─────────────────────────       │ │
│   │                                  │ │
│   │  Imobiliária Costa & Filhos      │ │  ← Agency contact block
│   │  Em caso de dúvida,              │ │
│   │  fale com a {agencyName}         │ │
│   │  → contato@costaefilhos.com.br   │ │  ← Inter link (--color-text)
│   │                                  │ │
│   └──────────────────────────────────┘ │
│                                        │
├────────────────────────────────────────┤
│  Imprimir recibo                pt|en  │  ← Quiet inline action
└────────────────────────────────────────┘
```

The 4px `#2E8B5A` stripe sits on the top edge of the Card — implemented as `border-top: 4px solid #2E8B5A` overriding the 1px default. This is the **only place** decorative success-green appears in the entire payment flow. STYLE.md §3.1 (Imobiliárias `pagamento state`) endorses this exact pattern.

## Layout (≥768px)

Same single-column layout. The card caps at `max-w-(--page-content-max-width)` (56rem). Vertical padding scales (`py-8` → `py-10`). The contact block stays inside the card.

## Components used

| Slot | Component | Source |
|---|---|---|
| Shell | `PublicShell` + `PageContent variant="narrow"` | new + existing |
| Summary | `PaymentSummaryHeader` with `mode="paid"` (paidAt replaces due date) | new |
| Receipt card | `PaymentReceiptCard` wrapping shadcn `Card` with `data-stripe="paid"` | new + shadcn refactor |
| Status badge | `PaymentStateTag state="paid"` | existing (`src/components/payments/payment-state-tag.tsx`) |
| Asset amount | `AssetAmount` (no copy button — this is evidence, not action) | new |
| TxHash row | `CopyableValue` wrapping a `Mono` with truncated middle ("a3f8b2…9c7e1d") + tooltip showing full hash | new |
| Explorer link | `StellarExplorerLink` (small `ArrowSquareOut` icon, inline next to txHash) | new |
| Separator | `Separator` (1px solid `--color-border`) | shadcn |
| Agency contact | Inline Inter text + `<a href="mailto:…">` link | semantic HTML |
| Print action | `<button>` calling `window.print()`; renders only on devices with `window.print` available | inline |
| Footer | `PublicFooterMeta` simplified (no "dúvidas" line — that's inside the card now) | new |

## States

### Default — `state.kind === "paid"`

As drawn above.

The PaymentSummaryHeader differs from Screens 02/03: the third line is `Pago em {date} {time}` (Mono evidence), not the due-date string. The amount remains identical (Geist Bold composite).

The status badge `▪ PAGO` uses a `#2E8B5A` square + uppercase Mono label per STYLE.md §3.5. Note: the badge color matches the stripe color for visual coherence; STYLE.md §3.5 example shows `LIQUIDADO` in amber for the dashboard, but this surface uses `PAGO` in success-green because the receipt's entire reason for being IS the verified-paid state.

### Empty

Not applicable — a receipt only renders when `state.kind === "paid"`. If the tenant visits `/recibo` on a non-paid payment, the page server-side `redirect()`s to `/pagar/[publicId]` (re-enters Mode Resolver), which routes to the correct screen.

### Loading

`loading.tsx` for `/recibo`:
- Summary 3-line skeleton (60%/50%/40% widths)
- Card skeleton with 4px `#2E8B5A` `border-top` already visible (so the success signal lands on first paint even before content)
- Status-badge skeleton: 6×6 fixed square (no shimmer) + 60px-wide label skeleton
- 32px-tall amount-block skeleton
- 4 × Mono-row skeletons (label + value pairs)
- 80px-tall contact block skeleton

### Error

If `useQuery(getPublicByPublicId)` fails (Convex outage):

- `error.tsx` (Screen 06) catches the throw and renders its layout
- If the query returns `state.kind !== "paid"` (race: tenant deep-linked a `/recibo` URL of a still-pending payment), the RSC `redirect()`s to `/pagar/[publicId]`. No error inside this screen.

### Print

`@media print` (in `globals.css`) for the receipt:

- Hides: `PublicShell` header, `PublicFooterMeta`, the "Imprimir recibo" button, the locale switch
- Keeps: PaymentSummaryHeader, the receipt card (full chrome)
- 4px `#2E8B5A` top stripe survives as a thin colored strip (or grey strip on B&W)
- `stellar.expert` link expands to visible URL: `a::after { content: " (" attr(href) ")"; font-size: 0.75rem; }`
- Card forced to 100% width with `border: 1px solid #000`
- Mono text at 11pt
- `page-break-inside: avoid` on `.receipt-card`

## Interactions

| # | Trigger | Outcome | Spec |
|---|---|---|---|
| 1 | Tap copy icon on txHash | `navigator.clipboard.writeText(fullTxHash)` synchronously; Phosphor `Copy → Check` swap 1.6s; Sonner toast | Same `CopyableValue` pattern as Screen 02 |
| 2 | Tap "↗" icon (StellarExplorerLink) | New tab opens to `https://stellar.expert/explorer/{network}/tx/{txHash}` | `target="_blank" rel="noopener noreferrer"`; aria-label "Abrir no Stellar Expert (nova aba)" |
| 3 | Tap "Imprimir recibo" | `window.print()` fires; print stylesheet kicks in | Native browser; no library |
| 4 | Tap agency-contact email | `mailto:` opens system mail client | Standard `<a href="mailto:…">` |
| 5 | Tap "tga" wordmark | No-op (wordmark is decorative; non-clickable) | `tabindex="-1"` |
| 6 | Page refresh | RSC re-fetches; if still paid, renders the same. Idempotent. | |
| 7 | Browser back from /recibo | Navigates to /endereco of a paid invoice; that route re-resolves and redirects forward to /recibo. Idempotent forward loop. | `router.replace` (not `push`) when landing here from the poller prevents the back button from showing the pre-paid card. |

## Accessibility

### Tab order

1. Skip link → `#primary-action` — for receipt, the primary action is the StellarExplorerLink (the most meaningful action: independently verify the transaction)
2. Locale switch (header)
3. `PaymentSummaryHeader` text — non-focusable
4. PaymentStateTag — non-focusable (decorative + announced label)
5. Copy txHash button
6. StellarExplorerLink (`id="primary-action"`)
7. Agency-contact email link
8. "Imprimir recibo" button (footer area)

### Screen reader announcement order

1. "TGA" (wordmark, image-role)
2. Locale switch
3. "Pagamento de aluguel — Imobiliária Costa & Filhos — R$ 2.847,00 — Pago em 13 de maio, às 18h22" (PaymentSummaryHeader as `<header>` containing `<h1>`)
4. "PAGO" (`PaymentStateTag` label — square is `aria-hidden="true"`)
5. "Pagamento confirmado" (sub-heading inside card — `<h2>`)
6. "124,7805 XLM, aproximadamente R$ 2.847,00" (AssetAmount with `aria-label` for the `≈` symbol)
7. "Hash da transação Stellar: a3f8b2... (full hash)" — the `<code>` with `aria-label` carrying the full string
8. "Bloco: 61.234.567" (ledger #)
9. "Confirmado em 13 de maio de 2026 às 18 horas e 22 minutos" (full timestamp, locale-formatted)
10. "Imobiliária Costa & Filhos. Em caso de dúvida, fale com a Imobiliária Costa & Filhos. Email: contato@costaefilhos.com.br"
11. "Imprimir recibo, botão"

`<h1>` is on the `PaymentSummaryHeader` (matches the page's principal subject); `<h2>` on "Pagamento confirmado" inside the card.

### Focus management

When the tenant lands here via auto-redirect from Screen 02/03, focus initially lands at the page top (browser default). The `<h1>` is naturally announced. We do NOT auto-focus the StellarExplorerLink — the tenant should absorb the confirmation before being prompted to verify. Per accessibility-patterns.md §3, this is one of the "let the page heading announce naturally" cases.

### Color contrast

- `#1A1A1A` text on `#FFFFFF`: 19.6:1 (AAA)
- `#2E8B5A` PAGO label and stripe — used decoratively; the redundant label "PAGO" satisfies WCAG 1.4.1
- `#2E8B5A` on `#FFFFFF`: 4.6:1 (AA Normal pass); per STYLE.md "Always" rule, when this color appears on light background, we use Inter Semi-bold 600 minimum — the badge label is JetBrains Mono Medium 11px uppercase, which renders bolder than 600 weight Inter; the visual weight is preserved

### Touch targets

| Element | Hit area |
|---|---|
| Copy txHash | 44×44 |
| StellarExplorerLink | 44×44 (icon + text combined) |
| Agency contact email | full line-height ≥48 |
| Print button | 48px height |
| Locale switch | 44×44 each anchor |

### Reduced motion

No motion on this screen. The receipt is the only screen in the flow that doesn't ship the live pulse dot — there is nothing to poll. Reduced-motion users see identical UX.

## Image resources

| Slot | Type | Description | Treatment |
|---|---|---|---|
| StellarExplorerLink icon | Phosphor `ArrowSquareOut` weight="light" 16px | Inline next to truncated txHash | Bare, color `--color-text`. Never amber. |
| Copy icon (txHash) | Phosphor `Copy` weight="light" 20px | Inline at row end | Swap to `Check` 1.6s on copy |
| Print icon (optional, footer button) | Phosphor `Printer` weight="light" 16px | Inline before "Imprimir recibo" | Bare |
| Email "→" prefix on contact line | Phosphor `ArrowRight` weight="light" 14px | Decorative arrow before email | `aria-hidden="true"` |
| Brand mark | live text `tga` | Top-left header | Geist Bold `#C47E10` |

**No photography, no illustration.** Per `imagery-style.md`, decorative imagery would dilute the brand voice on a receipt. The Mono evidence rows ARE the imagery.

## Three-layer hierarchy verification

| Layer | Element |
|---|---|
| Declaration (Geist Bold) | `R$ 2.847,00` in `PaymentSummaryHeader` + "Pagamento confirmado" `<h2>` inside card |
| Explanation (Inter) | Agency name, evidence labels ("Hash da transação Stellar", "Bloco", "Confirmado em"), agency contact body |
| Evidence (Mono) | Amount, asset amount, txHash, ledger #, full timestamp, paidAt — every numeric/identifier value |

All three layers present and richly distributed. ✓ Specifically: this is the screen with the **densest evidence layer** in the flow — appropriate, because it IS the proof.

## Brand-fidelity checklist

- ✓ `border-radius: 0` on card, badge, copy button hit area, print button, links
- ✓ 1px solid borders everywhere; 4px `#2E8B5A` top stripe is the documented receipt exception (STYLE.md §3.1 "status stripe")
- ✓ Amber under 5%: appears only on the wordmark (~200px²). The 4px stripe is `#2E8B5A` success-green, not amber. Other usual amber sources (CTAs, live dot) are absent here. Total amber on receipt ≈ 200px² of ~327k px² mobile viewport = ~0.06% — well under 5%.
- ✓ Three-layer hierarchy: richly present
- ✓ No shadows, gradients, glass — the green stripe is solid color, not gradient
- ✓ Tabular-nums on every evidence value via `Mono`
- ✓ Effects vocabulary: `color`, `background-color`, `border-color`, `opacity` only — no motion at all
- ✓ `#2E8B5A` appears on light bg with adequate weight per "Always" rule
- ✓ No icons in amber
- ✓ Phosphor weight="light"
- ✓ Bold-bet #1 (zero radius): all
- ✓ Bold-bet #2 (amber as precious metal): wordmark only — the receipt deliberately steps away from amber, letting success-green carry the entire visual moment
- ✓ Bold-bet #3 (tabular nums): every number
- ✓ Bold-bet #4 (three-layer): verified
- ✓ Bold-bet #5 (surface stacking): card on canvas via background step + 1px border + 4px stripe

## Anti-patterns avoided

- No "Obrigado pelo pagamento!" — voice rule: no celebration (content-strategy.md)
- No confetti / checkmark draw-on animation (recommendations.md C2)
- No exclamation marks
- No "Pagamento processado com sucesso" verbose form (content-strategy.md anti-patterns)
- No emoji
- No primary CTA — the receipt is terminal, not a launchpad (recommendations.md key decision #5)
- No "Voltar" link to the address screen — would loop
- No celebratory `box-shadow` halo
- No color-only success signal — the PAGO badge label provides the redundant cue (WCAG 1.4.1)

## Related

- Components: see `shared/component-plan.md` (`PaymentReceiptCard`, `StellarExplorerLink`)
- Brand patterns: STYLE.md §3.1 ("pagamento state" Imobiliárias column — defines the green stripe + amount color shift), §3.5 (status badge)
- Microcopy: research/content-strategy.md "Receipt screen" block
- Stellar evidence (txHash, ledger): research/stellar-modes.md §"Confirmation polling" + §"Stellar Expert links"
- Accessibility: research/accessibility-patterns.md §2, §7
- Interactions: shared/micro-interactions.md row #13 (no entrance animation), #18 (explorer link hover)
- Print stylesheet: shared/responsive.md "Print (@media print)" section
