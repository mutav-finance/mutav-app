# File References

> Chunk: file-references | Phase: brief | Project: payment-flow | Generated: 2026-05-13
> Updated: 2026-05-13 — scoped to Stellar (2 modes).

## Brand system (source of truth)

| File | Role |
|------|------|
| `.design/branding/tga/patterns/tga.yml` | Style preset |
| `.design/branding/tga/patterns/STYLE.md` | Agent contract |
| `.design/branding/tga/patterns/guidelines.html` | Visual reference |

## Existing code reused

### Page primitives
- `src/components/page/page-shell.tsx`
- `src/components/page/page-header.tsx`
- `src/components/page/page-content.tsx`

### shadcn primitives (0px radius variant)
- `src/components/ui/card.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/mono.tsx`
- `src/components/ui/sonner.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/separator.tsx`

### Existing payments surface
- `src/components/payments/payment-state-tag.tsx` (reused for badges)
- `src/components/payments/payment-details-page.tsx` (reference only — not edited in v1)
- `src/components/payments/payment-summary-card.tsx` (reference)
- `src/components/payments/payment-method-card.tsx` (reference)

### Convex (existing)
- `convex/schema.ts` — `payments` table; this project ADDs `payments.muxedId` (+ `by_muxedId` index) and a new `stellarIndexState` table for the Horizon cursor
- `convex/payments/domain.ts` — `PaymentMethods`, `PaymentStates`, constants, validators (reused)
- `convex/payments/useCases.ts` — adds `getPublicByPublicId`, `markPaidByTx` (internal)
- `convex/payments/mutations.ts` — reference for mutation style
- `convex/crons.ts` — adds a single global Horizon polling cron entry
- `convex/lib/env.ts` — adds `STELLAR_NETWORK`, `STELLAR_HORIZON_URL`, `STELLAR_MUTAV_SOURCE_ACCOUNT` getters; `STELLAR_CONTRACT_MODE` feature flag

### Routing & i18n
- `src/app/[locale]/(app)/layout.tsx` (pattern reference for the new `(public)/layout.tsx`)
- `src/app/[locale]/(app)/payments/[id]/page.tsx` (pattern for `preloadQuery` + `notFound()`)
- `src/i18n/navigation.ts` (locale-aware `Link`, `useRouter`)
- `messages/pt-BR.json`, `messages/en.json` — add `paymentFlow.*` namespace

### Utilities
- `src/lib/result.ts` — `Result<TData, TError>` return type for new mutations
- `src/lib/env.ts` — client env (adds `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_STELLAR_EXPLORER_URL`)
- `convex/lib/env.ts` — server env

## Files this project creates

### Routes (`src/app/[locale]/(public)/`)
- `(public)/layout.tsx`
- `(public)/pagar/[publicId]/page.tsx` — landing / mode resolver
- `(public)/pagar/[publicId]/error.tsx`
- `(public)/pagar/[publicId]/loading.tsx`
- `(public)/pagar/[publicId]/not-found.tsx`
- `(public)/pagar/[publicId]/endereco/page.tsx` — mode A
- `(public)/pagar/[publicId]/carteira/page.tsx` — mode B (rendered behind flag)
- `(public)/pagar/[publicId]/recibo/page.tsx`

### Components
- `src/components/public/public-shell.tsx`
- `src/components/public/public-header.tsx`
- `src/components/payments/copyable-value.tsx`
- `src/components/payments/copyable-address.tsx`
- `src/components/payments/flow/payment-summary-header.tsx`
- `src/components/payments/flow/payment-address-panel.tsx`
- `src/components/payments/flow/payment-address-qr-code.tsx`
- `src/components/payments/flow/asset-amount.tsx`
- `src/components/payments/flow/horizon-payment-poller.tsx`
- `src/components/payments/flow/wallet-connect-panel.tsx` (mode B, behind flag)
- `src/components/payments/flow/wallet-connect-client.tsx` (mode B, client-only dynamic import)
- `src/components/payments/flow/payment-receipt-card.tsx`
- `src/components/payments/flow/stellar-explorer-link.tsx`
- `src/components/payments/flow/payment-expired-card.tsx`

### Stellar helpers
- `convex/payments/lib/muxed-address.ts` — pure helper: derive M-address from `(sourceG, muxedId)` and decode the inverse. Uses `@stellar/stellar-sdk` `MuxedAccount`.
- `convex/payments/lib/horizon-client.ts` — thin Horizon HTTP wrapper used by the action.
- `convex/payments/actions.ts` — `"use node"` actions module; exposes `checkStellarPayment` action.
- `src/lib/stellar/sep7.ts` — pure SEP-7 URI builder (client-safe, no SDK deps): `stellar:M…?amount=…&asset_code=XLM`.
- `src/lib/stellar/explorer.ts` — pure URL builder for `stellar.expert` links.

### Hooks
- `src/hooks/use-payment-flow.ts` — view-model hook for the public flow (state-machine resolver across `payment.state × payment.method`)

### i18n
- Extend `messages/pt-BR.json` with `paymentFlow.*`
- Extend `messages/en.json` with `paymentFlow.*`

### Tests (build phase)
- `convex/payments/useCases.test.ts` — extends with public-query + Stellar-flow cases (uses `convex-test`)
- `convex/payments/lib/muxed-address.test.ts` — unit tests for derivation + decode
- `src/lib/stellar/sep7.test.ts` — URI builder tests
- Browser smoke via `webapp-testing` skill once the build server is running

## Related

- `scope.md` — screen list, mode definitions, component inventory, issue framing
- `target-adaptations.md` — token + component adaptation details
- `gap-analysis.md` — what's missing in the codebase relative to this scope
- `../research/stellar-modes.md` — deep research on muxed-address vs contract-mode tradeoffs (added 2026-05-13)
- Brand: `.design/branding/tga/patterns/STYLE.md`
