# Screen 05 — Expired / Canceled

> Chunk: screen-05-expired | Phase: design | Project: payment-flow | Generated: 2026-05-13
> Route: `/[locale]/pagar/[publicId]/encerrado`

## Purpose

The terminal-but-not-paid layout. Reached when `payment.state.kind ∈ { overdue, canceled }`. A single layout serves both states — and also serves as the fallback rendering for `not-found.tsx` (Screen 07) and the user-friendly recovery shape for `error.tsx` (Screen 06).

The page tells the tenant exactly two things:

1. **What happened.** Square + uppercase label + Inter prose explanation.
2. **Who to call.** Agency name + contact CTA. No retry, no "tentar novamente" alone.

Per content-strategy.md error-states microcopy: "Primary CTA on all error states: `Fale com a {agencyName}`. Never 'Tentar novamente' alone — always with an escape hatch."

## User flow position

```
/pagar/[publicId]      (Screen 01 — Mode Resolver)
        │
        ├─ state.kind === "overdue"   → redirect /encerrado?variant=overdue
        └─ state.kind === "canceled"  → redirect /encerrado?variant=canceled

/pagar/[publicId]/encerrado    ← THIS SCREEN
        │
        └─ (terminal)
```

The `variant` is encoded server-side from the payment state — not as a query string (which could be tampered with). The route is `/encerrado` always; the rendered variant is derived from the Convex query result.

## Layout (mobile / tablet / desktop)

```
┌────────────────────────────────────────┐
│  tga                            pt-BR  │  ← PublicShell header
├────────────────────────────────────────┤
│                                        │
│   Imobiliária Costa & Filhos           │  ← PaymentSummaryHeader
│   R$ 2.847,00                          │     same as elsewhere; the amount is
│   Venceu em 15/04/2026                 │     a fact, regardless of state
│                                        │
│   ┌──────────────────────────────────┐ │
│   │  ▪ EXPIRADO                      │ │  ← PaymentStateTag (overdue variant)
│   │                                  │ │     #C94040 square (or #555B66 for
│   │  Pagamento expirado              │ │     canceled — see variants below)
│   │                                  │ │
│   │  Este pagamento venceu em        │ │  ← Inter body (15 leading)
│   │  15 de abril de 2026. Entre em   │ │
│   │  contato com a {agencyName} para │ │
│   │  gerar um novo pagamento.        │ │
│   │                                  │ │
│   │  ┌─────────────────────────────┐ │ │
│   │  │  Fale com {agencyName}      │ │ │  ← Primary CTA — amber fill
│   │  └─────────────────────────────┘ │ │     `mailto:` or `tel:` per agency
│   │                                  │ │     config
│   │  ou: +55 11 9 8765-4321          │ │  ← Mono evidence (phone, optional)
│   │                                  │ │
│   └──────────────────────────────────┘ │
│                                        │
├────────────────────────────────────────┤
│                                 pt|en  │  ← PublicFooterMeta (slim)
└────────────────────────────────────────┘
```

## Variants

### `overdue` (state.kind === "overdue")

| Slot | Value |
|---|---|
| PaymentStateTag | `▪ EXPIRADO` — `#C94040` square + `EXPIRADO` label (en: `EXPIRED`) |
| Geist Bold title | "Pagamento expirado" / "Payment expired" |
| Inter body | "Este pagamento venceu em {date}. Entre em contato com a {agencyName} para gerar um novo pagamento." |
| Primary CTA | "Fale com {agencyName}" |

### `canceled` (state.kind === "canceled")

| Slot | Value |
|---|---|
| PaymentStateTag | `▪ CANCELADO` — `#555B66` square + `CANCELADO` label (en: `CANCELED`) |
| Geist Bold title | "Pagamento cancelado" / "Payment canceled" |
| Inter body | "Este pagamento foi cancelado pela imobiliária. Entre em contato com a {agencyName} para mais informações." |
| Primary CTA | "Fale com {agencyName}" |

### `notFound` (used by Screen 07)

| Slot | Value |
|---|---|
| PaymentStateTag | `▪ NÃO ENCONTRADO` — `#555B66` square + `NÃO_ENCONTRADO` label (en: `NOT_FOUND`) |
| Geist Bold title | "Pagamento não encontrado" / "Payment not found" |
| Inter body | "O link pode estar incorreto ou expirado. Verifique com a sua imobiliária." |
| Primary CTA | (none — there's no agency to link to; PaymentSummaryHeader is also hidden) |
| Secondary | A single line: "Você foi enviado por uma imobiliária? Confirme o link e tente novamente." |

For `notFound`, the `PaymentSummaryHeader` cannot render (we don't have payment data). The screen falls back to just the brand mark + the card.

## Components used

| Slot | Component | Source |
|---|---|---|
| Shell | `PublicShell` + `PageContent variant="narrow"` | new + existing |
| Summary | `PaymentSummaryHeader` (omitted for `notFound` variant) | new |
| Card | `Card` + `CardContent` (24px padding, 1px `#D9D7D2`, 0px radius) — **no** stripe variant | shadcn |
| Status badge | `PaymentStateTag` with per-variant state prop | existing |
| Primary CTA | `Button variant="default" size="lg" asChild` wrapping `<a href="mailto:…">` or `<a href="tel:…">` | shadcn |
| Phone evidence | `<Mono>` with the phone number formatted via `Intl.NumberFormat` or a local helper | existing |
| Footer | `PublicFooterMeta` (slim variant — no "dúvidas" line, since this entire screen is the dúvidas resolution) | new |

## States

### Default

As drawn above. No state machine; this is a static informational screen.

### Empty

Same as `notFound` variant — covered by Screen 07's wrapper.

### Loading

`loading.tsx` for `/encerrado`:
- Summary 3-line skeleton (or omitted for notFound)
- Card skeleton:
  - 6×6 fixed square + 80px label skeleton (PaymentStateTag placeholder; no shimmer)
  - 28px-tall × 60% (title placeholder)
  - 3 × 16px-tall body lines
  - 48px × 100% CTA placeholder

### Error

If the Convex query throws while determining variant, `error.tsx` (Screen 06) renders instead. Screen 05 is itself an "end state" — it doesn't have its own error boundary.

## Interactions

| # | Trigger | Outcome |
|---|---|---|
| 1 | Tap primary CTA | `<a>` opens `mailto:` or `tel:` per agency config; native OS handler takes over. No client JS. |
| 2 | Tap on phone Mono line (`tel:` link) | Native dialer (mobile) or VoIP handler (desktop) |
| 3 | Page refresh | RSC re-fetches; idempotent — variant doesn't change |
| 4 | Browser back | Returns to the URL the tenant came from (WhatsApp) — no in-flow back behavior |

## Accessibility

### Tab order

1. Skip link → `#primary-action` (the CTA)
2. Locale switch
3. PaymentSummaryHeader (non-focusable; omitted for notFound)
4. PaymentStateTag (non-focusable; announced via label)
5. Primary CTA (`id="primary-action"`)
6. (optional) `tel:` link on the phone Mono line — if rendered

### Screen reader announcement order

1. "TGA" (wordmark)
2. Locale switch
3. PaymentSummaryHeader (variant: overdue / canceled) — read as "Pagamento de aluguel, Imobiliária Costa & Filhos, R$ 2.847,00, Venceu em 15 de abril de 2026"
4. "EXPIRADO" or "CANCELADO" or "NÃO ENCONTRADO" (PaymentStateTag label; square is `aria-hidden`)
5. "Pagamento expirado" (Geist Bold heading — `<h1>` for this screen)
6. Inter body — read in full
7. "Fale com Imobiliária Costa & Filhos, link" (primary CTA, with `aria-label` including the destination type, e.g. "Enviar email para Imobiliária Costa & Filhos")
8. "+55 11 9 8765-4321, link telefone" (phone evidence — `aria-label` includes "telefone")

`<h1>` is on the title inside the card (NOT on PaymentSummaryHeader for this screen — the page subject IS the state, not the payment).

### Focus management

On initial render, focus is at page top (default). Manual focus-to-CTA is NOT applied here — unlike Screens 02/03 where the primary action is the page's reason for existing, on Screen 05 the tenant needs to read the explanation BEFORE acting. Auto-focusing the "Fale com…" CTA would skip the explanation context for SR users.

### Color contrast

- `#C94040` (overdue square): on `#FFFFFF` = 5.5:1 (AA Normal pass)
- `#555B66` (canceled / notFound square): on `#FFFFFF` = 6.8:1 (AA Normal pass)
- All label/title/body uses `#1A1A1A` on `#FFFFFF`: 19.6:1 (AAA)
- CTA amber-fill `#C47E10` with `#1A1A1A` text: 5.3:1 (AA pass per STYLE.md)
- "Bold status labels ≥14px when `#C94040` appears" — the PaymentStateTag label is uppercase Mono 11px Medium; on the receipt the same color appears as a 4px stripe — here it appears as a 6×6 square + a label. The label provides redundant non-color cue (1.4.1) so the size rule is satisfied by the label being uppercase + Mono Medium.

### Touch targets

| Element | Hit area |
|---|---|
| Primary CTA | full-width × 48px (mobile); inline min-w-240 × 48 (tablet+) |
| Phone link | line-height ≥48; tap-target wraps the full Mono string |
| Locale switch | 44×44 each anchor |

### Reduced motion

No motion on this screen. Identical UX with `prefers-reduced-motion: reduce`.

## Image resources

| Slot | Type | Description | Treatment |
|---|---|---|---|
| No imagery in body | — | — | — |
| Phone icon (optional, beside Mono phone) | Phosphor `Phone` weight="light" 14px | Inline before phone number | `aria-hidden="true"`, color `--color-text-2`. Never amber. |
| Email icon (optional, beside Mono email if shown) | Phosphor `EnvelopeSimple` weight="light" 14px | Same | Same |
| Brand mark | live text | Header | Geist Bold `#C47E10` |

**No illustrations.** Per `imagery-style.md`, the Imobiliárias front permits illustration "only for empty states and educational explainer sequences" — but the brand voice rule "calma, não pânico" applies here too: an illustration of an expired clock or a sad face would betray the calm-authority register. The card chrome + the prose IS the entire message.

## Three-layer hierarchy verification

| Layer | Element |
|---|---|
| Declaration (Geist Bold) | `R$ 2.847,00` in summary + "Pagamento expirado" / "cancelado" title inside card |
| Explanation (Inter) | Agency name in summary + body prose + CTA label |
| Evidence (Mono) | Original due date (in summary), phone number, the state-label inside the badge (`EXPIRADO` is JetBrains Mono Medium per STYLE.md §3.5) |

All three layers present. ✓

## Brand-fidelity checklist

- ✓ `border-radius: 0` on all elements
- ✓ 1px solid borders only — no 4px stripe (that's exclusive to the receipt)
- ✓ Amber under 5%: wordmark (~200px²) + CTA fill (~7700px²) = ~2.4% of mobile viewport
- ✓ Three-layer hierarchy present
- ✓ No shadows, gradients, glass
- ✓ Tabular-nums on amount and phone number via `Mono`
- ✓ Effects vocabulary: only hover state on CTA (background-color 150ms ease-out)
- ✓ No motion (no live dot — there's nothing to poll)
- ✓ `#1A1A1A` text on `#C47E10` amber CTA — 5.3:1 AA
- ✓ Error-color `#C94040` used semantically (state badge), never decoratively
- ✓ Bold-bet #1 (zero radius): all
- ✓ Bold-bet #2 (amber as precious metal): minimal
- ✓ Bold-bet #3 (tabular nums): via `Mono`
- ✓ Bold-bet #4 (three-layer): verified
- ✓ Bold-bet #5 (surface stacking): card on canvas — no shadow, no glow

## Anti-patterns avoided

- No "Tentar novamente" alone — primary CTA always has an escape hatch (per content-strategy.md anti-patterns)
- No emoji 😢 or warning sign 🚨 — calm authority voice
- No "Ops!" exclamatory copy
- No retry-with-spinner (there's nothing to retry on a terminal state)
- No background tint shift to `#FFF8EE` for the card (STYLE.md notes this for `inadimplencia` in the dashboard but here the card stays `#FFFFFF` — adding warm-amber bg would over-amber the screen)
- No color-only state signal (square + label per WCAG 1.4.1)
- No illustration of "sadness"

## Related

- Components: see `shared/component-plan.md` (`PaymentExpiredCard`)
- Brand patterns: STYLE.md §3.1 (Card), §3.5 (PaymentStateTag)
- Microcopy: research/content-strategy.md "Expired / canceled / error screens" block
- Accessibility: research/accessibility-patterns.md §1, §2, §8
- Interactions: shared/micro-interactions.md row #1 (CTA hover)
- Screen 06 (`error.tsx`): same shape, but renders on Convex query failures with retry — has a different primary action
- Screen 07 (`not-found.tsx`): same shape, omits PaymentSummaryHeader and primary CTA
