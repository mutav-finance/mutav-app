# Codebase Manifest
> Project: payment-flow | Generated: 2026-05-13

## Components

| Component | Codebase File | Action |
|-----------|---------------|--------|
| PublicShell | `src/components/public/public-shell.tsx` | added |
| PublicHeader | `src/components/public/public-header.tsx` | added |
| PublicFooter | `src/components/public/public-footer.tsx` | added |
| CopyableValue | `src/components/payments/copyable-value.tsx` | added |
| CopyableAddress | `src/components/payments/copyable-address.tsx` | added |
| PaymentSummaryHeader | `src/components/payments/flow/payment-summary-header.tsx` | added |
| AssetAmount | `src/components/payments/flow/asset-amount.tsx` | added |
| PaymentAddressQrCode | `src/components/payments/flow/payment-address-qr-code.tsx` | added |
| HorizonPaymentPoller | `src/components/payments/flow/horizon-payment-poller.tsx` | added |
| PaymentAddressPanel | `src/components/payments/flow/payment-address-panel.tsx` | added |

## Patterns established

| Pattern | Where |
|---------|-------|
| Public route group `(public)` parallel to `(app)` | `src/app/[locale]/(public)/` |
| Server-rendered SVG QR (zero client JS) | `payment-address-qr-code.tsx` |
| Whole-block copy primitive (mobile-density-aware) | `copyable-address.tsx` |
| SEP-23 muxed-address derivation (per-payment) | `convex/payments/lib/muxed-address.ts` |
| SEP-7 URI builder (universal across QR + deep-link + address) | `src/lib/stellar/sep7.ts` |
| Tenant-safe Convex query (no `ctx.auth`) | `getPublicByPublicId` in `convex/payments/useCases.ts` |
| `i18n` namespace `paymentFlow.*` (pt-BR canonical + en parity) | `messages/{pt-BR,en}.json` |

## Files touched

### Backend (Convex)
- `convex/schema.ts`
- `convex/lib/env.ts` (new)
- `convex/payments/lib/muxedAddress.ts` (new)
- `convex/payments/useCases.ts`
- `convex/payments/mutations.ts`
- `convex/seed.ts`

### Frontend (src/)
- `src/lib/stellar/sep7.ts` (new)
- `src/lib/stellar/explorer.ts` (new)
- `src/lib/stellar/asset-format.ts` (new)
- `src/components/public/public-shell.tsx` (new)
- `src/components/public/public-header.tsx` (new)
- `src/components/public/public-footer.tsx` (new)
- `src/components/payments/copyable-value.tsx` (new)
- `src/components/payments/copyable-address.tsx` (new)
- `src/components/payments/flow/payment-summary-header.tsx` (new)
- `src/components/payments/flow/asset-amount.tsx` (new)
- `src/components/payments/flow/payment-address-qr-code.tsx` (new)
- `src/components/payments/flow/horizon-payment-poller.tsx` (new)
- `src/components/payments/flow/payment-address-panel.tsx` (new)
- `src/app/[locale]/(public)/layout.tsx` (new)
- `src/app/[locale]/(public)/pagar/[publicId]/page.tsx` (new)
- `src/app/[locale]/(public)/pagar/[publicId]/endereco/page.tsx` (new)

### i18n
- `messages/pt-BR.json`
- `messages/en.json`

### Deps
- `package.json` (+ `bun.lockb`)
