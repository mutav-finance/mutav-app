# Investor Portal — Architecture

> The investor portal is the surface where capital providers subscribe to `Mutav-Fund` (the offshore fund — see [`entities.md`](entities.md)): deposit stablecoins (USDC / USDT) and mint one of three tranche tokens (`MTVH` / `MTVM` / `MTVL` — see [`tranches.md`](tranches.md)), redeem through a KYC-gated per-tranche queue, view portfolio and protocol-level state. The investor's legal counterparty is **`Mutav-Fund`** (not "Mutav" generically); the Subscription Agreement is with `Mutav-Fund`. **Funds are per-chain** — a Stellar fund needs a Stellar wallet; a Solana fund (future) needs a Solana wallet. Each (chain, wallet) pair is a distinct investor account; cross-chain identity unification is explicitly not in scope. The portal is **non-custodial by design** — Convex never holds or signs for user funds. This document is the target architecture; the existing portal ships as a UI mockup with hardcoded data.

## Scope

This document covers the **target architecture** for when investor work resumes. It is not a feature spec — sub-features (wallet connection, deposit flow, redeem with KYC, etc.) become individual specs at implementation time.

In scope:

- Per-chain wallet-as-identity model
- Wallet kit architecture (Stellar Wallets Kit for v1, adapter discipline, future-chain pattern)
- Stub-first onchain data pattern with `chain` discriminant
- Non-custodial write path (Convex never signs)
- KYC boundary placement (level-based gating via the compliance domain)
- Trust model

Out of scope:

- Specific KYC vendor (see [`regulatory.md`](regulatory.md) for selection criteria; specific vendor is operational)
- B2B / institutional rails (deferred entirely per scope decision; revisit if a named institutional partner asks)
- Onchain contract design — lives in `mutav-stellar` (and per-chain equivalents in the future)
- Cross-chain identity unification — explicitly out of scope per the per-chain account model

## Current state

The investor portal exists as a UI shell at `(investor)/investor/*`:

```
src/app/[locale]/(investor)/investor/
├── page.tsx              ← dashboard (3 fund cards + portfolio + KPI strip)
├── deposit/page.tsx      ← deposit flow UI
├── redeem/page.tsx       ← redeem flow UI
└── transparency/page.tsx ← protocol transparency
```

All data flows from [`src/components/investor/fund-data.ts`](../../src/components/investor/fund-data.ts) — a hardcoded `FUNDS` array and `PROTOCOL_STATS` derivation. There is no Convex query, no chain connection, no wallet, no authentication, no KYC.

This is intentional. The UI was built ahead of the onchain infrastructure so the portfolio and deposit/redeem flows could be validated visually before contracts and indexer were in place. The target architecture below is how this becomes real.

> **Migration note.** After PRs 4–5 of the [monorepo migration](../superpowers/specs/2026-05-31-monorepo-migration-design.md), this shell moves to `apps/fund/` on its own origin (`fund.mutav.finance`). The route group structure stays identical; only the deployable home and the origin change. Wallet-kit selection is deferred to a separate spec, so `apps/fund/` ships without a wallet kit at PR 4; the existing investor portal stays in `apps/agency/` until that spec resolves and the port lands. The fold-in from the soft-deprecated [`mutav-fund/`](https://github.com/mutav-finance/mutav-fund) repo follows the wallet-kit port; the archive trigger is documented in spec § Section 4.

## Wallet as identity (per chain)

The investor portal does not use Auth0. The user's wallet **on the chain they're transacting on** is their identity for that chain's funds. This is a hard architectural choice:

- **Why not Auth0** — the value an investor holds (fund tokens) lives onchain and is owned by the wallet. Authenticating through Auth0 would create a second identity layer that the chain doesn't recognize. Two layers means two places to revoke access, two places to phish, two places to sync.
- **What Convex stores** — a row keyed on `(chain, address)`, holding per-user offchain state that the chain doesn't carry: KYC status (per chain), notification preferences, redemption queue position cache, display name.
- **What proves identity** — for reads: nothing. The wallet address is in the URL or selected in the UI; data scoped to that address is shown. For writes: the wallet signs the transaction. Convex does not see private keys.

The provisioning rule: an investor profile row is created lazily the first time a wallet connects on a given chain. There is no signup flow.

### Per-chain accounts — explicit design choice

A user who connects a Stellar wallet and a Solana wallet has **two unrelated investor profiles**. No platform-level identity unifies them. Each profile carries its own verification level, its own KYC state, its own risk classification, its own limit budget. This is documented in [`compliance.md`](compliance.md) § Account types.

The implications, accepted on purpose:

- A user investing across chains completes KYC on each chain independently
- Portfolio aggregation across chains is the user's mental work, not the platform's
- Cross-chain identity (one CPF, multiple wallets, unified statements) is a **future** concern anticipated by [`regulatory.md`](regulatory.md) (for per-CPF tax aggregation) but not v1 architecture
- A future migration to a unified identity layer (e.g., Reown AppKit, custom CPF-linked account) is a non-trivial change to this section but does not require changes to per-chain indexer modules or contract topology

The simplification this buys: each chain integration is self-contained. Adding a new chain doesn't require touching the identity layer; it requires adding a wallet adapter and indexer module (see [`onchain-integration.md`](onchain-integration.md) § Per-chain indexer modules).

## KYC boundary

**Brazilian regulatory context (BCB 519/2025):** the architecture must respect Brazilian KYC requirements at the BRL-to-token boundary — in practice that means KYC is required before the **first deposit** for users routing BRL through Etherfuse. The whitepaper's "KYC at redeem only" stance reflects the onchain-only investor path (USDC/USDT in, USDC/USDT out — no fiat boundary). The architecture supports both modes; the configured policy per fund decides which gate applies.

The capability ladder is defined in [`compliance.md`](compliance.md) § Verification levels. For investors:

```
L0 (Connected)    → Browse, view NAV/portfolio                  No PII
L1 (Identified)   → Deposit (capped)                            CPF/email/phone
L2 (Verified)     → Redeem (capped); MTVL/MTVM access           + biometric + ID + address
L3 (Enhanced)     → Higher caps, transfers to verified wallets  + source of funds + sanctions/PEP
L4 (Qualified)    → MTVH access; qualified-investor-only        + CVM 175 declaration
L5 (Institutional) → Programmatic API, custom limits             + corporate KYB
```

Architectural commitments:

- **KYC state lives in Convex, keyed on `(chain, address)`** — per-chain, per the wallet-as-identity-per-chain decision above. A user who completes KYC on their Stellar wallet does not get KYC credit on their Solana wallet.
- **Gating is in the auth/compliance wrapper, not in handler bodies** — every state-changing investor handler consults the compliance domain per [`compliance.md`](compliance.md) § How the compliance domain plugs in. The wrapper resolves account level + risk + limits + state in one pass and returns allow / deny with a structured error code.
- **KYC vendor abstraction is mandatory.** Direct vendor coupling is prohibited. Vendor-specific clients live in `convex/compliance/providers/{vendor}.ts` implementing a stable interface — see [`regulatory.md`](regulatory.md) § KYC vendor selection criteria. Vendor selection criteria (BR data residency, ANPD-registered, biometric ISO/IEC 30107-3 PAD L2+) narrow the field but a specific vendor is operational, not architectural.
- **Sensitive PII stays at the vendor.** Convex stores `kycLevel`, `kycStatus`, `kycRef` (vendor's verification id) — never raw biometric payloads or ID document images. Per [`regulatory.md`](regulatory.md) § LGPD.

### Dual KYC regime for BR-resident investors

A BR-resident investor subscribing to `Mutav-Fund` faces a dual regulatory regime that single-jurisdiction KYC does not capture (see [`regulatory.md`](regulatory.md) § Marketing offshore Fund to BR investors):

1. **Offshore Fund's own KYC / AML** — FATF floor, sanctions screening, sometimes ID/PoA, source of funds. Required by `Mutav-Fund`'s domicile regulator and its Subscription Agreement.
2. **Brazilian regulatory overlay** for BR-resident investors specifically:
   - **CVM 175 classification** (qualificado / profissional) — gates tranche access (MTVH requires L4+, see [`tranches.md`](tranches.md)) and oferta pública carve-outs
   - **CPF identification** per BCB 519/2025 (same artifact serves both regimes — collected once, used twice)
   - **DIRPF disclosure** — investor must declare offshore holdings in their annual return; `Mutav-BR` issues an extrato compatível at year-end (or `Mutav-Mgmt` for `Mutav-Fund` directly, depending on which entity issues the statement)
   - **BACEN câmbio reporting** on the BRL → crypto → offshore-Fund chain (architecturally owned by `Mutav-BR`'s reporting workflow, not the investor's responsibility, but the investor's deposit triggers it)

The portal's onboarding flow detects the investor's residency and applies the appropriate KYC track: international investors get the single FATF/AML floor; BR investors get the dual regime in one flow that collects both data sets without making the investor re-enter shared fields. The compliance domain records both classifications per [`compliance.md`](compliance.md).

## Stub-first onchain data pattern

The portal's data layer is the architectural centerpiece. The contract between UI and data must be stable from day one so the swap from "mock data" to "real chain state" is invisible to the UI.

### The pattern

Three Convex tables (names tentative — set in domain design). **All carry a `chain` discriminant** so a single schema supports the per-chain model:

- `fundState` — one row per (chain, fund). Holds NAV, AUM, contract count, APY (derived), last-indexer-cursor.
- `userPositions` — per (chain, wallet address, fund) token balance and cost basis.
- `redemptionQueue` — pending redeem requests, with queue position and projected execution date, scoped per (chain, fund).

These tables are the **read-side source of truth for the UI**. They are populated by a writer that the UI does not know about:

| Today (mock)                                                                                      | Tomorrow (real)                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/seed.ts` populates `fundState` with the three hardcoded Stellar funds (chain = "stellar") | A per-chain indexer module polls and upserts `fundState` from chain events; see [`onchain-integration.md`](onchain-integration.md) § Per-chain indexer modules |
| `userPositions` empty (no real users)                                                             | Per-chain indexer derives positions from observed mint/redeem events keyed by (chain, wallet)                                                                  |
| `redemptionQueue` empty                                                                           | Per-chain indexer mirrors the onchain queue                                                                                                                    |

The UI's read query (`api.fundState.useCases.listFunds`) is identical in both worlds. Only the writer changes. The writer-swap is the architectural contract. The `chain` discriminant means the same UI can render single-chain (`{ chain: "stellar" }`) or filter to cross-chain aggregates when the wallet kit supports the connected chain.

### Why this matters

- **Investor work isn't blocked on contract deployment.** The portal can wire up Convex queries today against seeded `fundState` rows, then the seeded data is replaced by indexer-populated data when contracts ship.
- **Mutav-admin (A5) shares the same tables.** Same `fundState`, different consumer. The admin observability view reads operator-only fields (signer set, paused status, treasury balance) that are columns on the same row or sibling tables.
- **No "rip and replace" migration.** When the indexer goes live, it overwrites seeded rows on its first run. UI keeps working; the values just get more accurate.

The indexer architecture is detailed in [`onchain-integration.md`](onchain-integration.md).

## Non-custodial write path

Convex never signs onchain transactions. The write paths in the portal:

### Deposit (mint)

**Asset note.** Investor deposits arrive in **USDC/USDT** (per the whitepaper); `Mutav-Fund`'s **treasury is denominated in TESOURO** (Etherfuse's tokenized Brazilian Treasury bonds — BRL-denominated, yield-bearing — held in `Mutav-Fund`'s Stellar address per [`onchain-integration.md`](onchain-integration.md) § Offshore custody chain). The protocol converts USDC → TESOURO via Etherfuse as part of the deposit flow; the investor's tranche holding (MTVH / MTVM / MTVL) represents a claim on the TESOURO-denominated NAV of that specific tranche. How that conversion is priced (single BRL NAV / dual share class / USD NAV with TESOURO underlying) is a **pending Draau decision** documented in [`admin.md`](admin.md) § A6; architecture supports all three.

**Tranche selection.** Before the deposit workflow starts, the investor selects which of MTVH / MTVM / MTVL they're subscribing to. The portal enforces tranche eligibility per [`tranches.md`](tranches.md) (a L2 investor sees only MTVL/MTVM cards; a L4+ qualificado investor also sees MTVH). The selected tranche flows through to the mint step — the fund contract issues the corresponding tranche token.

Implemented as a `@convex-dev/workflow` per [`reliability.md`](reliability.md) § Workflow durability:

1. **Pre-flight gate** — compliance check (level / risk / limits / regulatory pause / **tranche eligibility**) via [`compliance.md`](compliance.md). Wrapper returns a `Result` error with a structured code if blocked. For BR investors, the gate also enforces the CVM 175 classification overlay.
2. **Workflow start** — compose the transaction (transfer USDC/USDT + call `mint` on the fund contract with the chosen tranche) and record the intent (intent id stored in Convex; correlation id propagated per [`reliability.md`](reliability.md) § Reconciliation; entity code `MUTAV_FUND` tagged on audit entry).
3. **Wallet sign** — wallet kit prompts user in browser; user's keys sign locally.
4. **Submit** — signed transaction submitted to the chain via the wallet kit.
5. **Protocol-side conversion** — the fund contract (or a Convex-orchestrated workflow step) swaps the inbound USDC to TESOURO via Etherfuse; the investor's claim is denominated per the deposit-pricing approach (see Draau pin in [`admin.md`](admin.md) § A6). For BR investors, `Mutav-BR` is notified to file the câmbio reporting record per [`regulatory.md`](regulatory.md) § BACEN câmbio reporting.
6. **Wait for observation** — workflow sleeps until the per-chain indexer observes the mint event.
7. **Finalize** — `userPositions` row updated (with `tranche` discriminant); UI reactively refreshes via Convex's live query; intent record marked `executed`.

The workflow's journal makes partial failure recoverable — a Convex restart between steps 4 and 6 resumes from the last checkpoint. If the user closes the browser between sign and submit, the intent expires and is garbage-collected (the chain never sees the tx, so there's nothing to clean up).

### Redeem

Same workflow shape, with added pre-flight gates:

1. **KYC level check** — must satisfy the fund's redeem threshold (typically L2 for MTVL/MTVM, L4+ for MTVH; per the compliance domain)
2. **Limit check** — per-account redeem cap not exceeded
3. **Per-tranche weekly cap check** — applied per tranche (the whitepaper's 2.5% weekly cap divides per tranche, not aggregated) — see [`tranches.md`](tranches.md) § Redemption queue semantics
4. **SitG floor check** (MTVH only) — `Mutav-BR`'s mandatory skin-in-the-game minimum cannot be redeemed below the agreed floor

If any gate fails, the wrapper returns a `Result` error code. If all pass, the workflow proceeds as deposit, except the redeem transaction enters the **per-tranche** onchain queue rather than executing immediately. The queue is observed by the indexer and surfaced in `redemptionQueue` (with `tranche` discriminant). The workflow remains live (sleeping) until execution, then finalizes. For BR investors, `Mutav-BR` is notified of the inbound BRL leg for câmbio reporting per [`regulatory.md`](regulatory.md).

### Why Convex never signs

- **Custody clarity** — investors trust the chain and their own wallet, not Mutav. A breach of Mutav infrastructure must not move user funds.
- **Regulatory posture** — non-custodial is the whitepaper's commitment; Convex signing would break that.
- **Failure isolation** — Mutav going down should not prevent a user from redeeming directly via the wallet against the chain. The portal is a convenience layer over a contract that works without it.

## Wallet kit architecture

The wallet kit is the chain-specific library that connects the user's wallet, composes transactions, and submits signed txs. Mutav uses **per-chain wallet kits** isolated to each per-chain module (see [`onchain-integration.md`](onchain-integration.md) § Per-chain indexer modules).

### Stellar (v1)

**Library:** [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit) (`@creit.tech/stellar-wallets-kit`), de-facto standard for Stellar wallet abstraction.

**Adapter discipline.** The kit historically pulled in 9 critical CVEs via Trezor / Hot / NEAR adapters that Mutav never invoked. The earlier removal of the kit was driven by this. Re-adopting requires:

- Adapter set limited to **Freighter + xBull + Albedo** (the wallets Brazilian Stellar users actually have)
- **Explicitly exclude** Trezor, Hot, NEAR, and any other non-required adapter
- Lock the adapter set in `package.json`; review on every kit upgrade
- Document the adapter exclusion list in the per-chain Stellar module's README

This isn't paranoia — it's the lesson the project already learned. Future maintainers must not silently re-include excluded adapters during dependency updates.

### Future chains

**Solana** — when Solana funds ship: add `@wallet-standard/react`. The Solana Wallet Standard auto-detects Phantom, Backpack, Solflare without per-wallet adapter code. Lives in `convex/chains/solana/` per the per-chain module pattern.

**EVM / other** — when EVM funds ship: add a vetted EVM kit (RainbowKit, ConnectKit, or wagmi directly). Per-chain isolation rule applies.

### Why not a multichain abstraction (Privy / Reown / Dynamic)

Surveyed alternatives for v1:

- **Privy** — Stellar is "Tier 2" support: embedded wallets only, no external wallet connect (Freighter / xBull / Albedo). Adopting Privy would force Mutav onto Privy-managed embedded wallets and lock out users who hold their own keys. Wrong fit.
- **Reown AppKit** (formerly WalletConnect) — the only true multichain abstraction with first-class Stellar (`docs.reown.com/advanced/multichain/rpc-reference/stellar-rpc`). Future escape hatch if Mutav needs (a) one login modal across chains, (b) embedded wallets / social login, (c) per-chain integration cost exceeds the abstraction tax.
- **Dynamic.xyz** — broad multichain (EVM, SVM, Bitcoin, Cosmos, Algorand, Sui) but **Stellar not in supported chains list** as of 2026. Out.

**v1 commitment:** Stellar Wallets Kit + adapter discipline. **Future migration trigger:** when a user-facing need (cross-chain account view, social login, embedded wallets) outweighs the per-chain integration cost, migrate to Reown AppKit. That migration touches the per-chain module's `wallet.ts` only — the rest of the architecture is unchanged.

## Trust model

The investor trusts, in order:

1. **The smart contracts** — verified onchain, audited, source open at `mutav-stellar`. This is the only thing the investor must trust for funds.
2. **The KYC provider** — for identity verification. Vendor-specific; not Mutav.
3. **Their own wallet** — for signing. User's responsibility.

The investor does **not** trust Mutav for:

- Custody (non-custodial — funds in contracts, not in Mutav's hands)
- Liquidity (capped + queued per design; the contract enforces, not Mutav)
- NAV calculation (computed onchain, anyone can reproduce)

The investor **does** trust Mutav for:

- UI correctness (the values shown match what the chain says)
- Indexer freshness (state cached in Convex is up to date)
- Off-chain coordination (KYC state, redemption queue position display, notifications)

That trust surface is small. It is bounded by the indexer's correctness and Convex's availability. When either degrades, the user can verify state directly against the chain via any explorer for that chain (Stellar explorers for Stellar funds, Solana explorers for Solana funds, etc.).

## Failure model

What goes wrong, what the user sees, what the architecture does about it:

| Failure                                     | User-visible symptom                                                     | Mitigation                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Indexer lag (chain ahead of Convex)         | "Last updated 3 min ago" badge, stale balances                           | Display `lastUpdatedAt` from `fundState` row; flag as stale after threshold                                                                                        |
| Indexer crashed (any chain)                 | That chain's values frozen; other chains unaffected                      | Per-chain isolation contains blast radius (see [`onchain-integration.md`](onchain-integration.md) § Per-chain indexer modules)                                     |
| Convex down                                 | Portal unavailable                                                       | User can still transact directly against the chain via wallet kit + chain explorer; deposit/redeem is the wallet's responsibility, not Mutav's                     |
| Workflow step fails mid-deposit             | UI shows "processing" then error; intent record stays in pending         | Workflow journal allows resumption; users can retry deposit; idempotency at the chain (correlation id) prevents double-mint per [`reliability.md`](reliability.md) |
| Reconciliation detects mint/supply mismatch | Circuit breaker pauses deposits to that fund; UI shows fund-paused state | Compliance team investigates per [`compliance.md`](compliance.md) § Regulatory pause and [`reliability.md`](reliability.md) § Reconciliation                       |
| NAV deviation circuit breaker fires         | Mint and redeem pause on that fund                                       | Treasury investigates per [`reliability.md`](reliability.md) § NAV safety                                                                                          |
| Chain reorg                                 | (Unlikely on Stellar; varies per chain)                                  | Indexer re-derives from latest cursor; previously displayed state may shift                                                                                        |
| User signs malformed tx                     | Tx rejected onchain                                                      | Wallet kit shows error; workflow intent stays in pending then expires                                                                                              |
| KYC provider down                           | Redeem flow blocked at "Start verification" step                         | Surface vendor status; user can retry; held positions are unaffected; vendor abstraction allows failover when configured (see [`regulatory.md`](regulatory.md))    |
| Wallet kit adapter compromise (CVE)         | Potentially affects sign flow                                            | Adapter discipline per § Wallet kit architecture limits blast radius; explicit exclusion list documented                                                           |

## Out of scope for this doc

- Specific KYC vendor selection (see [`regulatory.md`](regulatory.md) for criteria)
- Specific Convex domain layout for `fundState` / `userPositions` / `redemptionQueue` — set at implementation time
- UI mockups and component design — separate track
- B2B / institutional rails (statements, API access) — explicitly deferred until a named institutional partner asks
- Token economics and contract design — lives in `mutav-stellar` (or the equivalent repo per chain)
- Specific limit amounts and KYC level thresholds per fund — see [`compliance.md`](compliance.md); set by compliance team

## Related reading

- [`entities.md`](entities.md) — `Mutav-Fund` is the investor's counterparty; `Mutav-BR` handles BR-side câmbio
- [`tranches.md`](tranches.md) — MTVH / MTVM / MTVL specification; tranche eligibility per verification level
- [`compliance.md`](compliance.md) — account types, verification levels, risk classification, limits, capability matrix — the gating layer this portal consults
- [`reliability.md`](reliability.md) — workflow durability for deposit/redeem, three-axis reconciliation, idempotency, NAV safety
- [`regulatory.md`](regulatory.md) — BCB 519/2025 KYC floor, LGPD residency, KYC vendor criteria, CVM oferta pública for BR investors, BACEN câmbio
- [`onchain-integration.md`](onchain-integration.md) — per-chain indexer modules, contract topology, write path, wallet kit pattern, offshore custody
- [`admin.md`](admin.md) — counterpart Mutav-internal surface; shares the indexer infrastructure
