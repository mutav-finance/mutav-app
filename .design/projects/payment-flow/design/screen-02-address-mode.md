# Screen 02 — Address Mode (Stellar, v1 primary)

> Chunk: screen-02-address-mode | Phase: design | Project: payment-flow | Generated: 2026-05-13
> Route: `/[locale]/pagar/[publicId]/endereco`

## Purpose

The hero screen of v1. Camila lands here directly via `redirect()` from Screen 01 in the common case (Mode A is the only mode enabled). She must accomplish exactly one of three convenience tiers:

1. **Scan the QR** with a wallet app camera (Lobstr, Freighter mobile, exchange wallet camera).
2. **Tap "Abrir em carteira"** — the SEP-7 deep-link triggers the OS protocol handler.
3. **Copy the M-address** (and confirm the amount manually) — fallback for legacy / exchange wallets.

All three carry the **same SEP-7 payload**. The page does not push one over the others — it offers them as equals stacked by convenience.

The `HorizonPaymentPoller` runs ambiently the entire time. When the payment lands, the page auto-redirects to `/recibo` (Screen 04) via `router.replace`. The tenant never taps "Já paguei" — that button does not exist.

## User flow position

```
/pagar/[publicId]      → (redirect)
       ↓
/pagar/[publicId]/endereco  ← THIS SCREEN (Mode A)
       │   ambient: HorizonPaymentPoller listens
       │
       ↓   on state.kind === "paid" (server-pushed)
/pagar/[publicId]/recibo  (Screen 04)
```

## Layout (mobile, 360px baseline)

```
┌────────────────────────────────────────┐
│  tga                            pt-BR  │  ← PublicShell header (56px)
├────────────────────────────────────────┤
│                                        │
│   Imobiliária Costa & Filhos           │  ← PaymentSummaryHeader
│   R$ 2.847,00                          │     · agency (Inter)
│   Vence em 3 dias · 15/05/2026         │     · amount (Geist Bold composite)
│                                        │     · due date (Mono)
│   ┌──────────────────────────────────┐ │
│   │ Endereço de pagamento            │ │  ← Card label (Inter Medium 14)
│   │                                  │ │
│   │     ┌──────────────────┐         │ │
│   │     │                  │         │ │
│   │     │       QR         │         │ │  ← 240×240 SEP-7 QR (SVG, RSC)
│   │     │      240×240     │         │ │     1px #D9D7D2 border, 0px radius
│   │     │                  │         │ │     monochrome #1A1A1A / #FFFFFF
│   │     └──────────────────┘         │ │
│   │                                  │ │
│   │     124,7805 XLM      [copy]     │ │  ← AssetAmount + CopyableValue
│   │     ≈ R$ 2.847,00                │ │     Mono, tabular-nums
│   │                                  │ │
│   │     ───────────────────          │ │  ← Separator (1px #D9D7D2)
│   │                                  │ │
│   │     Como pagar via Stellar  ▾    │ │  ← Collapsible (relocated here)
│   │                                  │ │     intros the address block
│   │     MAAAAAAAAAAAAA      [copy]   │ │  ← CopyableAddress
│   │     AAAAAABBBBBBBB               │ │     4 × 14 chars, JetBrains Mono
│   │     BBBBBBBBBBBBCC               │ │     letter-spacing: 0.02em
│   │     CCCCCCCCCCCC==               │ │     ENTIRE BLOCK is the tap target
│   │                                  │ │     (no separate "Copiar" button)
│   │  ┌─────────────────────────────┐ │ │
│   │  │     Abrir em carteira       │ │ │  ← Primary CTA (SEP-7 <a>)
│   │  └─────────────────────────────┘ │ │     amber fill #C47E10, 48px
│   │                                  │ │     text #1A1A1A
│   │  ▪ Aguardando pagamento na rede  │ │  ← HorizonPaymentPoller row
│   │                                  │ │     6×6 amber square (pulse 2s)
│   └──────────────────────────────────┘ │     + Mono label
│                                        │
├────────────────────────────────────────┤
│  Dúvidas? Fale com a {agencyName} pt|en│  ← PublicFooterMeta
└────────────────────────────────────────┘
```

## Layout (desktop, ≥1024px — two-column inside card)

```
┌──────────────────────────────────────────────────────────────┐
│  tga                                                  pt-BR  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Imobiliária Costa & Filhos                                 │
│   R$ 2.847,00                                                │
│   Vence em 3 dias · 15/05/2026                               │
│                                                              │
│   ┌───────────────────────────────────────────────────────┐  │
│   │ Endereço de pagamento                                 │  │
│   │                                                       │  │
│   │  ┌──────────────────┐ │ Como pagar via Stellar  ▾     │  │
│   │  │                  │ │                               │  │
│   │  │       QR         │ │ MAAAAAAAAAAAAA      [copy]    │  │
│   │  │     256 × 256    │ │ AAAAAABBBBBBBB                │  │
│   │  │                  │ │ BBBBBBBBBBBBCC                │  │
│   │  └──────────────────┘ │ CCCCCCCCCCCC==                │  │
│   │                       │                               │  │
│   │  124,7805 XLM   [c]   │ ┌────────────────────────┐    │  │
│   │  ≈ R$ 2.847,00        │ │  Abrir em carteira     │    │  │
│   │                       │ └────────────────────────┘    │  │
│   │                       │                               │  │
│   │                       │ ▪ Aguardando pagamento        │  │
│   └───────────────────────────────────────────────────────┘  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  Dúvidas? Fale com a {agencyName}                    pt|en   │
└──────────────────────────────────────────────────────────────┘
```

54/46 left/right split. Vertical divider via `border-right: 1px solid var(--color-border)` on left column. Gap 32px.

## Components used

| Slot | Component | Source |
|---|---|---|
| Shell | `PublicShell` + `PageContent variant="narrow"` | new + existing |
| Summary | `PaymentSummaryHeader` | new |
| Outer card | `Card` + `CardContent` (24px padding, 1px `#D9D7D2`, 0px radius) | shadcn (refactored) |
| QR | `PaymentAddressQrCode` (RSC, SVG via `qrcode`) | new |
| Asset amount | `AssetAmount` wrapped in `CopyableValue` | new |
| Separator | `Separator` (1px solid `--color-border`, 0px radius) | shadcn |
| Address | `CopyableAddress` (4 × 14 chunks) — **the entire block is one tap target**; copy icon at top-right corner of the block, full-block click handler writes `fullStrkey` to clipboard | new |
| Primary CTA | `Button variant="default" size="lg" asChild` wrapping an `<a href={sep7Uri}>` ("Abrir em carteira") | shadcn |
| Poller row | `HorizonPaymentPoller` (client island) | new |
| Help disclosure | shadcn `Collapsible` with Phosphor `CaretDown` light icon (weight="light") | shadcn |
| Footer | `PublicFooterMeta` | new |
| Toast surface | `Sonner` (mounted once in `PublicShell`) | shadcn |

## States

### Default (state.kind === "pending")

As drawn above. The `HorizonPaymentPoller` Mono line reads `Aguardando pagamento na rede` (en: `Waiting for payment on network`). The 6×6 amber square pulses opacity 1 → 0.4 → 1 over 2s linear infinite — the **only** ambient animation on the page.

### Empty

Not applicable — a pending payment always has a derived M-address, amount, and SEP-7 URI. There is no "empty" state.

### Loading

When the user navigates to this URL with no cached RSC (e.g. first visit from WhatsApp), `loading.tsx` for `/endereco` renders:

- `PaymentSummaryHeader` skeleton: 3 stacked lines (60%/50%/40% widths, heights 12/32/12)
- Card skeleton:
  - 240×240 `Skeleton` block (the QR placeholder) — `bg-[var(--color-surface-2)]`, **no shimmer**
  - Single 16px-tall × 50% line (asset amount placeholder)
  - 4 × 1-line `Skeleton` strips (address placeholder, 100% width × 16px)
  - 48px-tall × 100% block (CTA placeholder)
- No skeleton for the poller row — that requires live data
- Reduced motion: skeletons render as flat `--color-surface-2` rectangles (the default — shimmer is globally disabled, per `micro-interactions.md` and brand motion dial)

### Error (within this screen)

If `useQuery(getPublicByPublicId)` throws after initial SSR (e.g. Convex outage), the `HorizonPaymentPoller` stops updating but the page remains usable — the M-address and SEP-7 URI are server-rendered and don't depend on live data. Below the poller row, a small Mono `--color-text-2` line (4.5:1 AA pass) reads:

> Conexão instável. Atualizando assim que possível.

(en: `Connection unstable. Updating as soon as possible.`)

This is NOT a full error screen — it's an inline degradation. Tenants can still pay; the poller will resume when connection returns. Real load failures (initial RSC throw) route to Screen 06 (`error.tsx`).

### Mode-resolution race

If, between SSR and client hydration, the server flips the payment to `state.kind === "paid"` (rare — agency manually marked or Horizon poller fired during page load), `HorizonPaymentPoller` mounts, sees the new state on first subscription frame, and `router.replace`s to `/recibo`. The user briefly sees the address card on first paint, then the receipt — never a stuck state.

## Interactions

| # | Trigger | Outcome | Spec |
|---|---|---|---|
| 1 | Tap anywhere on the address block (CopyableAddress) | `navigator.clipboard.writeText(fullStrkey)` fires synchronously in `onClick`; Phosphor `Copy → Check` icon at top-right swaps for 1.6s; Sonner toast "Copiado" / "Copied" fires with `role="status"` aria-live polite. Block has `role="button"`, `tabindex="0"`, full keyboard activation (Enter/Space). | Per accessibility-patterns.md §5 + technical-research.md §7 |
| 2 | Tap "Abrir em carteira" (primary CTA) | Browser navigates to `web+stellar:pay?destination=…&amount=…&asset_code=XLM`; OS protocol handler triggers the user's wallet; if no handler is registered, nothing happens silently — the tenant falls through to copy-paste | `<a href={sep7Uri}>` wrapped in `Button asChild`; no client JS |
| 3 | Tap copy icon next to asset amount | Same as #1 but copies the raw amount string (`"124.7805"` — no thousand separator, dot decimal — wallet-paste-friendly) | Same toast handler, different payload |
| 4 | Tap "Como pagar via Stellar" disclosure | shadcn `Collapsible` opens; content reveals 5 numbered steps (per content-strategy.md "Como pagar via Stellar" block); CaretDown icon rotates — **only via icon swap, not CSS rotate** (replace with `CaretUp` glyph; brand contract forbids `transform: rotate`) | shadcn `Collapsible` + custom icon swap |
| 5 | Convex subscription pushes `state.kind === "paid"` | `HorizonPaymentPoller` calls `router.replace(`/${locale}/pagar/${publicId}/recibo`)`; receipt page renders fresh | `useRouter` from `@/i18n/navigation`; `router.replace` so back button doesn't loop |
| 6 | QR is double-tapped on mobile | Native OS image-save context menu may appear depending on browser. Acceptable — the QR is a valid graphical payload anywhere. |
| 7 | Long-press on M-address chunks | Native OS text selection; un-overridden. User can paste manually if the copy button fails. |
| 8 | Page hidden (tab switch) | Convex subscription persists; on return, the page is in sync. No reconnect dance needed. |

## Accessibility

### Tab order

1. Skip link (visible on focus) → `#primary-action` (the "Abrir em carteira" CTA)
2. TGA wordmark — `tabindex="-1"` (non-focusable)
3. Locale switch (pt-BR / en)
4. `PaymentSummaryHeader` text — non-focusable
5. Copy button next to asset amount
6. "Como pagar via Stellar" disclosure trigger
7. (after expand) the help content links — none in v1
8. Address block (CopyableAddress, `role="button"`, full-block tap target)
9. "Abrir em carteira" primary CTA (`id="primary-action"`)
10. Agency-contact link in `PublicFooterMeta`

### Focus indicator

Per STYLE.md §3.4 / accessibility-patterns.md §10: border-color shifts to `--color-accent` (`#C47E10`) on `:focus-visible`. **No ring, no outline, no box-shadow.** Implementation requires explicit `outline: none` + a reliable 1px border on every focusable element. For text-only links (locale switch, copy buttons-as-icons), a 1px `border-bottom: 1px solid var(--color-accent)` appears on focus.

### Screen reader

The QR `<svg>` carries:
- `role="img"`
- `aria-labelledby="qr-title qr-desc"`
- `<title id="qr-title">Código de pagamento Stellar — R$ 2.847,00</title>`
- `<desc id="qr-desc">Use a câmera de uma carteira Stellar. Como alternativa, copie o endereço abaixo.</desc>`

The M-address renders inside a `<code>` element (semantic "machine-readable"). The four wrapped lines are inside the same `<code>` with explicit `aria-label` carrying the full unbroken string — so SR reads "address: M-A-A-A-... (full string)" once, not four times.

The live poll dot is `aria-hidden="true"` (pure decoration). The "Aguardando pagamento na rede" Mono line is in a `role="status" aria-live="polite"` region — but the message is static for the page's lifetime. When state flips to paid, the route change naturally announces the new page; no live region update needed here.

### Touch targets

All ≥48px height for primary actions, ≥44×44 for icon buttons. Whole-card surfaces are not interactive — the card is informational chrome around the panel.

### Reduced motion

The live pulse continues (status signal). Toast slide-in is replaced with opacity-only fade. Skeleton shimmer is already globally disabled.

## Image resources

| Slot | Type | Description | Treatment |
|---|---|---|---|
| QR code | SVG (server-generated) | SEP-7 `pay` URI for the muxed `M…` destination, amount, and `asset_code=XLM` | Monochrome `#1A1A1A` on `#FFFFFF`. `errorCorrectionLevel: "M"`. `margin: 1` (narrow quiet zone). 240px on mobile, 256px on `≥md`. Wrapped in 1px `#D9D7D2` border, 0px radius. No quiet-zone art. Inlined as SVG string. |
| Copy icon | Phosphor `Copy` weight="light" 20px | Bare, no container, inherits `--color-text` | Swap to `Check` weight="light" 20px for 1.6s on successful copy. Never amber-colored. |
| Disclosure icon | Phosphor `CaretDown` weight="light" 16px | Bare, beside the disclosure label | Swap to `CaretUp` on open. No CSS rotate. |
| Brand mark | live text (`tga`, Geist Bold) | Top-left of `PublicShell` header | Color `#C47E10`. Not an image. |

**No photography, no illustration, no decorative imagery.** Per `imagery-style.md`, the Imobiliárias front permits photography for "warmth delivery" — but this is a functional payment surface, not a marketing page. The QR carries the entire visual weight.

## Three-layer hierarchy verification

| Layer | Element |
|---|---|
| Declaration (Geist Bold) | `R$ 2.847,00` in `PaymentSummaryHeader` |
| Explanation (Inter) | Agency name, "Endereço de pagamento" labels, disclosure title, "Aguardando pagamento na rede" |
| Evidence (Mono) | Due date, asset amount (XLM + BRL equiv), the M-address itself |

All three layers present and well-distributed. ✓

## Brand-fidelity checklist

- ✓ `border-radius: 0` on card, button, separator, QR border, copy button hit area
- ✓ 1px solid borders everywhere; no 2px decorative, no dashed
- ✓ Amber under 5%: appears only on primary CTA fill (~7700px² at 320×48), wordmark (~200px²), live dot (~36px²). Sum ~7.9k px² on a ~327k px² mobile viewport — well under 5%.
- ✓ Three-layer hierarchy present
- ✓ No shadows, gradients, glass
- ✓ Tabular-nums on amount, asset amount, BRL equivalent, due date — all via `Mono`
- ✓ Effects vocabulary: only `color` + `background-color` + `border-color` + `opacity` transitions
- ✓ `#1A1A1A` text on `#C47E10` amber fill (primary CTA) — 5.3:1 AA pass per STYLE.md
- ✓ No icons in amber
- ✓ Phosphor weight="light" only
- ✓ 8px baseline grid: all spacing multiples of 8 (card padding 24, gap 16, button height 48, etc.)
- ✓ Bold-bet #2 (amber as precious metal): single CTA + wordmark + dot are the only amber
- ✓ Bold-bet #3 (tabular nums on every number): `Mono` everywhere
- ✓ Bold-bet #4 (three-layer hierarchy): verified above
- ✓ Bold-bet #5 (surface stacking without shadows): card on canvas reads via background step `#F7F6F3 → #FFFFFF` + 1px border

## Anti-patterns avoided

- No "Já paguei" / "I paid" button (recommendations.md C1)
- No countdown timer — muxed address is valid for the invoice lifetime (no SEP-23 expiration; the invoice itself has a due date but pays remain valid post-due via the same address)
- No spinner — live dot opacity-pulse is the only motion
- No checkmark animation, no confetti
- No 2×2 tile grid for method selection (recommendations.md C4) — only one method exists in v1
- No `useEffect setInterval` polling — Convex subscription only
- No `aria-live` on a ticking element
- No `outline: none` without a border-color replacement
- No raw color scales (`bg-emerald-*`, etc.); all colors via semantic tokens

## Related

- Components: see `shared/component-plan.md`
- Brand patterns: `STYLE.md §3.1` (Card), `§3.2` (Button primary), `§3.3` (Button secondary), `§3.4` (Input — not used here), `§3.5` (Badge — not used here), `§5` (Effects)
- Microcopy: `research/content-strategy.md` (Stellar execution screen block — adapted for Mode A naming)
- Stellar derivation + SEP-7 build: `research/stellar-modes.md`
- Accessibility: `research/accessibility-patterns.md` §1–6
- Interactions table: `shared/micro-interactions.md`
