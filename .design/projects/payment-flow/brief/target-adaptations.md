# Target Adaptations

> Chunk: target-adaptations | Phase: brief | Project: payment-flow | Generated: 2026-05-13
> Updated: 2026-05-13 — scoped to Stellar (2 modes).

## Token overrides

None. Imobiliárias front already encodes the exact tokens this surface needs (light canvas, amber CTA, JetBrains Mono numerics). Every value resolves through existing `--color-*` / `--font-*` / spacing tokens.

If the design phase finds a missing token (e.g. a softer "informational" surface for the mode toggle), it goes in `tga.yml` (brand-level), not here.

## Component adaptations

### `Card` — public-portal variant
Imobiliárias card chrome unchanged: `#FFFFFF` bg, `1px #D9D7D2` border, `0px` radius, `24px` padding, no shadow. Two instances:

- **Mode panel card (address-mode hero, wallet-mode hero)** — same chrome. Mode A holds: a 240×240px SEP-7 QR (top), the asset-amount row (middle), the four-line copyable M-address (bottom), and a primary `Abrir em carteira` CTA. Mode B holds the wallet-connect flow.
- **Receipt card** — same chrome plus the `paid` top-edge stripe pattern (4px `#2E8B5A` top border, STYLE.md §3.1). The only place in the flow where success-green reads decoratively because it IS the verification.

### `Button` — primary
Exact spec from STYLE.md §3.2 (Imobiliárias amber fill, `#1A1A1A` text, 48px height, 0px radius). No size escalation. CTA copy is imperative + specific:
- Mode A primary: **`Abrir em carteira`** (SEP-7 deep-link — works on desktop via protocol handler, mobile via app)
- Mode A secondary (copy actions on the address): inline icon button via `CopyableAddress`
- Mode B primary: **`Conectar carteira`** → state cycles to **`Assinar transação`** → **`Confirmando…`** (disabled state with mono spinner-substitute, not a CSS rotation — see motion rule)

`Verificar pagamento` is **not** a button — the `HorizonPaymentPoller` runs ambiently; manual verification is not a user task.

Never `Continuar`. Never `OK`. Never `Enviar`.

### `Badge` — square+label (STYLE.md §3.5)
- `AGUARDANDO` — `#C47E10` square (amber, system state cue)
- `PAGO` — `#2E8B5A` square
- `EXPIRADO` — `#C94040` square
- `CANCELADO` — `#555B66` square

`PaymentStateTag` (existing) is reused unchanged.

### `Mono` — universal numeric primitive
Every numeric value renders through `<Mono>`. Three calibrations:
- **Amount (hero):** `Mono` with `font-size: 2.25rem` (Geist Bold companion for the BRL prefix is acceptable per three-layer hierarchy)
- **Address line:** `Mono` with `font-size: 0.875rem`, `letter-spacing: 0.02em` for readability
- **Tx evidence:** `Mono` with `font-size: 0.75rem`, `--color-text-2` (subdued)

No raw `font-mono` Tailwind class outside the `Mono` primitive.

### New primitive: `CopyableValue`
`<Mono>` value + copy button (Phosphor `Copy` light weight) + one-shot `Sonner` toast `Copiado` / `Copied`. Used:
- Mode A: the M-address (in 4-line variant via `CopyableAddress`), the amount in asset
- Mode A receipt: the `txHash`

Lives at `src/components/payments/copyable-value.tsx`. Click handler writes to clipboard **synchronously** (iOS Safari transient activation requirement).

### New primitive: `CopyableAddress`
Specialized `CopyableValue` that breaks a 56-char Stellar strkey into 4 lines × 14 chars, displayed as a left-aligned Mono block with a single copy affordance copying the full unbroken string. Visual rhythm:

```
MAAAAAAAAAAAAA
AAAAAABBBBBBBB
BBBBBBBBBBBBCC
CCCCCCCCCCCC==
```

Why 14-char chunks: divisible into 56 cleanly, fits 360px viewport without wrapping at 0.875rem Mono.

### `AssetAmount`
The amount block specifically for Stellar values. Two-line layout:
- Line 1: `<Mono>1234.5678 XLM</Mono>` (4-decimal precision for XLM stroops to lumens)
- Line 2: `<Mono>≈ R$ 2.847,00</Mono>` (BRL equivalent — pulled from agency-configured rate or external feed; for v1, a frozen snapshot at invoice time)

The asset name is part of the same Mono run — no separate styling.

### `PaymentAddressQrCode`
Server-rendered SVG QR encoding the SEP-7 URI `web+stellar:pay?destination=M…&amount=…&asset_code=XLM`. Built in an RSC via `qrcode` (node-qrcode) → SVG string, inlined into the page. Sized 240×240 (mobile) / 256×256 (≥md). Monochrome `#1A1A1A` on `#FFFFFF`, **no border-radius**, 1px border `#D9D7D2`, no quiet-zone art. SVG carries `<title>` ("Código de pagamento Stellar — R$ 2.847,00") and `<desc>` (the destination address, for SR) — never `aria-hidden`. Tenants who scan have the amount pre-filled; tenants who can't scan use the address block below.

### `HorizonPaymentPoller`
A client island. Calls `useQuery(api.payments.useCases.getPublicByPublicId, { publicId })` and reacts to the state. On `state === "paid"`, navigates via `useRouter()` (from `@/i18n/navigation`) to `/recibo`. No `setInterval`. No fetch. Convex's reactive subscription does the work.

Visual presence: a small `Mono` line below the address — `Aguardando pagamento na rede` — paired with a 6×6 amber square (the only ambient animation: the 2s opacity pulse from STYLE.md, single global pulse).

## Platform considerations

- **Mobile (primary):** 360px minimum. M-address renders cleanly at 14 chars × 4 lines × 0.875rem Mono. CTAs stack full-width. SEP-7 `Abrir em carteira` button takes the user out of the browser into Freighter/Lobstr/etc on supported platforms; on desktop, it triggers the OS protocol handler.
- **Desktop:** Mode A card has the address + asset amount side-by-side at `≥md` (54/46 split, with the address on the left). CTAs sit beneath, full-width within the card.
- **No dark mode:** `(public)` layout wraps a `<ThemeProvider forcedTheme="light">`. Tenants have no saved preference; institutional surface defaults to light per the Imobiliárias front.
- **Print:** the receipt screen has a `@media print` rule that strips chrome and prints only the receipt card with txHash, amount, paidAt, agency contact. Implemented in `globals.css`; design phase produces the print mockup.

## Implementation target mapping

| Design element | Target primitive | File |
|----------------|------------------|------|
| Public shell | New `PublicShell` extending `PageShell` semantics | `src/components/public/public-shell.tsx` |
| Card | `Card` (shadcn) | `src/components/ui/card.tsx` |
| Button | `Button` (shadcn, `default` + `outline`) | `src/components/ui/button.tsx` |
| Status badge | `PaymentStateTag` | `src/components/payments/payment-state-tag.tsx` (existing) |
| Numeric mono | `Mono` | `src/components/ui/mono.tsx` |
| Copy primitive | New `CopyableValue` + `CopyableAddress` | `src/components/payments/copyable-value.tsx`, `…/copyable-address.tsx` |
| Mode A panel | New `PaymentAddressPanel` | `src/components/payments/flow/payment-address-panel.tsx` |
| Mode A QR | New `PaymentAddressQrCode` (RSC, SVG) | `src/components/payments/flow/payment-address-qr-code.tsx` |
| Mode B panel | New `WalletConnectPanel` | `src/components/payments/flow/wallet-connect-panel.tsx` |
| Asset amount | New `AssetAmount` | `src/components/payments/flow/asset-amount.tsx` |
| Poller | New `HorizonPaymentPoller` | `src/components/payments/flow/horizon-payment-poller.tsx` |
| Receipt | New `PaymentReceiptCard` | `src/components/payments/flow/payment-receipt-card.tsx` |
| Explorer link | New `StellarExplorerLink` | `src/components/payments/flow/stellar-explorer-link.tsx` |
| Expired state | New `PaymentExpiredCard` | `src/components/payments/flow/payment-expired-card.tsx` |
| Toast | `Sonner` | `src/components/ui/sonner.tsx` |

## Links to brand patterns

- Card pattern → `STYLE.md §3.1` (Imobiliárias column)
- Primary button → `STYLE.md §3.2`
- Secondary button → `STYLE.md §3.3` (used for `Abrir em carteira`)
- Input — only for mode B wallet error states → `STYLE.md §3.4`
- Badge — square+label → `STYLE.md §3.5`
- Layout grid (12-col, 8px base) → `STYLE.md §3.7`
- Effects vocabulary (150ms ease-out border-color; ambient amber 2s pulse on poller dot) → `STYLE.md §5`

## Brand constraints driving specific decisions

- **No shadows; no ring.** Focus indication on the mode toggle, copy buttons, and CTAs is border-color shift to `#C47E10`. No `focus-visible:ring`. No glow. The `Mono` block holding the M-address gets focus via border, not background change.
- **Amber under 5%.** Amber appears on: primary CTAs, the `AGUARDANDO` status square, the live poll dot (only one on screen). It does NOT appear on the explorer link, the address chunks, or the asset symbol.
- **Tabular nums everywhere.** M-address chunks, amount in XLM/BRL, ledger number, paidAt timestamp — all forced via `Mono`.
- **No `rounded-*`.** The address block has sharp 0px corners. The copy buttons are 0px. The mode toggle (if rendered) uses 0px tabs from shadcn's `Tabs` primitive with `data-state=active` styled to a 1px amber bottom border, no pill.
- **Motion economy.** The only animation on this surface is the 6×6 amber `live` dot pulsing 2s linear infinite (opacity, per STYLE.md). No spinners. The "Confirmando…" state on mode B uses three discrete Mono dots that cycle every 500ms via a CSS keyframe alternating their `opacity` — no rotation, no transform.
