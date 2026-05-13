# Scope

> Chunk: scope | Phase: brief | Project: payment-flow | Generated: 2026-05-13
> Updated: 2026-05-13 — narrowed from "3 methods" to **Stellar-only with 2 modes**.

## Decision: Stellar-only for v1, two execution modes

**Recipient is Mutav (the protocol), not the agency.** One canonical source `G…` account — `MUTAV_TREASURY_G_ACCOUNT` (env-configured). Per-payment muxed-id derivation; no per-agency muxing on this surface (a stable per-agency M address is a v1.1 agency-settings feature).

PIX and Boleto are deferred. The build phase delivers **one method (Stellar)** in two presentation modes:

| Mode | What the tenant sees | Reconciliation | Wallet required? | Status |
|------|----------------------|----------------|-------------------|--------|
| **A — Payment Address (muxed)** | A unique `M…` address per invoice, derived from the Mutav treasury `G…`. Tenant copies, opens any Stellar wallet, sends the exact amount. | Backend polls the Mutav treasury account on Horizon, reads the 64-bit muxed ID from incoming payments, matches to invoice. | Any (tenant's choice — Freighter, Lobstr, Albedo, exchange, hardware). | **v1 primary** |
| **B — Connect & Pay (contract)** | "Conectar carteira" CTA → wallet signs a Soroban `pay_invoice(invoiceId)` call on the `mutav-stellar` contract. | Indexer watches contract events. Deterministic. | Freighter (browser) or SEP-7 deep-link (mobile). | **v1.1** — feature-flagged behind `STELLAR_CONTRACT_MODE` |

**Rationale for A first:** muxed accounts (SEP-23) ship today against existing Horizon infrastructure, work with every wallet, and need zero JS wallet kit (the prior `@creit.tech/stellar-wallets-kit` was removed for security CVEs). Mode B depends on the Soroban contract from sibling repo `mutav-stellar` reaching mainnet readiness.

**Muxing granularity — per-payment, not per-agency.** Each invoice gets its own random 63-bit `muxedId`. The agency association is metadata on the payment row (`payment.agencyId`), not encoded in the address. Tradeoff documented in `../research/stellar-modes.md` — per-payment wins on reconciliation simplicity (O(1) muxed-id → invoice lookup) and tenant privacy (no on-chain clustering of an agency's invoices). Per-agency stable addresses are reserved for the agency-side treasury feature (v1.1).

## Screen list (v1)

| # | Screen | Route (proposed) | Mode | Priority | Purpose |
|---|--------|------------------|------|----------|---------|
| 1 | **Landing / mode resolver** | `/[locale]/pagar/[publicId]` | both | P0 | Tenant lands from magic link. Agency + amount + due date + state badge. If agency offers both modes: a small mode toggle. If only one is configured: routes straight to it. |
| 2 | **Address-mode execution** | `…/pagar/[publicId]/endereco` | A | P0 | **SEP-7 QR (amount-encoded)** + bare M… address (copy-paste fallback) + **`Abrir em carteira`** SEP-7 deep-link + asset/BRL amount block + ambient `HorizonPaymentPoller`. Three convenience tiers: scan / deep-link / paste — same payload. |
| 3 | **Wallet-connect execution** | `…/pagar/[publicId]/carteira` | B | P1 | "Conectar carteira" → Freighter signs contract call → progress states (signing / submitting / confirming) → success. |
| 4 | **Receipt** | `…/pagar/[publicId]/recibo` | both | P0 | Paid badge + transaction evidence (`txHash` linked to `stellar.expert`, `paidAt`, ledger #, amount) + agency contact. |
| 5 | **Expired / canceled** | reached when `state ∈ { overdue, canceled }` | both | P1 | Square+label badge, copy explaining state, contact CTA. |

**Optional, post-v1:**
- Per-agency settings — choose default mode, configure source G-account, configure Soroban contract address
- Per-payment override — allow imobiliária to force mode A or B per invoice
- Tenant-side QR for the M… address (mobile wallet scanning)

## Component scope

### Reuse (existing — unchanged)
- `Card`, `Button`, `Badge`, `Mono`, `Sonner`, `Skeleton` (shadcn)
- `PaymentStateTag` (`src/components/payments/payment-state-tag.tsx`) — used on receipt + expired
- `PageShell`, `PageContent` — wrapped by `PublicShell`

### New (built in this project)
| Component | Mode | Purpose |
|-----------|------|---------|
| `PublicShell` | both | Public route group shell. TGA mark + agency name. No sidebar. Forces light theme. |
| `PaymentSummaryHeader` | both | Three-layer hierarchy: agency name (Inter) · amount (Geist Bold) · due date (Mono). Repeated across screens. |
| `ModeResolver` | both | Server component that decides which mode screen to render (or which mode toggle to show) based on agency config + payment state. |
| `PaymentAddressPanel` | A | The hero of mode A. Shows the M… address in a 4-line copy-friendly Mono block, amount in asset, "Abrir em carteira" SEP-7 button, and a status row. |
| `CopyableAddress` | A | Specialized `CopyableValue` that breaks the 56-char strkey at fixed positions (4×14) and surfaces a per-line copy convenience. |
| `AssetAmount` | both | `<Mono>` with the asset symbol (XLM / USDC) suffix and BRL equivalent line beneath. Tabular nums, no jitter. |
| `HorizonPaymentPoller` | A | Client island that calls a Convex query every 6s while `state === "pending"`, redirects to `/recibo` on `paid`. Uses Convex live subscription, not a manual interval. |
| `WalletConnectPanel` | B | Mode B hero. "Conectar carteira" CTA. Progress states: idle / signing / submitting / confirming / done. Errors mapped to localized strings. |
| `WalletConnectClient` | B | Client-only wrapper around the wallet integration (Freighter via `@stellar/freighter-api` direct — no kit). Isolated to one file so the security surface is auditable. |
| `PaymentReceiptCard` | both | Paid state badge + evidence (txHash linked to `stellar.expert`, paidAt, ledger #) + agency contact. Top-edge `#2E8B5A` 4px status stripe. |
| `StellarExplorerLink` | both | `<a>` to `https://stellar.expert/explorer/{network}/tx/{txHash}` — opens in new tab, `rel="noopener"`, never amber-colored. |
| `PaymentExpiredCard` | both | Expired/canceled state — square+label badge + copy + contact CTA. |

## Project boundaries

**In (v1):**
- Mode A end-to-end: muxed-address derivation, M-address display + copy, SEP-7 "open in wallet" link, Horizon polling for confirmation, receipt screen.
- Public route group `(public)` and its shell.
- Convex extensions: `payments.useCases.getPublicByPublicId` (public query) and a Horizon-polling Convex action `payments.actions.checkStellarPayment` that fetches recent payments to the source G-account, filters by muxed-id, and transitions state.
- Per-agency source G-account stored in `agencies` table (small schema addition).
- New i18n namespace `paymentFlow.*`.

**Out (deferred or out of scope):**
- PIX and Boleto execution. Already designed in research — punted to a later issue.
- Mode B (Soroban contract) — UI scaffolding ships behind `STELLAR_CONTRACT_MODE` flag, but no live wallet integration in v1.
- Real wallet kit. No SDK on the client beyond `@stellar/freighter-api` (and only for mode B).
- USDC. v1 ships **XLM only** — USDC enablement is a schema/UI flag turn.
- Refunds, partial payments, batched invoices.
- Agency-side configuration UI (mode default, source account). Configured in seed for v1.
- Real magic-link tokens. v1 uses `payment.publicId` directly in the URL; signed-token rotation is a separate issue (security-blocking for production launch).

## Success criteria

| # | Criterion |
|---|-----------|
| S1 | Tenant clicks magic link → sees agency + amount + M… address (mode A) within ≤2s on 3G fast |
| S2 | The M… address is **deterministically derived** from `MUTAV_TREASURY_G_ACCOUNT` + `payment.muxedId` (no DB lookup needed for verification) |
| S3 | Address copies correctly to clipboard from one tap (iOS Safari and Android Chrome verified); `aria-live` confirms |
| S4 | Horizon poller transitions a pending payment to paid within ≤30s of the on-chain confirmation; UI auto-routes to `/recibo` via Convex subscription |
| S5 | Receipt links `txHash` to `stellar.expert` testnet/public network based on env |
| S6 | All numeric values render via `Mono` (`tabular-nums`); no raw `font-mono` Tailwind elsewhere |
| S7 | Status anywhere uses the square+label pattern (`PaymentStateTag`) — never color alone |
| S8 | No `rounded-*`, no `as Type`, no `any` in new files |
| S9 | i18n parity en/pt-BR; mode A copy avoids the forbidden vocabulary list (`blockchain`, `onchain`, `smart contract`, `token`, `protocolo`, `liquidação`) |
| S10 | Mode A works without any client-side wallet JS — the address + SEP-7 deep-link are enough |

## Dependencies

| Dependency | Where it touches | Status |
|------------|------------------|--------|
| Convex `payments` table | exists | ✓ |
| `payments` table — add `muxedId: v.string()` (63-bit unsigned int as digit string, BigInt-safe) | new field per payment | small migration |
| Env var `STELLAR_MUTAV_SOURCE_ACCOUNT` (and `STELLAR_NETWORK`, `STELLAR_HORIZON_URL`) | server config in `convex/lib/env.ts` | new |
| Stellar Horizon HTTP API (`/accounts/{MUTAV_G}/payments`) | one global polling action, not per-agency | new |
| `@stellar/stellar-sdk` (server) | muxed-address derivation, Horizon polling | new install |
| `@stellar/freighter-api` (client, mode B only) | wallet detection, sign-tx | new install (mode B only — gated) |
| SEP-7 URI builder | tiny pure helper (`stellar:M…?amount=…`) — built in-repo | new |

## Issue framing

Suggested bounded issues, each ~1 PR:

1. **`feat(payments): public payment portal scaffold (Stellar address mode)`** — `(public)` route group, `PublicShell`, `getPublicByPublicId` query, `PaymentSummaryHeader`, landing → `endereco` resolver. Adds `payments.muxedId` + env wiring for `STELLAR_MUTAV_SOURCE_ACCOUNT`.
2. **`feat(payments): Stellar muxed-address panel`** — `PaymentAddressPanel`, `CopyableAddress`, SEP-7 deep-link builder, `AssetAmount`.
3. **`feat(payments): Horizon polling action + Convex subscription`** — single global `payments.actions.checkMutavTreasuryPayments` action; cron entry; live state transition `pending → paid`; `HorizonPaymentPoller` auto-redirect to receipt.
4. **`feat(payments): receipt + expired screens`** — `PaymentReceiptCard`, `StellarExplorerLink`, `PaymentExpiredCard`.
5. **`feat(i18n): paymentFlow namespace (pt-BR + en) — Stellar copy`** — strings only, parity audit.
6. **`feat(payments): mode B scaffolding (feature-flagged)`** — `WalletConnectPanel` + `WalletConnectClient` (Freighter direct); gated behind `STELLAR_CONTRACT_MODE`. Soroban contract call wiring lands in a separate `mutav-stellar` PR.

Issues 1–5 are the v1 deliverable. Issue 6 is the v1.1 follow-up.
