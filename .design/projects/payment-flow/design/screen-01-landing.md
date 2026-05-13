# Screen 01 — Landing / Mode Resolver

> Chunk: screen-01-landing | Phase: design | Project: payment-flow | Generated: 2026-05-13
> Route: `/[locale]/pagar/[publicId]`

## Purpose

First contact. Camila taps the WhatsApp link, the page resolves the payment, and within ~250ms she sees agency + amount + due date or is server-redirected to the right downstream screen. **The landing is mostly invisible** — it exists to make the routing decision once, server-side.

The visible flash of this screen is reserved for the rare case where the agency has both Mode A and Mode B enabled (v1.1+) and a tenant needs to choose. In v1, this screen never visually renders for ≥99% of payments — it `redirect()`s.

## User flow position

```
[WhatsApp / magic link]
       ↓
   /pagar/[publicId]            ← THIS SCREEN
       │
       ├─ state=paid       → redirect /recibo
       ├─ state=overdue    → redirect /encerrado
       ├─ state=canceled   → redirect /encerrado
       ├─ state=pending + Mode A only      → redirect /endereco
       ├─ state=pending + Mode B only      → redirect /carteira (v1.1)
       └─ state=pending + both modes       → render mode toggle (v1.1+)
```

## Layout

### Mobile / Tablet / Desktop — when rendered (v1.1+, both modes case)

```
┌─────────────────────────────────────────────┐
│  tga                                    pt-BR│  ← PublicShell header (56px)
├─────────────────────────────────────────────┤
│                                             │
│                                             │
│   {agencyName}                              │  ← PaymentSummaryHeader
│   R$ 2.847,00                               │     · Inter 14px agency
│   Vence em 3 dias · 15/05/2026              │     · Geist Bold 36px amount
│                                             │     · JetBrains Mono 14px due
│                                             │
│   ┌─────────────────┬─────────────────┐     │  ← Mode toggle (Tabs)
│   │  ENDEREÇO       │   CARTEIRA      │     │     active: 1px amber underline
│   │  ────────       │                 │     │
│   └─────────────────┴─────────────────┘     │
│                                             │
│   [the chosen panel renders below]          │
│                                             │
│                                             │
├─────────────────────────────────────────────┤
│  Dúvidas? Fale com a {agencyName}    pt|en  │  ← PublicFooterMeta
└─────────────────────────────────────────────┘
```

### v1 — always redirected, never user-visible

`page.tsx` is a pure RSC. It calls `preloadQuery(api.payments.useCases.getPublicByPublicId)` (no client island), then `ModeResolver` (server) reads the result and issues `redirect()` to the correct sub-route. The user never sees this URL.

## Components used

| Slot | Component | Source |
|---|---|---|
| Page shell | `PublicShell` (new) wrapping `PageShell` | `src/components/public/public-shell.tsx` |
| Top mark | `tga` wordmark, lowercase Geist Bold 18px `#C47E10` | inside `PublicShell` header |
| Locale switch | `LocaleSwitch` (new) | header right side |
| Summary | `PaymentSummaryHeader` (new) | `…/payments/flow/payment-summary-header.tsx` |
| Resolver | `ModeResolver` (new, RSC) | `…/payments/flow/mode-resolver.tsx` |
| Mode toggle (v1.1+) | shadcn `Tabs` | `src/components/ui/tabs.tsx` |
| Footer | `PublicFooterMeta` (new) | `src/components/public/public-footer-meta.tsx` |

## States

### Default (v1 — invisible redirect path)

`ModeResolver` reads payment + agency config:
- `state.kind === "paid"` → `redirect(`/${locale}/pagar/${id}/recibo`)`
- `state.kind === "overdue"` or `"canceled"` → `redirect(`…/encerrado`)`
- `state.kind === "pending"` + only `acceptsAddressMode` → `redirect(`…/endereco`)`
- `state.kind === "pending"` + only `acceptsWalletMode` (v1.1) → `redirect(`…/carteira`)`
- `state.kind === "pending"` + both → render the visible mode-toggle layout (see above)

### Empty

Not applicable — every payment has a defined state.

### Loading

`page.tsx` is a server component. While the RSC resolves the Convex `preloadQuery`, the browser shows the Next.js streamed shell:
- `PublicShell` header (renders immediately — no data)
- `loading.tsx` for `/pagar/[publicId]` renders a `PageContent variant="narrow"` with three stacked `Skeleton` lines mirroring `PaymentSummaryHeader` proportions:
  - Skeleton 1: width 60% × height 12px (agency line)
  - Skeleton 2: width 50% × height 32px (amount)
  - Skeleton 3: width 40% × height 12px (due date)
- Skeletons fill is `var(--color-surface-2)`; **no shimmer** (motion dial 2, brand contract)

### Error

`/pagar/[publicId]/error.tsx` (Screen 06) takes over on any Convex query failure. Not rendered inside this screen.

### Not found

If `getPublicByPublicId` returns `{ success: false, error: { code: "NOT_FOUND" } }`, the RSC calls `notFound()` from `next/navigation`. `/pagar/[publicId]/not-found.tsx` (Screen 07) renders.

## Interactions

| Trigger | Outcome |
|---|---|
| Page load | Server resolves; redirects in 99%+ of cases. |
| Tap on Mode toggle (v1.1+ only) | `data-state="active"` swaps tabs; `<TabsContent>` renders the chosen panel beneath the summary. URL rewrites to the corresponding sub-route via `router.replace` so deep-linking works. |
| Tab toggle keyboard nav (v1.1+) | ←/→ arrows between tabs; Tab key moves out of the strip. Per shadcn `Tabs` defaults. |
| Locale switch tap | `Link` to the matching path under the other locale prefix. Preserves `publicId`. |

## Accessibility

### Tab order (v1.1+ visible variant)

1. Skip link (visible on focus only) → `#primary-action` (the active tab's CTA inside the panel)
2. TGA wordmark — `tabindex="-1"` (deliberately non-focusable; the mark is non-clickable on this surface)
3. Locale switch (pt-BR / en) — two `<a>` elements
4. `PaymentSummaryHeader` — pure text; no focusable elements
5. Mode tabs — `<TabsTrigger>` × 2
6. Whatever the active `<TabsContent>` exposes (delegated to that panel's spec)
7. `PublicFooterMeta` agency-contact link

For v1 (invisible redirect path), this screen has no tab order — focus never lands here.

### Semantic landmarks

- `<header>` for the top bar (`<PublicShell>` wraps it)
- `<main id="main">` for the content area
- `<footer>` for `PublicFooterMeta`

### Screen reader announcement order

1. `tga` (treated as decorative — `role="img" aria-label="TGA"` on the wordmark wrapper; SR reads "TGA, image")
2. Locale switch
3. "Pagamento de aluguel — {agencyName} — R$ 2.847,00 — Vence em 3 dias, 15 de maio de 2026" (PaymentSummaryHeader as a `<header>` containing `<h1>`)
4. "Escolha como pagar" (the Tabs `aria-label` on `<TabsList>`)
5. "Endereço, tab 1 of 2, selected" / "Carteira, tab 2 of 2"
6. The active panel's content
7. "Dúvidas? Fale com a {agencyName}" (footer)

### Focus management

If a user is on Screen 01 (v1.1+) and toggles the tab, focus stays on the `<TabsTrigger>` — shadcn's default behavior. Convex live state changes that flip `pending → paid` cause `router.replace` to `/recibo`; on landing there, focus management is the receipt's responsibility.

## Image resources

None. The brand mark (`tga` wordmark) is rendered as live text, not an image. Per `imagery-style.md`, Imobiliárias front would normally allow photography — but the public payment surface has no marketing real estate; the entire page is functional.

If a future revision adds a hero panel (out of scope for v1/v1.1), the imagery would follow the Imobiliárias photography spec: real Brazilian apartments, warm grading, `aspect-[4/3]` or `aspect-video`, with `Image` + LQIP per `imagery-style.md`.

## Three-layer hierarchy verification

| Layer | Element | Class/Spec |
|---|---|---|
| Declaration (Geist Bold) | R$ 2.847,00 inside `PaymentSummaryHeader` | `font-display font-bold text-[36px]` |
| Explanation (Inter) | `{agencyName}` line + the section header above tabs ("Escolha como pagar") | `font-body text-sm` (agency) + `text-xs uppercase` (tab section) |
| Evidence (Mono) | Due-date line "Vence em 3 dias · 15/05/2026" | `<Mono className="text-sm">` |

All three layers present. ✓

## Brand-fidelity checklist

- ✓ `border-radius: 0` everywhere (tabs, cards, headers)
- ✓ 1px solid borders only (mode-toggle underline + footer divider)
- ✓ Amber under 5%: appears on active tab underline + (if scrolled into view) the Mode A panel's CTA + live dot. On this screen as standalone: only the wordmark + active tab underline.
- ✓ Three-layer hierarchy present (Geist amount + Inter agency + Mono due)
- ✓ No shadows, gradients, glass
- ✓ Tabular-nums on amount and due-date day count
- ✓ Effects vocabulary: only `color` + `border-color` on tab toggle hover/focus; no transform
