# Design
> Phase: design | Project: payment-flow | Generated: 2026-05-13

Stellar-only payment flow (v1 = Mode A primary; Mode B scaffolded behind `STELLAR_CONTRACT_MODE` env flag for v1.1). Imobiliárias front, light theme, public `(public)` route group.

## Screens

| # | Screen | File | Components Used |
|---|--------|------|-----------------|
| 01 | Landing / Mode Resolver | [screen-01-landing.md](./screen-01-landing.md) | `PublicShell`, `PaymentSummaryHeader`, `ModeResolver`, shadcn `Tabs` (v1.1+ only), `PublicFooterMeta` |
| 02 | Address Mode (Stellar, v1 primary) | [screen-02-address-mode.md](./screen-02-address-mode.md) | `PublicShell`, `PaymentSummaryHeader`, `PaymentAddressPanel`, `PaymentAddressQrCode`, `AssetAmount`, `CopyableAddress`, `CopyableValue`, `HorizonPaymentPoller`, shadcn `Card` / `Button` / `Separator` / `Collapsible` / `Sonner`, `PublicFooterMeta` |
| 03 | Wallet Mode (Soroban, v1.1 scaffolded) | [screen-03-wallet-mode.md](./screen-03-wallet-mode.md) | `PublicShell`, `PaymentSummaryHeader`, `WalletConnectPanel`, `WalletConnectClient` (dynamic-import), `AssetAmount`, `HorizonPaymentPoller`, shadcn `Card` / `Button` / `Collapsible`, `PublicFooterMeta` |
| 04 | Receipt | [screen-04-receipt.md](./screen-04-receipt.md) | `PublicShell`, `PaymentSummaryHeader` (paid variant), `PaymentReceiptCard`, `PaymentStateTag` (existing), `AssetAmount`, `CopyableValue`, `StellarExplorerLink`, shadcn `Card` (with `data-stripe="paid"` 4px `#2E8B5A` top), `Separator`, `Sonner`, `PublicFooterMeta` |
| 05 | Expired / Canceled | [screen-05-expired.md](./screen-05-expired.md) | `PublicShell`, `PaymentSummaryHeader`, `PaymentExpiredCard`, `PaymentStateTag` (extended with `overdue`/`canceled`/`notFound` variants), shadcn `Card` / `Button`, `PublicFooterMeta` |
| 06 | Error Boundary (`error.tsx`) | [screen-06-error.md](./screen-06-error.md) | `PublicShell`, `PaymentErrorBoundary`, `PaymentStateTag` (error variant), shadcn `Card` / `Button`, `PublicFooterMeta` |
| 07 | Not Found (`not-found.tsx`) | [screen-07-not-found.md](./screen-07-not-found.md) | `PublicShell`, `PaymentStateTag` (notFound variant), shadcn `Card`, `PublicFooterMeta` |

## Shared

| Chunk | File | ~Lines |
|-------|------|--------|
| Personas | [shared/personas.md](./shared/personas.md) | ~70 |
| Information Architecture | [shared/information-architecture.md](./shared/information-architecture.md) | ~85 |
| Navigation | [shared/navigation.md](./shared/navigation.md) | ~100 |
| Micro-Interactions | [shared/micro-interactions.md](./shared/micro-interactions.md) | ~95 |
| Responsive | [shared/responsive.md](./shared/responsive.md) | ~115 |
| Component Plan | [shared/component-plan.md](./shared/component-plan.md) | ~115 |

## Design contract — STYLE.md compliance

Every screen above was checked against STYLE.md §4 (Never/Always rules) and §6 (Bold Bets):

| Bold bet | Where it lands in this design |
|---|---|
| #1 Zero-radius enforcement | All cards, buttons, inputs, badges, separators, QR border, copy buttons — verified per-screen |
| #2 Amber as precious metal | Single primary CTA per screen + wordmark + (Mode A only) one live pulse dot. Verified <5% on all 7 screens. |
| #3 Tabular numerals on every number | All amounts, due dates, addresses, ledger numbers, timestamps, phone numbers, error references render through `<Mono>` |
| #4 Three-layer hierarchy on every screen | Verified per-screen — Geist declaration + Inter explanation + Mono evidence present on Screens 01–06. Screen 07 stretches the rule (no payment data) — flagged for critique. |
| #5 Surface stacking without shadows | All cards sit on `--color-canvas` (`#F7F6F3`) with `--color-surface` (`#FFFFFF`) fill + 1px `--color-border` (`#D9D7D2`). Receipt adds a 4px `#2E8B5A` top stripe — the only documented decorative success-green in the flow. |

## Bold-bet skips (with rationale)

None. All five bold bets land in the design.

## Brand-style feedback signals

None during this design pass. If critique surfaces style-level pushback (e.g. "the 4px receipt stripe is too loud"), that's a `gsp-brand-refine` candidate rather than a screen-level fix.
