# Gap Analysis

> Chunk: gap-analysis | Phase: brief | Project: payment-flow | Generated: 2026-05-13
> Updated: 2026-05-13 — scoped to Stellar (2 modes).

## Brand-system tokens — coverage check

No new tokens. Imobiliárias front (light theme) covers everything this surface needs. Spot-check before build:
- `--color-accent-imob` = `#C47E10` (amber CTA)
- `--color-status-paid` = `#2E8B5A`
- `--color-status-error` = `#C94040`
- `--radius-*` = `0` enforced at `@theme` level
- Font triple installed: `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, Geist via `next/font`

## Brand-system components — coverage check

| Brand component | Codebase equivalent | Gap |
|-----------------|---------------------|-----|
| Card (Imobiliárias) | `src/components/ui/card.tsx` | ✓ |
| Primary / outline button | `src/components/ui/button.tsx` | ✓ |
| Badge (square+label via `PaymentStateTag`) | `src/components/payments/payment-state-tag.tsx` | ✓ |
| Mono primitive | `src/components/ui/mono.tsx` | ✓ |
| Page shell trio | `src/components/page/*` | ✓ |
| Sonner | `src/components/ui/sonner.tsx` | ✓ |

## Project-introduced components (do not exist yet)

- `PublicShell`, `PublicHeader`
- `PaymentSummaryHeader`
- `ModeResolver` (server)
- `PaymentAddressPanel` (mode A hero)
- `CopyableValue`, `CopyableAddress`
- `AssetAmount`
- `HorizonPaymentPoller` (client island, Convex live)
- `WalletConnectPanel`, `WalletConnectClient` (mode B, behind flag)
- `PaymentReceiptCard`
- `StellarExplorerLink`
- `PaymentExpiredCard`

All new components live under `src/components/payments/flow/*` except `PublicShell` / `PublicHeader` (`src/components/public/`) and the copy primitives (`src/components/payments/copyable-*.tsx`).

## Backend gaps

| Need | Status | Owner |
|------|--------|-------|
| `payments.useCases.getPublicByPublicId` (no auth, tenant-safe shape) | **new** — explicitly excludes agency-private fields | this project |
| `payments` table — add `muxedId: v.string()` (63-bit unsigned int stored as digit string for BigInt safety) | **schema migration** | this project |
| Env var `STELLAR_MUTAV_SOURCE_ACCOUNT` — the single Mutav treasury `G…` (per network) | **config** in `convex/lib/env.ts` | this project |
| Migration: backfill `muxedId` per existing pending payment via `crypto.getRandomValues` → 63-bit | **one-shot** | this project |
| `stellarIndexState` table — single row holding the latest Horizon paging token for the Mutav treasury (cursor for the polling action) | **schema** | this project |
| `payments.actions.checkMutavTreasuryPayments` (single Node action — uses `@stellar/stellar-sdk` Horizon client to fetch new payments to `STELLAR_MUTAV_SOURCE_ACCOUNT` since the stored cursor, decode muxed IDs, match invoices, transition state to `paid` with `txHash` + `paidAt`) | **new** | this project |
| Cron job — call `checkMutavTreasuryPayments` every 30s (one global cron, not per-agency) | **new** in `convex/crons.ts` | this project |
| `payments.useCases.markPaidByTx` (internal mutation called by the action) | **new** | this project |
| `payments.useCases.cancelPayment` (admin / scheduler — transitions overdue past grace → canceled) | exists or needs adding; verify | check |
| Public route group `(public)` | **new** sibling of `(app)` | this project |
| Magic-link tokenization | **deferred** — v1 uses `payment.publicId` in URL; documented launch blocker; v1 demo uses seed-only fixtures | post-v1 |
| Mode B: Soroban contract integration | **deferred to v1.1** — depends on `mutav-stellar` mainnet readiness | sibling repo |

## Npm package gaps

| Package | Use | Size impact | Phase |
|---------|-----|-------------|-------|
| `@stellar/stellar-sdk` | Server-side muxed-address derivation + Horizon polling. Tree-shake-friendly when imported via deep path; total binary footprint affects Convex deploy size, not client bundle. | ~600 kB on server (no client impact) | v1 |
| `qrcode` (node-qrcode) | Server-rendered SVG QR for the SEP-7 payment URI (`web+stellar:pay?…`). Rendered in an RSC; zero client JS. | ~10 kB (server only) | v1 |
| `@stellar/freighter-api` | Client-side wallet detection + sign for mode B. **Only loaded inside the `WalletConnectClient` island via `dynamic(() => import(…), { ssr: false })`**. | ~20 kB client (mode B only) | v1.1 |

**Not installing** (intentional):
- `@creit.tech/stellar-wallets-kit` — removed previously for security CVEs in Trezor/Hot/NEAR adapters; do not reintroduce.
- `bwip-js` — Boleto barcode rendering, no longer needed for v1.

## i18n gap

New namespace `paymentFlow.*` in **both** `messages/pt-BR.json` and `messages/en.json`. Key groups:

- `paymentFlow.meta` — page titles, descriptions
- `paymentFlow.summary` — agency, amount label, due label, state labels
- `paymentFlow.modes.address.*` — instructions, copy-address, asset-amount, SEP-7 button, poller status
- `paymentFlow.modes.contract.*` — connect-wallet, signing, submitting, confirming (mode B, but ship the strings in v1 so the flag flip is clean)
- `paymentFlow.receipt.*` — confirmation headline, evidence labels, explorer link label
- `paymentFlow.expired.*` — expired/canceled copy
- `paymentFlow.errors.*` — error codes from `getPublicByPublicId`, `checkStellarPayment`, and mode B (e.g. `INVALID_PAYMENT`, `ALREADY_PAID`, `AMOUNT_MISMATCH`, `WALLET_NOT_DETECTED`, `USER_REJECTED`)

Error codes follow the project convention: server returns `{ code: "…" }`; client maps via `t(\`errors.\${code}\`)`. **Forbidden vocabulary** on this surface (from brand voice):
`blockchain`, `onchain`, `smart contract`, `token`, `wallet` (use `carteira`), `protocolo` (technological sense), `liquidação` (use `confirmação` / `pagamento`), `yield`, `DeFi`, exclamation marks, emojis.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| Muxed-id collision across payments | negligible | 63-bit random IDs; collision probability over 2³² invoices is ~10⁻¹⁰. Mutation enforces uniqueness via a `by_muxedId` index on `payments`. |
| Tenant pays the wrong amount (under/over) | medium | Action checks `payment.amount` exactly. Under = ignored, payment stays pending. Over = match + flag for refund (post-v1 process). Mode A landing instructs the exact amount in 0.0000001 XLM precision. |
| Tenant pays to the bare Mutav `G…` instead of the per-payment `M…` | low (wallets paste the full strkey; M… and G… have different prefixes/lengths) | Reconciler ignores payments arriving without a muxed-id (`account_muxed === null`); they're surfaced in an admin queue for manual matching by amount + time. Tenant copy emphasizes "Use o endereço completo" with the M as one inseparable block. |
| Stellar network down / Horizon unreachable | low | Cron retries every 30s; the receipt screen accepts a `txHash` query-string fallback the tenant can paste from their wallet receipt to force a check. |
| URL using `publicId` is enumerable | high if shipped | Documented launch blocker. v1 demo uses seed-only data. v1.1 introduces signed token. |
| `@stellar/freighter-api` adds CVE risk on the client | medium | Gate behind `STELLAR_CONTRACT_MODE` flag. Audit the package on each upgrade. Pin major version. Never load on mode A path. |
| XLM/BRL rate displayed is stale | low at v1 (frozen at invoice issuance) | Display "Taxa: X em DD/MM/YYYY HH:mm" beneath the BRL equivalent. Production version subscribes to a feed. |
