# Screen 07 — Not Found

> Chunk: screen-07-not-found | Phase: design | Project: payment-flow | Generated: 2026-05-13
> Route: `/[locale]/(public)/pagar/[publicId]/not-found.tsx`

## Purpose

Triggered when `notFound()` is called from inside the route segment — typically when `getPublicByPublicId` returns `{ success: false, error: { code: "NOT_FOUND" } }`. The tenant likely:

- Mistyped a forwarded URL
- Clicked an expired magic link (post-rotation, when v2 ships)
- Was sent a stale link that has been revoked

The screen reuses the **same visual shape as Screen 05 (`encerrado`)** with the `notFound` variant — described in Screen 05's "Variants" section. This file documents the route-level differences and the specific copy/component plumbing.

## User flow position

```
[Magic link with invalid/expired publicId]
                ↓
   /pagar/[publicId]                         (Screen 01 — Mode Resolver)
                │
                │  query returns NOT_FOUND
                ↓
            notFound()                       (Next.js helper)
                ↓
            not-found.tsx                    ← THIS SCREEN
                │
                └─ (terminal — no agency to contact directly)
```

## Layout

Same Card shape as Screen 05, but **PaymentSummaryHeader is omitted** (we have no payment data — that's the whole point) and **no primary CTA renders** (we don't know which agency to point the tenant to).

```
┌────────────────────────────────────────┐
│  tga                            pt-BR  │  ← PublicShell header
├────────────────────────────────────────┤
│                                        │
│   ┌──────────────────────────────────┐ │
│   │  ▪ NÃO_ENCONTRADO                │ │  ← PaymentStateTag (notFound variant)
│   │                                  │ │     #555B66 square + label
│   │  Pagamento não encontrado        │ │  ← Geist Bold 24px (<h1>)
│   │                                  │ │
│   │  O link pode estar incorreto     │ │  ← Inter body
│   │  ou expirado.                    │ │
│   │                                  │ │
│   │  Verifique com a imobiliária     │ │
│   │  que te enviou este pagamento.   │ │
│   │                                  │ │
│   └──────────────────────────────────┘ │
│                                        │
├────────────────────────────────────────┤
│                                 pt|en  │  ← PublicFooterMeta (slim)
└────────────────────────────────────────┘
```

## Components used

| Slot | Component | Source |
|---|---|---|
| Shell | `PublicShell` + `PageContent variant="narrow"` | new + existing |
| Card | `Card` + `CardContent` | shadcn |
| Status badge | `PaymentStateTag state="notFound"` — new variant on existing component | existing (extend) |
| Footer | `PublicFooterMeta` (slim) | new |

No CTA. No `<Mono>` evidence values (we have nothing to surface). The screen is deliberately spare — the message is the entire content.

## States

### Default — render

The route's `page.tsx` calls `notFound()` when the Convex query returns `NOT_FOUND`. Next.js unwinds the segment stack and renders `not-found.tsx`. No props, no data, no client logic.

The page is a pure RSC. No telemetry (the URL itself may be sensitive — a stale magic link). No retry button.

### Empty / Loading / Error

Not applicable. `not-found.tsx` is itself the fallback for an "empty" state. There's no async work — it renders synchronously.

## Interactions

| # | Trigger | Outcome |
|---|---|---|
| 1 | Locale switch | Re-renders in the chosen language — but the URL might still be invalid; same screen shows |
| 2 | Browser back | Returns to the URL the tenant came from (WhatsApp) — typical recovery path |

That's it. No internal interactions — the screen is fully terminal.

## Accessibility

### Tab order

1. Skip link (visible on focus) → `#main` (the card)
2. Locale switch
3. The card content (non-focusable)

There are NO actionable elements on this screen. The only focusable elements are the locale-switch anchors. Tab eventually moves past the document.

### Screen reader announcement order

1. "TGA" (wordmark)
2. Locale switch
3. "NÃO ENCONTRADO" (PaymentStateTag label)
4. "Pagamento não encontrado" (`<h1>` inside card)
5. Body prose in full

The page wrap is `role="region" aria-labelledby="not-found-title"` — semantically it's not an alert (the user navigated here), just a regular page that happens to have no actions.

### Focus management

Focus is at page top on mount (default). No programmatic focus changes. The `<h1>` is announced naturally on navigation.

### Color contrast

Same as Screen 05 / `notFound` variant. `#555B66` square on `#FFFFFF` = 6.8:1 (AA Normal pass).

### Touch targets

Only the locale switch is interactive: 44×44 each anchor.

### Reduced motion

No motion.

## Image resources

None. No icons, no illustrations. The brand mark is live text.

## Three-layer hierarchy verification

Note: this screen STRETCHES the three-layer rule because we have no evidence (no payment data to render in Mono). The evidence layer is satisfied minimally by the `NÃO_ENCONTRADO` Mono label inside the PaymentStateTag — STYLE.md §3.5 specifies JetBrains Mono 11px uppercase for badge labels.

| Layer | Element |
|---|---|
| Declaration (Geist Bold) | "Pagamento não encontrado" `<h1>` |
| Explanation (Inter) | Body prose |
| Evidence (Mono) | `NÃO_ENCONTRADO` label inside the badge |

All three layers present, technically. ✓ The critique phase may push back on the thinness of the evidence layer here; if so, add a sub-line Mono `Ref: {timestamp}` for symmetry with Screen 06. Decision deferred to critique pass.

## Brand-fidelity checklist

- ✓ `border-radius: 0` on all elements
- ✓ 1px solid borders only
- ✓ Amber under 5%: wordmark only (~200px²) ≈ 0.06%
- ✓ Three-layer hierarchy present (with the evidence-layer caveat above)
- ✓ No shadows, gradients, glass
- ✓ Tabular-nums irrelevant (no numeric data shown)
- ✓ Effects vocabulary: locale-switch hover (color shift, 150ms ease-out)
- ✓ Bold-bet #1 (zero radius): all
- ✓ Bold-bet #2 (amber as precious metal): minimal — this screen is the lowest-amber surface in the flow
- ✓ Bold-bet #3 (tabular nums): N/A on data; Mono badge label uses tabular-nums by default per `Mono` primitive
- ✓ Bold-bet #4 (three-layer): all three present
- ✓ Bold-bet #5 (surface stacking): card on canvas

## Anti-patterns avoided

- No "404" numeric callout — the badge says NÃO_ENCONTRADO, which is the actual semantic
- No "Voltar para a página inicial" CTA — there is no "home" for a public payment portal
- No search box ("procure outro pagamento") — there's nothing to search
- No emoji
- No illustration of "lost map" / "missing puzzle piece"
- No retry button
- No telemetry that exposes the publicId in logs

## Related

- Components: see `shared/component-plan.md` (`PaymentExpiredCard` is reused with notFound variant)
- Brand patterns: STYLE.md §3.1, §3.5
- Microcopy: research/content-strategy.md "Expired / canceled / error screens" block — "not-found" row
- Accessibility: research/accessibility-patterns.md §1, §8
- Screen 05 (parent visual pattern): `screen-05-expired.md`
- Screen 06 (sibling error boundary): `screen-06-error.md`
