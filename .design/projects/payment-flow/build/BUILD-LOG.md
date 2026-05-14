# Build Log
> Phase: build | Project: payment-flow | Generated: 2026-05-13

## Implementation Summary

The agency-facing public payment page, end-to-end. Reached from `/payments/[id]` via the `Pagar com Stellar` CTA, which opens `/pagar/[publicId]/endereco` in a new tab. The page shows the invoice summary, a tabbed payment panel with one tab per supported asset (XLM, USDC), and the per-payment muxed M-address.

Key architectural choices delivered:

- **Mutav (the protocol) is the on-chain recipient**, not the agency — one treasury G-account per network, env-configured (`STELLAR_MUTAV_SOURCE_ACCOUNT`).
- **Per-payment SEP-23 muxed addresses** — each invoice gets a random 63-bit `muxedId` stored on `payments.muxedId`; the `M…` destination derives from `(treasuryG, muxedId)` at read time. No address reuse, no memo collisions.
- **Chain-aware asset registry** — `src/lib/stellar/{network,assets}.ts` resolves the issuer per asset per network (testnet vs mainnet). The discriminated `AssetAddress` union is ready for EVM / Solana entries without touching consumers. Doc in `src/lib/stellar/README.md`.
- **Live BRL price feed** via CoinGecko, cached 30s through Next's `fetch` cache; static `brlPerUnit` in the registry serves as fallback when the feed errors.
- **No client wallet kit** — the demo flow ships QR (server-rendered SVG) + copyable M-address. The previously-considered `Abrir em carteira` SEP-7 deep-link was dropped because it silently fails when no Stellar wallet is installed.
- **`<ThemeProvider>` and `<Toaster />` relocated** out of the root layout and into `(app)/layout.tsx`. Public payment routes ship free of `next-themes` and its React-19 dev-warning-emitting FOUC script. Also fixed a project-wide latent bug — `<Toaster />` had never been mounted, so all `toast()` calls were silently dropped.

Visual contract honored: TGA Precision Brutalism on the dashboard side, **Mutav** wordmark on the public side, 0px radius, three-layer typography, no shadows, semantic tokens throughout, all numerics through `<Mono>` with `tabular-nums`.

## Files created (28)

### Backend (Convex)
| File | Purpose |
|------|---------|
| `convex/lib/env.ts` | `getMutavSourceAccount()` with documented dev-fallback strkey |
| `convex/payments/lib/muxedId.ts` | Pure 63-bit random id mint (no `@stellar/stellar-base` dependency — keeps the SDK out of seed.ts / mutations.ts module graphs) |
| `convex/payments/lib/muxedAddress.ts` | SEP-23 muxed-address derivation via `@stellar/stellar-base`, with module-scoped `Account` cache |

### Frontend — Stellar lib
| File | Purpose |
|------|---------|
| `src/lib/stellar/network.ts` | `ChainNetwork` type + env-driven `getStellarNetwork()` |
| `src/lib/stellar/assets.ts` | Chain-aware `ASSETS` registry, `resolveAsset()`, `getActiveAssets()` |
| `src/lib/stellar/asset-format.ts` | `brlCentsToAsset(cents, resolvedAsset, locale)` — locale-aware amount formatting per asset's `displayDecimals` |
| `src/lib/stellar/sep7.ts` | Pure SEP-7 `web+stellar:pay` URI builder, accepts `assetIssuer` for non-native assets |
| `src/lib/stellar/price-feed.ts` | Server-side CoinGecko fetcher with Next 30s cache; returns `BrlRates` |
| `src/lib/stellar/README.md` | Developer reference — adding tokens, adding chains, verifying issuers, price-feed roadmap |

### Frontend — components
| File | Purpose |
|------|---------|
| `src/hooks/use-copy-to-clipboard.ts` | Shared sync clipboard hook (iOS Safari transient activation, unmount-safe timer cleanup) |
| `src/components/public/public-shell.tsx` | Scrollable column shell inside the viewport-locked body |
| `src/components/public/public-header.tsx` | `mutav` wordmark + invoice public id (right-aligned) |
| `src/components/public/public-footer.tsx` | Slim Mutav brand line |
| `src/components/payments/copyable-value.tsx` | Mono value + copy button + toast (uses the hook) |
| `src/components/payments/copyable-address.tsx` | 4×14-char Stellar address block; whole block is the keyboard tap target |
| `src/components/payments/flow/payment-summary-header.tsx` | Three-layer hierarchy: state badge + agency name · "Pagar com Stellar" h1 + subtitle · amount + due date |
| `src/components/payments/flow/asset-amount.tsx` | `123.45 USDC` + `≈ R$ 617,25` two-line Mono block |
| `src/components/payments/flow/payment-address-qr-code.tsx` | RSC-rendered SVG QR for the SEP-7 URI; injects `<title>`/`<desc>` for SR |
| `src/components/payments/flow/horizon-payment-poller.tsx` | Ambient `tga-live-square` pulse + "Aguardando pagamento na rede" label (visual v1) |
| `src/components/payments/flow/payment-address-panel.tsx` | Composed panel: card label + shadcn `<Tabs>` (one per asset) + QR + AssetAmount + disclosure + CopyableAddress + poller |

### Routes
| File | Purpose |
|------|---------|
| `src/app/[locale]/(public)/layout.tsx` | Public route group layout: `PublicShell` + skip link + Toaster |
| `src/app/[locale]/(public)/pagar/[publicId]/page.tsx` | Landing → redirects to `/endereco` |
| `src/app/[locale]/(public)/pagar/[publicId]/endereco/page.tsx` | RSC: parallel `fetchQuery` + `getBrlRates`, builds tab options, renders the panel |

### Docs
| File | Purpose |
|------|---------|
| `.design/projects/payment-flow/build/SCAFFOLD-LOG.md` | Stack + commands + verifications |
| `.design/projects/payment-flow/build/BUILD-LOG.md` | This file |
| `.design/projects/payment-flow/build/INDEX.md` | Build chunk index |
| `.design/projects/payment-flow/codebase/MANIFEST.md` | Component + pattern + files-touched manifest |

## Files modified

| File | Changes |
|------|---------|
| `convex/schema.ts` | Added `payments.muxedId: v.optional(v.string())` + `by_muxedId` index |
| `convex/payments/domain.ts` | Added `isChargeable(state)` predicate |
| `convex/payments/useCases.ts` | New `getPublicByPublicId` query (tenant-safe shape with derived `muxedAddress`); `getNextPendingPayment` switched to `isChargeable` |
| `convex/payments/mutations.ts` | `generateMonthlyPayments` writes `muxedId`; `setPaymentMethod` uses `isChargeable`; `markOverduePayments` uses `PAYMENT_STATE_KIND.PENDING` constant |
| `convex/seed.ts` | All 18 historical payment inserts + 3 new May-2026 pending inserts now carry `muxedId` |
| `messages/{pt-BR,en}.json` | New `paymentFlow.*` namespace + `paymentDetails.methodCard` additions (`generateStellar`, `openPayPage`, `copyShareLink`, `linkCopied`) |
| `src/app/[locale]/(app)/layout.tsx` | `<ThemeProvider>` moved here from root; `<Toaster />` mounted |
| `src/providers/index.tsx` | `<ThemeProvider>` removed (moved to `(app)/layout.tsx`) |
| `src/components/payments/payment-method-card.tsx` | Converted to client component; added `Pagar com Stellar` + `Copiar link` actions for pending/overdue payments via `ChargeableActions` sub-component; routes via locale-aware `getPathname` |

## Dependencies added

| Package | Version | Surface |
|---------|---------|---------|
| `@stellar/stellar-base` | 15.0.0 | Convex (server) — SEP-23 muxed-address derivation |
| `qrcode` | 1.5.4 | Next RSC — server-rendered SVG QR for SEP-7 URI |
| `@types/qrcode` | 1.5.6 | dev — types |

## Verified live addresses

| Asset | Network | Issuer / native | Trustlines (Stellar Expert) |
|---|---|---|---|
| XLM | mainnet | native | — |
| XLM | testnet | native | — |
| USDC | mainnet | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | 2,181,403 (Circle, ~$150M weekly volume) |
| USDC | testnet | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | 18,474 (Circle) |

Assets investigated and not adopted: BRL (no liquidity), BRZ (Transfero, dormant), TESOURO (Etherfuse, small footprint), BRLA (doesn't exist on Stellar). See `src/lib/stellar/README.md` for the full research note.

## Resolved in this PR (beyond original scope)

| Item | Notes |
|---|---|
| Horizon polling action + cron | `convex/payments/actions.ts → checkMutavTreasuryPayments`, 30s cron, cursor persisted in `stellarIndexState` |
| Idempotent `markPaidByTx` mutation | No-op on `(paymentId, txHash)` replay; flags duplicate inbounds |
| Convex live subscription on public page | `PaymentAddressView` (client) + live-reactive `PaymentSummaryHeader` via `usePreloadedQuery` |
| Inline receipt view on `/endereco` | `PaymentAddressPaidReceipt` swaps in when state flips to paid; green stripe, txHash link to stellar.expert |
| Live BRL price feed | CoinGecko via Next 30s `fetch` cache; per-asset rate; static `brlPerUnit` fallback |
| Dev-only payment reset mutation | `resetPaymentToPending(publicId)` — clears state + method without rewinding Horizon cursor |
| Testnet wallet provisioned | `GD7ZCGE3…MNWV`, USDC trustline established; documented in `src/lib/stellar/testnet-wallet.md` |
| Three sized test invoices | `PAY-TEST-001/010/100` in seed for friendbot-funded E2E sends |

## Known Gaps (still deferred)

| # | Gap | Severity | Notes |
|---|---|---|---|
| 1 | Amount / asset / state verification in `markPaidByTx` | high | Current reconciler matches by muxedId only — underpaid, overpaid, wrong-asset, or paid-into-cancelled states all silently mark paid. Surface check + `unmatchedDeposits` queue needed before any real value moves. |
| 2 | Magic-link token rotation | high (security) | URL is `publicId`-keyed and enumerable — launch-blocker for production |
| 3 | Standalone `/recibo` receipt route | medium | Inline receipt on `/endereco` covers the demo; dedicated route for sharing/printing not yet built |
| 4 | Expired/canceled screen | medium | Designed but not built; `state ∈ {overdue past grace, canceled}` currently falls through to `notFound()` |
| 5 | Custom error boundary | medium | Designed but not built; uses Next's default `error.tsx` |
| 6 | Mode B — Soroban Connect & Pay | medium | Behind `STELLAR_CONTRACT_MODE` flag; mutav-stellar contract not yet shipped |
| 7 | Rate snapshot at invoice issuance | medium | Currently re-fetched per render; production wants a locked snapshot + "refresh quote" mutation |
| 8 | Live BRL stablecoin support | medium | No liquid Stellar BRL issuer today (BRL/BRZ/BRLA/TESOURO all researched, none viable). Revisit when an anchor lands |
| 9 | Reflector oracle integration | low | For when Mode B ships, so server + on-chain read the same price feed |
| 10 | Unit + integration tests | high | No test infrastructure in repo today; see PR test plan for what should be tested first |
| 11 | `next-themes` script warning on `(app)` routes | low (upstream) | Open issues #385/#387; dev-only; not present on public routes (scoped to `(app)/layout.tsx` already) |
