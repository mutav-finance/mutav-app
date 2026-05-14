# Responsive Behavior

> Chunk: responsive | Phase: design | Project: payment-flow | Generated: 2026-05-13

Mobile-first. Tested baseline is 360×640 (iPhone SE / low-end Android). Tailwind breakpoints from STYLE.md §3.7: `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1440`. Container max-width clamped at `--page-content-max-width: 56rem` (`PageContent variant="narrow"`).

## Master breakpoint behavior

| Element | Mobile (<640px) | Tablet (≥768px) | Desktop (≥1024px) |
|---|---|---|---|
| `PublicShell` header | 56px, 16px H-padding | 56px, 24px H-padding | 56px, 32px H-padding |
| `PageContent` width | 100% with `px-4` | max-w 56rem centered, `px-6` | max-w 56rem centered, `px-6` |
| `PageContent` vertical padding | `py-6` | `py-8` | `py-10` |
| `PaymentSummaryHeader` | stacked: agency / amount / due | same | same |
| `PaymentAddressPanel` (Mode A) | single column inside Card | single column | **two-column inside Card**: QR + amount-block left (54%), M-address + CTA right (46%) |
| `WalletConnectPanel` (Mode B) | single column | single column | single column |
| `PaymentReceiptCard` | single column | single column | single column |
| `PublicFooterMeta` | stacked | row: contact left, locale right | row |
| Primary CTA | full-width 48px | inline 48px, min-width 240px | inline 48px, min-width 240px |
| QR code (Mode A) | 240×240 | 240×240 | 256×256 |
| M-address typography | JetBrains Mono 0.875rem, 4×14 line break | 0.875rem, 4×14 | 0.9375rem, 4×14 |

## Mobile (<640px) — the design target

**Viewport at 360px:**
- Page horizontal padding: 16px (`px-4`)
- Card content area: 360 − 32 = 328px
- Card padding: 24px (per STYLE.md §3.1 Imobiliárias) → inner usable width: 328 − 48 = **280px**
- M-address at 14 chars × 0.875rem JetBrains Mono with `letter-spacing: 0.02em` ≈ 12.6px × 14 = **176px** — fits with breathing room
- QR at 240×240 — fits with 20px breathing room on each side
- Primary CTA full-width × 48px height — exceeds WCAG 2.5.8 (24px) and matches brand 48px Imobiliárias spec

Card stack order on Screen 02 (Mode A) mobile:

```
┌─────────────────────────────┐
│  {agencyName}               │   ← PaymentSummaryHeader (Inter)
│  R$ 2.847,00                │   ← Geist Bold (or Mono+Geist composite)
│  Vence em 3 dias            │   ← Mono evidence
├─────────────────────────────┤
│      ┌─────────────┐        │
│      │             │        │
│      │     QR      │        │   ← 240×240 SEP-7 QR
│      │             │        │
│      └─────────────┘        │
│                             │
│  124,7805 XLM               │   ← AssetAmount
│  ≈ R$ 2.847,00              │
│                             │
│  Endereço de pagamento      │
│  MAAAAAAAAAAAAA             │   ← CopyableAddress 4×14
│  AAAAAABBBBBBBB             │
│  BBBBBBBBBBBBCC             │
│  CCCCCCCCCCCC==             │
│  [   Copiar endereço   ]    │
│                             │
│  ┌─────────────────────┐    │
│  │  Abrir em carteira  │    │   ← Primary CTA (SEP-7 deep-link)
│  └─────────────────────┘    │
│                             │
│  ▪ Aguardando pagamento     │   ← live dot (amber pulse) + Mono line
└─────────────────────────────┘
```

## Tablet (≥768px)

Layout largely identical to mobile — the card stays single-column. The Container caps at 56rem. Outside the card, the page gains breathing room; inside the card, the only change is the primary CTA goes from full-width to `inline-block min-w-[240px]`, anchored to the left edge of the card content.

The QR is still 240×240. No reason to grow it — scannability tops out at ~200px on most phone cameras anyway.

## Desktop (≥1024px)

The Mode A panel goes two-column inside the card. QR and `AssetAmount` left, address block + CTA + live status right. Splits at ~54/46 to give the address column the four wrapped lines without crowding.

```
┌──────────────────────────────────────────────────────────────────┐
│  {agencyName}                                                    │
│  R$ 2.847,00                                                     │
│  Vence em 3 dias                                                 │
├──────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  │  Endereço de pagamento                  │
│  │                  │  │  MAAAAAAAAAAAAA                         │
│  │       QR         │  │  AAAAAABBBBBBBB                         │
│  │      256×256     │  │  BBBBBBBBBBBBCC                         │
│  │                  │  │  CCCCCCCCCCCC==                         │
│  └──────────────────┘  │  [ Copiar endereço ]                    │
│                        │                                         │
│  124,7805 XLM          │  ┌─────────────────────┐                │
│  ≈ R$ 2.847,00         │  │ Abrir em carteira   │                │
│                        │  └─────────────────────┘                │
│                        │                                         │
│                        │  ▪ Aguardando pagamento na rede         │
└──────────────────────────────────────────────────────────────────┘
```

Vertical divider: implemented as `border-right: 1px solid var(--color-border)` on the left column (no extra DOM). Gap: 32px between columns.

## Print (@media print)

The receipt screen has a print stylesheet in `globals.css`. Behavior:

- All chrome stripped: `PublicShell` header, `PublicFooterMeta`, the live-status row (no longer relevant)
- `PaymentReceiptCard` width forced to 100% with `border: 1px solid #000` (no shadow even when print engines try to add one)
- 4px green `#2E8B5A` top-edge stripe **kept** — it survives B&W printing as the only solid grey block, identifying the receipt
- Mono text rendered at 11pt — readable, frugal with ink
- Amber CTA hidden — no action available on paper
- `stellar.expert` link rendered as visible URL beneath the txHash row (`a::after { content: " (" attr(href) ")"; }`), per established print patterns
- Page break: `page-break-inside: avoid` on the card

Other screens (`endereco`, `carteira`, `encerrado`, `error`, `not-found`) are not print-targets — their `@media print` block hides their primary panel and shows a single line: "Tela não disponível em impressão. Acesse o link no navegador."

## Container queries

Existing project pattern (per CLAUDE.md): `PageShell` provides `@container/main`. The Mode A two-column split keys on `@container/main (min-width: 1024px)` rather than viewport. Justification: the public layout has no sidebar, so container width tracks viewport; `@container` is forward-compatible if a sidebar is added later.

## Touch target audit by screen

| Screen | Element | Mobile size | Tablet/Desktop | Min target |
|---|---|---|---|---|
| 01 | Continue (auto-resolves; no manual button) | — | — | — |
| 02 | Copy address button | 44×44 hit area | same | ✓ |
| 02 | "Abrir em carteira" CTA | full-width × 48 | min-w 240 × 48 | ✓ |
| 02 | Locale toggle (footer) | 44×44 hit area | same | ✓ |
| 03 | "Conectar carteira" CTA | full-width × 48 | min-w 240 × 48 | ✓ |
| 04 | "Stellar Expert" link | 44×44 hit area (icon + text) | same | ✓ |
| 04 | Agency contact link | full-width text-link, 48 line-height | inline link, 48 line-height | ✓ |
| 05 | Agency contact link | full-width × 48 | min-w 240 × 48 | ✓ |
| 06 | Retry button | full-width × 48 | min-w 240 × 48 | ✓ |

All adjacent tappable elements: ≥8px gap (most have ≥16px via card padding).
