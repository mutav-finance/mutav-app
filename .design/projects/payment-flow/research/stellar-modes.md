# Stellar Modes — Research Addendum

> Chunk: stellar-modes | Phase: research | Project: payment-flow | Generated: 2026-05-13
> Addendum added after scope was narrowed to Stellar-only with two execution modes (A: payment address / B: connect wallet).

## TL;DR

Two viable Stellar payment patterns, each with very different surface area:

| | **Mode A — Muxed Address** | **Mode B — Connect & Pay (Soroban)** |
|---|---|---|
| What the tenant does | Copies an `M…` address, pastes into any Stellar wallet, sends the exact amount | Clicks "Conectar carteira" → Freighter pops up → signs `pay_invoice` contract call |
| Reconciliation | Backend reads the 64-bit muxed ID from incoming Horizon payments | Indexer reads contract event |
| Spec | **SEP-23** (StrKey for muxed accounts) + classic XLM payment | **Soroban** contract on the `mutav-stellar` deployment |
| Wallets supported | All Stellar wallets (Freighter, Lobstr, Albedo, xBull, hardware via Lobstr/xBull bridge, exchanges that allow withdrawal to memo-less addresses) | Soroban-capable wallets — Freighter (browser ext) is the canonical target; SEP-7 deep-links cover mobile |
| JS dependencies (client) | **None** beyond the SEP-7 URI builder (10 lines of code) | `@stellar/freighter-api` (~20kB, gated behind feature flag) |
| Indexing infra | Horizon polling per agency source account every 30s | Per-contract event subscription |
| Failure modes | Wrong amount (under/over), pay to G… instead of M… (rare — wallets paste full strkey) | User rejects in wallet, transaction fails on contract, contract not deployed |
| Privacy | Address per-payment is unique → no on-chain correlation across invoices for the same payer (more privacy-preserving than a single G with memos) | Contract caller is visible on-chain |
| Trust assumption | Reconciler matches muxed-id correctly | Contract executes correctly + indexer is alive |
| Day-1 readiness | **High** — works on existing Stellar mainnet today | **Lower** — depends on `mutav-stellar` contract maturity |

**Recommendation: ship Mode A as the v1 primary. Scaffold Mode B for v1.1.**

## Recipient model — Mutav as the single source `G…`

**Mutav (the protocol) is the on-chain recipient of every tenant payment.** One treasury `G…` per network — testnet during development, public network in production — configured via env (`STELLAR_MUTAV_SOURCE_ACCOUNT`). Off-chain (in Convex) we know which agency a payment belongs to via `payment.agencyId`; on-chain, that's invisible. The protocol owns settlement.

### Muxing granularity — per-payment vs per-agency

SEP-23 only allows single-level muxing (one 64-bit `id` field per `G…`). So we choose one of:

| Choice | mux-id encodes | reconciliation | privacy | reuse |
|--------|----------------|----------------|---------|-------|
| **Per-payment** | `payment.muxedId` (63-bit random) | O(1): `muxedId → payment` | each invoice is uncorrelated on-chain | none — an old M… credits the already-paid invoice |
| Per-agency | `agency.muxedId` | needs amount+time disambiguation (or memo) — defeats the point of muxing | all invoices for an agency cluster | yes — agency could publish/print the M as a stable "receive" address |

**Decision: per-payment for this surface.** Per-agency stable addresses are a separate v1.1 feature on the agency settings page (a printable "Receba pagamentos aqui" address that bypasses the invoice flow entirely — useful for off-flow deposits / top-ups). They do not appear in the tenant payment portal.

### How it works

Stellar accounts come in two strkey flavors:
- `G…` — classic 32-byte ed25519 public key, 56-char strkey
- `M…` — **muxed**: same underlying account + a 64-bit `id` field, 69-char strkey

A muxed account is *not* a separate on-chain account. It's a way to encode "this payment is for sub-account `id` under the underlying `G…`". The Horizon API surfaces incoming payments with both the destination (the muxed strkey) and the decoded `(account_id, account_muxed_id)` pair. For us, `account_id` will always be `STELLAR_MUTAV_SOURCE_ACCOUNT` and `account_muxed_id` is the lookup key into `payments`.

### Derivation (pure, deterministic)

```ts
// convex/payments/lib/muxed-address.ts
import { MuxedAccount } from "@stellar/stellar-sdk";
import { getMutavSourceAccount } from "../../lib/env";

export function derivePaymentMuxedAddress(muxedId: string): string {
  const sourceG = getMutavSourceAccount();
  return MuxedAccount.fromAccountId(sourceG, muxedId).accountId();
}

export function decodeMuxedId(muxedM: string): string {
  return MuxedAccount.fromAddress(muxedM, "0").id();
}
```

`muxedId` is a 63-bit unsigned integer (high bit stays 0 for headroom). Stored as a digit-string in Convex (`v.string()`) for BigInt safety across the IEEE-754 boundary. `payments` has a `by_muxedId` index for O(1) reverse lookup in the reconciler.

### Generating muxedId per invoice

Two strategies:
1. **Sequential per-agency counter** — simplest, but leaks invoice volume on-chain.
2. **Random 63-bit** — `crypto.getRandomValues(new BigUint64Array(1))[0] & ((1n << 63n) - 1n)`. Collision probability is negligible per source-account (≤2^32 invoices → ~10⁻¹⁰).

**Pick random.** Cost is ~zero; privacy gain is real for the tenant (no inferring how many invoices the agency has issued).

### Address display UX

The 69-char `M…` strkey needs to be displayable on a 360px viewport. Two patterns from research:

- **4 lines × ~17 chars** at `0.875rem` JetBrains Mono with `letter-spacing: 0.02em` fits cleanly inside a 24px-padded card (about 296px usable width).
- **Single line with horizontal scroll** — ugly on mobile, never use.

We pick 4 × ~17. The exact split is 14/14/14/13 to keep the trailing checksum group whole.

### SEP-7 — the same payload, three convenience surfaces

The SEP-7 "payment" intent encodes destination + amount + asset into one URI:

```
web+stellar:pay?destination={M…}&amount=1234.5678&asset_code=XLM
```

(Optional params: `memo`, `memo_type`, `msg`, `network_passphrase`, `origin_domain`, `signature`. We use none — the muxed destination IS the disambiguator and we have no need to sign the URI for v1.)

Mode A renders this URI in **three places**, all carrying the same payload, picking up whichever the tenant's situation allows:

1. **QR code (top of panel)** — server-rendered SVG via `qrcode` library. Tenant points their mobile wallet camera; the wallet decodes, pre-fills destination + amount + asset, and surfaces a confirm screen. **Zero typing.** Sized 240px on mobile, 256px on ≥md. Monochrome `#1A1A1A` on `#FFFFFF`, no border-radius, 1px `#D9D7D2` border, no decorative quiet-zone art. Carries `<title>` + `<desc>` for screen readers.

2. **`Abrir em carteira` button (middle of panel)** — same URI as `href`. On desktop with Freighter/Lobstr desktop installed, the browser triggers the OS protocol handler and the wallet opens with fields pre-filled. On mobile in-browser, the wallet app handles the intent. Failure mode is silent: nothing happens; the tenant falls through to copy-paste.

3. **Bare M… address with copy button (bottom of panel)** — for tenants paying from an exchange or an old wallet that doesn't speak SEP-7. They paste the address; they enter the amount manually. The tenant-facing copy emphasizes the exact amount with a copy button on the asset-amount block too.

**XLM only for v1.** Native XLM payments need no `asset_issuer`. USDC payments require `asset_issuer={G_OF_USDC_ISSUER}` and the receiving wallet must trust the asset — that's a v1.1 enable.

**Wallet compatibility (verified per the SEP-7 ecosystem doc, 2025-2026):**
- Lobstr (mobile + desktop): full SEP-7 pay support, QR + protocol handler
- Freighter (desktop ext): SEP-7 pay support
- xBull, Stellar Wallet: SEP-7 supported
- Albedo: SEP-7 supported via deep-link
- Hardware (Ledger via Lobstr): SEP-7 supported through the Lobstr bridge
- Some legacy exchange wallets: no SEP-7; tenants use the copy-paste fallback

### URI builder

A pure ~20-line helper, no SDK dependency:

```ts
// src/lib/stellar/sep7.ts
export function buildSep7PayUri(args: {
  destination: string;           // M… strkey
  amount: string;                // "1234.5678" — already canonical XLM
  assetCode?: string;            // default "XLM"
}): string {
  const params = new URLSearchParams({
    destination: args.destination,
    amount: args.amount,
    asset_code: args.assetCode ?? "XLM",
  });
  return `web+stellar:pay?${params.toString()}`;
}
```

Used identically by the QR renderer (RSC, server) and the `Abrir em carteira` button (RSC, server-rendered href). No client JS for either.

### Confirmation polling

Single global Convex action `payments.actions.checkMutavTreasuryPayments` runs on cron (`*/30 * * * * *` — every 30s). Not per-agency — there's only one treasury account to watch.

1. Fetch `GET https://horizon.{network}.stellar.org/accounts/{MUTAV_G}/payments?order=asc&cursor={lastCursor}&limit=200` (testnet or pubnet via env)
2. Filter to records where `transaction.successful === true` and `account_muxed` is present (i.e. destination was an `M…`, not the bare `G…`)
3. For each, decode the muxed-id and look up the matching `payments` row via the `by_muxedId` index
4. Verify amount matches exactly (`payment.amountStroops === incoming.amount`)
5. Transition state via internal mutation `markPaidByTx(paymentId, txHash, paidAt)` — idempotent on `(paymentId, txHash)`
6. Update `stellarIndexState.cursor` to the latest paging token
7. Convex's reactive subscription pushes the change to all connected clients → `HorizonPaymentPoller` sees `state.kind === "paid"` → redirects to `/recibo`

**No client-side polling.** No `setInterval`. The client subscribes to the Convex query and waits.

**Cursor handling:** the `stellarIndexState` table holds one row with the latest seen Horizon paging token. Next run resumes from the cursor; no duplicate processing, no missed payments across restarts.

**Bare-G fallback:** payments arriving at the Mutav `G…` *without* a muxed destination (`account_muxed === null`) are recorded in an `unmatchedDeposits` queue for manual reconciliation by ops. v1 ships the table; the admin UI is post-v1.

### Edge cases (handled in v1)

| Case | Behavior |
|------|----------|
| Tenant overpays (sends more than amount) | Match → mark paid → emit a `paidWithSurplus` flag. Imobiliária reconciles refund off-app. |
| Tenant underpays | No match → payment stays pending. Mode A copy instructs the exact decimal; the wallet's "send" screen shows the same. |
| Tenant pays from an exchange that strips the muxed-id (some old exchanges) | Payment lands on the G-account without muxed-id → caught by the action and surfaced in an admin queue. v1: agency reconciles manually. |
| Tenant pays twice | Second payment matches and would re-mark paid; the mutation is idempotent on `(paymentId, txHash)`. Second tx is recorded as `surplusTxHash` for refund. |
| Stellar network outage | Action retries on next cron tick; no client-facing impact. |
| Horizon rate limit | Action uses one request per agency per 30s; well within the 200-req/min anonymous limit. |

## Mode B — Connect & Pay (Soroban)

### Architecture sketch

```
Tenant browser
  → WalletConnectPanel (UI)
  → WalletConnectClient (dynamic-import island; ssr: false)
  → @stellar/freighter-api  →  Freighter ext  →  signs tx
  → builds txEnvelope (Operation.invokeHostFunction → Contract.call)
  → submits via Horizon /transactions  (or rpc.stellar.org for Soroban)

mutav-stellar contract emits event ContractEvent("paid", { invoiceId, payer, amount })
  ↓
Indexer (Convex action subscribed to Soroban events or polling rpc.getEvents)
  ↓
markPaidByTx(paymentId, txHash, paidAt)
```

### Why it's harder than Mode A

- **Wallet kit risk.** The previous `@creit.tech/stellar-wallets-kit` was removed for CVEs. `@stellar/freighter-api` is narrower and maintained by SDF, but is browser-extension-only. Mobile Soroban wallets remain immature.
- **Contract dependency.** The `mutav-stellar` contract must be deployed to testnet/mainnet and version-pinned. Schema changes to the contract require coordinated rollouts.
- **Soroban event indexing.** Soroban events come via `rpc.stellar.org`'s `getEvents` JSON-RPC, not Horizon. Different polling client.
- **Failure modes are tenant-visible.** User-rejects, insufficient fees, contract aborts, sequence-number mismatches, network congestion. Each needs a localized error string and a UI state.

### What Mode B gives you that Mode A doesn't

- **Atomicity.** The contract can attach business rules (e.g. accept only the exact amount, fail otherwise) so over/underpay never reaches the reconciler.
- **On-chain receipt.** Contract event is the receipt; no off-chain matching step.
- **Composability.** Future contracts (refunds, partial payments, escrow) plug into the same call surface.

### Decision

Scaffold the UI shell + the route + the i18n strings now (so flipping the flag later is trivial), but **do not install `@stellar/freighter-api` or write the signing code in v1**. The flag `STELLAR_CONTRACT_MODE` defaults to `false`; turning it on in v1.1 unlocks the wiring.

## Sources

- SEP-23 (Muxed account strkey encoding) — `https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md`
- SEP-7 (Stellar URI scheme) — `https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md`
- Horizon payments API — `https://developers.stellar.org/api/horizon/resources/list-payments`
- `@stellar/stellar-sdk` `MuxedAccount` — `https://stellar.github.io/js-stellar-sdk/MuxedAccount.html`
- Soroban Events RPC — `https://developers.stellar.org/docs/data/rpc/api-reference/methods/getEvents`
- Freighter API — `https://github.com/stellar/freighter/tree/main/packages/freighter-api`
- Previous CVE context — `mutav-finance/sgr-app` CLAUDE.md (stellar-wallets-kit removal note)

## Related

- `../brief/scope.md` — narrowed scope, modes A/B definition
- `../brief/target-adaptations.md` — component-level mapping for both modes
- `./reference-specs.md` — broader spec inventory; this file deepens the Stellar slice
- `./recommendations.md` — adopt/adapt/avoid synthesis (read alongside this addendum)
