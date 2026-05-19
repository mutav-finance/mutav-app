# Chain ↔ Convex Integration — Architecture

> The `Mutav-Fund` (the offshore fund per [`entities.md`](entities.md)) lives onchain (Stellar / Soroban for v1; additional chains in the future per [`investor.md`](investor.md)). Treasury custody is `Mutav-Fund`'s; treasury operations (NAV updates, liquidation, signer-set changes) are executed by `Mutav-Mgmt` per offshore fund-admin custody norms. The web app is offchain (Convex + Next.js). This document defines the boundary between them: how chain state becomes Convex tables (read path), how user and admin intents become onchain transactions (write path), the contract topology that satisfies the segregated-account model, the offshore custody chain that satisfies fund-admin separation requirements, and the stub-first contract that lets both sides ship independently. The infrastructure here is **shared** between Mutav Admin's A5 (fund observability) and the Investor portal's I2 (real fund data).

Cross-cutting reliability primitives (reconciliation, idempotency, workflow durability, audit-log integrity, NAV safety) are factored into [`reliability.md`](reliability.md). This document references them rather than re-explaining each one.

## Boundary properties

The chain↔Convex boundary is a trust + responsibility boundary. The rules:

1. **Read is one-way and async.** Convex pulls chain state via the indexer. The chain does not push to Convex.
2. **Convex never signs onchain transactions.** Custody stays with the original key-holder (investor wallet or platform multisig).
3. **The chain is the source of truth.** Convex tables are a cache. On any conflict, the chain wins; the cache is rebuilt.
4. **The cache is the UI's source of truth.** UI queries Convex, never RPC directly. This keeps UI rendering reactive and Stellar RPC quirks out of the front-end.
5. **The writer of cache tables is swappable.** The UI's read path doesn't know whether seed data, an indexer, or both wrote the row.

These properties hold whether the indexer is real or stubbed; they hold whether read latency is seconds (polling) or sub-second (event subscription). The architecture is stable; the implementation is interchangeable.

## Read architecture

Two strategies. Pick one per phase; design the swap point so the switch is local. **The same pattern repeats per chain** — see § Per-chain indexer modules below for how Stellar / Solana / EVM coexist.

### Recommended for v1: Convex action polling (cron-driven)

```
       Chain RPC ◄─────────  pollFundState (Convex action, "use node")
            │                       │
            │ JSON-RPC               │ upsert
            ▼                       ▼
       Fund contract           Convex tables (carry `chain` discriminant)
       Treasury account        (fundState, userPositions, redemptionQueue)
                                    │
                                    │ live query
                                    ▼
                               UI (both admin & investor)
```

- A Convex cron action runs every N minutes (start: 5 min, tune down later) **per chain**
- Action queries the chain's RPC for fund contract state and treasury account balances/events
- Action upserts into Convex tables, keyed by deterministic ids `(chain, fundId, …)`
- Each table carries a `chain`, `lastIndexerCursor`, and `lastUpdatedAt` so the UI can surface staleness per chain

This matches the existing pattern in [`convex/anchors/actions.ts`](../../convex/anchors/actions.ts) (`pollAnchorTestOnramp`, `pollPixOnramp`). The infrastructure exists; the fund-state action is a new entry alongside, generalized to be per-chain.

**Why polling for v1:**

- One moving part (the cron). No external bridge to maintain, no webhook secrets to rotate.
- Convex actions and crons are first-class — no separate process to deploy.
- Stellar's finality is fast enough that 5-minute lag is tolerable for "fund NAV" display.
- The failure mode (action fails → table stale → UI shows stale badge) is observable and benign.

**Why not polling forever:**

- Per-user actions feel slow when the user just signed a tx and refreshes. "It says 'pending' for 4 minutes" is bad UX.
- Polling at high frequency wastes RPC quota and Convex compute.

### Future swap: event subscription

When polling becomes the bottleneck (lag user-visible, or RPC costs material), the migration target:

```
       Stellar RPC ── subscribe ──► Mercury / event bridge
                                          │
                                          │ webhook
                                          ▼
                                    Convex HTTP action
                                          │
                                          │ upsert
                                          ▼
                                    same Convex tables
```

The upsert side is unchanged. The reader (UI queries) is unchanged. Only the writer's trigger changes from "cron tick" to "webhook fired". The swap is a single new HTTP action + a config flag that disables the cron action; rollback is the inverse.

The trigger for migration is observable: a user-facing metric of "time from tx submission to UI reflection". When that exceeds (TBD) some threshold for (TBD) some user fraction, migrate. Don't speculate on the threshold here.

## Write architecture

The chain has two write origins, both outside Convex:

### Investor writes (client-signed)

```
   UI ── compose tx ──► Wallet kit (in browser) ── user signs ──► Soroban
                              │
   Convex ◄── record intent ──┘  (optional, informational)
                                                                    │
                                                                    │
   indexer observes ◄──────────────────────────────────────────────┘
```

- UI constructs the transaction (mint, burn, redeem queue placement)
- Wallet kit prompts the user in their browser
- User's private key signs locally; signed tx submitted to Soroban via the kit
- Convex may record an "intent" row so the UI can show "pending" between submission and indexer observation — the intent is informational, the chain is authoritative
- The indexer eventually observes the event and updates the cache

Convex's involvement is bounded to: (a) pre-flight checks via wrappers (KYC, weekly cap) before allowing the UI to compose the tx, and (b) reactive UI updates after the indexer sees it. Convex does not touch keys.

### Admin writes (multisig-mediated)

Stellar has no production Safe/Squads-equivalent in 2026 (see [`regulatory.md`](regulatory.md) § Stellar implementation pattern). Mutav fills the gap with a **proposal queue UI built inside the `(admin)` shell** that owns the coordination; individual signers sign on Lobstr Vault (mobile push, biometric) for proper key isolation.

```
   Admin UI ── attest proposal ──► Convex (treasury.proposals, mutavAuditLog)
                  │                       │
                  │                       │ stores composed XDR + collected sigs
                  ▼                       │
   Mutav proposal queue UI                │
   (treasury/proposals route in admin) ◄──┘
                  │
                  │ "Sign on Lobstr" deep link per signer
                  ▼
   Lobstr Vault (per signer, mobile) ── attaches signature ──► Convex
                  │
                  │ threshold met
                  ▼
   Convex action submits XDR ───────────► Stellar classic G-account
                                              │ (3-of-5 weighted native multisig)
                                              │
                                              ▼
                                          Soroban contract (require_auth)
                                              │
   indexer observes ── advances workflow ◄────┘
```

- Mutav-admin attests the proposal (liquidation per A3, NAV update per A6, signer-set change, contract upgrade) — `mutationWithMutavRole({ minRole: "treasury" })` writes to `treasury.proposals` and `mutavAuditLog`
- The proposal queue UI surfaces pending proposals to authorized signers, with a "Sign on Lobstr" deep link per signer
- Each signer signs on their personal **Lobstr Vault** — mobile push notification, biometric approval, no shared signing tool, no shared key material
- Signatures accumulate on the Convex-side proposal row until the multisig threshold is met (weighted, per [`regulatory.md`](regulatory.md) § Stellar implementation pattern)
- A Convex action submits the now-fully-signed XDR to Stellar
- The classic G-account's weight-based multisig validates onchain
- For Soroban operations (NAV updater, liquidation executor), the G-account is the contract's authorized admin — multisig auth propagates via standard `require_auth`
- The indexer observes execution and advances the workflow's terminal step

**Why Mutav builds the queue rather than using a third-party tool:**

- No production Safe/Squads-equivalent exists for Stellar (verified 2026; see [`regulatory.md`](regulatory.md))
- Closest options (`multisigstellar/multisig` coordinator, StellarGuard co-signer-as-a-service) are not full proposal queues
- Building the queue inside `(admin)` keeps the audit trail unified (every proposal + signature event is a `mutavAuditLog` entry)
- Cost: ~1–2 weeks; the alternative ("we'll integrate when a tool ships") is open-ended

**Convex's role is coordination + bookkeeping + submission. Custody is the signers' Lobstr Vaults, owned by humans, not the app deployment.** Convex never holds key material; it composes and submits, but each signature is generated on a signer's device.

### Why Convex never signs

- **Blast radius** — if Convex held signing keys, a Convex compromise would compromise funds. Today a Convex compromise compromises only the cache (which can be rebuilt from the chain) and the offchain audit log (forensically inconvenient, not catastrophic).
- **Whitepaper commitment** — the protocol is non-custodial. Convex signing would break that.
- **Operational separation** — investor funds are the investor's. Admin treasury moves require human multisig consensus. Both are deliberate; both would degrade if Convex could sign.

## Per-chain indexer modules

Mutav v1 ships Stellar funds. Subsequent phases may add Solana, EVM, or others. Each chain has its own RPC, its own signing model, its own multisig tooling, and its own wallet kit. The architecture isolates per-chain concerns to a module:

```
convex/
├── chains/
│   ├── stellar/
│   │   ├── indexer.ts      ← polling action, upserts to fundState/userPositions/redemptionQueue
│   │   ├── tx.ts           ← tx composition helpers for the UI to fetch and sign client-side
│   │   └── reconcile.ts    ← reconciliation routines specific to this chain's mint/burn semantics
│   └── solana/             ← (future) same shape
└── fundState/              ← shared schema; rows carry `chain` discriminant
```

**Architectural invariants:**

- The shared schemas (`fundState`, `userPositions`, `redemptionQueue`) carry a `chain` discriminant. Queries that need cross-chain rollups (admin "platform-wide AUM") aggregate across `chain` values; queries that are chain-specific (investor portfolio per chain) filter by it.
- Per-chain modules **do not call each other**. The Stellar indexer never imports from `convex/chains/solana/`. Cross-chain logic, if any, lives in a coordinating domain that calls each module through its public interface.
- A new chain = a new module + new entries in the wallet-kit and multisig-tool registries (see [`investor.md`](investor.md) § Wallet kit architecture). No changes to the shared schemas, no changes to other chains' modules.

This isolation keeps blast-radius bounded: a Solana indexer bug cannot affect Stellar fund state; a Stellar RPC outage cannot block the Solana indexer; chain-specific safeguards (e.g., Stellar reorgs are negligible, Solana finality is different) live where they apply.

## Contract topology — Segregated Account

Offshore fund-admin custody rules (Cayman CIMA, BVI Fund Admin Code, similar elsewhere) and the Mutav whitepaper commit to a Segregated Account structure: investor capital is legally and operationally separated from protocol operations, and the fund's custody is separated from its administrator. This is not just a legal artifact — it must be enforced in the contract topology onchain. The architectural commitment, per chain:

```
┌─────────────────────────────────────────────────────────────┐
│                  Mutav-Fund + Mutav-Mgmt on {chain}         │
│                                                             │
│   ┌──────────────────────┐       ┌──────────────────┐       │
│   │  Custody contracts   │       │  Operations      │       │
│   │  (per tranche)       │◄──────┤  contracts       │       │
│   │  owned by Mutav-Fund │       │  owned by        │       │
│   │                      │       │  Mutav-Mgmt      │       │
│   │ • Hold TESOURO       │       │                  │       │
│   │   per tranche        │       │ • Mint authority │       │
│   │ • Issue MTVH/MTVM/   │       │ • Redeem queue   │       │
│   │   MTVL tokens        │       │ • NAV updater    │       │
│   │ • Narrow interface   │       │   (3 tranches)   │       │
│   │   (deposit/redeem    │       │ • Liquidation    │       │
│   │   per tranche)       │       │   executor       │       │
│   │                      │       │ • Multisig-gated │       │
│   └──────────────────────┘       │   (Mutav-Mgmt    │       │
│                                  │    signers)      │       │
│                                  └──────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Invariants the topology enforces:**

- **One custody contract per tranche.** MTVH, MTVM, and MTVL each have their own custody contract (or per-tranche partitions within one contract). Cross-tranche contamination is impossible at the protocol level — a default in MTVH's waterfall step (see [`tranches.md`](tranches.md)) cannot drain MTVL's custody.
- **Operations contracts are subordinate.** Operations contracts hold no investor capital. They have approval-gated authority to invoke custody operations (mint on deposit, burn on redeem, transfer-out on liquidation) but cannot move capital except through these narrow entry points.
- **Entity ownership is explicit.** Custody contracts' admin/owner key is `Mutav-Fund`'s Stellar account. Operations contracts' admin/owner key is `Mutav-Mgmt`'s signer set (Lobstr Vault multisig). Custody granting operations access is itself a multisig-gated operation that requires both entities' attestation per [`regulatory.md`](regulatory.md) § Multisig governance.
- **Multisig gates operations.** Operations contracts that affect treasury (NAV update per tranche, liquidation, mint authority changes) require multisig consensus per [`reliability.md`](reliability.md) and [`regulatory.md`](regulatory.md). Single-actor authority does not exist.
- **Topology is verifiable.** External auditors can verify the separation by reading the contract registry — the architecture commits to publishing the contract addresses, their entity owners, and their relationships in a public manifest.

This is architecture, not implementation. The actual Soroban contracts (and equivalent contracts on future chains) live in `mutav-stellar` and follow this topology. The doc commits to what the topology must enforce; it does not specify contract signatures.

## Offshore custody chain

The three-entity model imposes additional custody discipline beyond standard segregated-account topology. Offshore fund-admin custody rules require the administrator (`Mutav-Mgmt`) to be operationally separable from the fund (`Mutav-Fund`); the architecture reflects this in how keys, signers, and authorization flow.

```
                    ┌────────────────────────────────┐
                    │   Mutav-Fund                   │
                    │   (Cayman / BVI / etc.)        │
                    │                                │
                    │   Owns:                        │
                    │   • Stellar treasury G-account │
                    │   • TESOURO balance            │
                    │   • Tranche token issuance     │
                    └──────────────┬─────────────────┘
                                   │
                                   │  delegates signing authority
                                   │  (admin agreement)
                                   ▼
                    ┌────────────────────────────────┐
                    │   Mutav-Mgmt                   │
                    │   (same offshore jurisdiction) │
                    │                                │
                    │   Operates:                    │
                    │   • Lobstr Vault signers       │
                    │     (3-of-5 weighted multisig) │
                    │   • Proposal queue UI          │
                    │     (in Mutav (admin) shell)   │
                    │   • NAV computation, audit log │
                    └──────────────┬─────────────────┘
                                   │
                                   │  proposes / signs / submits onchain ops
                                   ▼
                    ┌────────────────────────────────┐
                    │   Stellar / Soroban            │
                    │                                │
                    │   require_auth(Mutav-Fund      │
                    │     treasury G-account)        │
                    │     ↑                          │
                    │     │                          │
                    │   propagates from native       │
                    │   multisig signed by           │
                    │   Mutav-Mgmt signers           │
                    └────────────────────────────────┘
```

**Custody invariants:**

- **`Mutav-Fund` owns the treasury account; `Mutav-Mgmt` holds the signing keys** for the treasury account's multisig signer set. This separation matches offshore fund-admin custody rules — the fund and its administrator are distinct.
- **No single `Mutav-Mgmt` signer can move funds.** The native multisig threshold (3-of-5 weighted per [`regulatory.md`](regulatory.md)) ensures collusion by one signer or one device is insufficient.
- **Cross-entity attestations required for specific operations.** Operations that affect both entities' balances (e.g. liquidation: `Mutav-Fund` burns TESOURO, `Mutav-BR` receives BRL for default coverage) require attestation from both `Mutav-Mgmt` (to sign the Stellar tx) and `Mutav-BR` (to acknowledge the receipt). The cross-entity attestation lives in `mutavAuditLog` per [`reliability.md`](reliability.md).
- **Signer set changes are themselves multisig operations.** Adding or rotating a `Mutav-Mgmt` signer requires the existing signer-set's consensus + an entry in `Mutav-Mgmt`'s operating agreement (off-chain legal artifact) per [`regulatory.md`](regulatory.md) § Multisig governance.
- **The custody chain is documented in the offshore fund-admin agreement.** External auditors verify the contract registry + the admin agreement together — the technical custody must match the legal custody specification.

**Open per L3 / P3 — TESOURO offshore holder eligibility.** Whether Etherfuse permits an offshore entity (`Mutav-Fund`) to hold TESOURO is the load-bearing question. If Etherfuse restricts TESOURO holders to BR-domiciled entities, the custody chain inserts a BR intermediary: `Mutav-BR-Treasury` would hold TESOURO on behalf of `Mutav-Fund`, with corresponding documentation tying the BR holding to the offshore beneficiary. The Soroban contract topology absorbs this addition without rewrite — only the treasury G-account ownership shifts from `Mutav-Fund` to `Mutav-BR-Treasury`.

## External integrations

Every external system that pushes events into Convex (anchor webhooks, KYC vendor callbacks, chain-event bridges, future payment processor webhooks) goes through a hardened ingestion path. The rules:

1. **Signature verification first.** The HTTP action that receives the webhook validates the provider's signature before any business logic runs. Unsigned webhook endpoints don't exist.
2. **Idempotency by external event id.** Every webhook payload carries a provider event id (Etherfuse `event_id`, KYC vendor `request_id`, Stellar event `paging_token`). The ingest mutation uses a unique-index guard on this id — duplicate webhooks are dropped at the storage layer, no business logic runs twice. See [`reliability.md`](reliability.md) § Idempotency.
3. **Replay window enforcement.** Webhook timestamps that fall outside an acceptable window (default: ±5 minutes from server time) are rejected to prevent replay of captured payloads.
4. **Secret rotation is documented.** Webhook secrets are stored via the env-var pattern (`convex/lib/env.ts` lazy getters per [CLAUDE.md § "Environment variables"](../../CLAUDE.md)), with documented rotation procedures.
5. **Per-provider HTTP action.** Each external integration has its own action endpoint, never a shared catch-all. Vendor-specific signature schemes and error semantics stay isolated.

For Mutav today, the integrations that need this hardening: **Etherfuse webhooks** (Pix deposit confirmations, KYB status changes), **agency-settlement BaaS webhooks** (Pix-in / Trade / Crypto-out events from Transfero / Bitso / Foxbit — see below), **KYC vendor callbacks** (Sumsub events per [`compliance.md`](compliance.md) and [`regulatory.md`](regulatory.md)), **Stellar event ingestion** (when polling is replaced with event subscription per § Read architecture). The pattern is the same; only the per-provider verification routine differs.

### Agency settlement

`Mutav-Fund`'s treasury asset is **TESOURO** (Etherfuse's tokenized Brazilian Treasury bonds — BRL-denominated, yield-bearing). Both investor on-ramp and agency settlement land in TESOURO into `Mutav-Fund`'s Stellar address. Agency settlement is the cessão leg from `Mutav-BR` to `Mutav-Fund` per [`entities.md`](entities.md). **Etherfuse is the primary settlement rail for both flows**; BaaS providers (Transfero / Bitso / Foxbit) sit alongside as **capacity and concentration hedges**, not as a separate primary path.

#### Primary rail — Etherfuse (BRL Pix → TESOURO direct)

The same Etherfuse primitive that powers investor on-ramp powers agency settlement. The difference is the **destination address** (the cessão amount mints TESOURO to `Mutav-Fund`'s treasury address rather than to the investor's wallet) and the **flow trigger** (system-driven from `Mutav-BR`'s cessão schedule rather than user-driven hosted UI):

```
Agency ── Pix ──► Mutav-BR's Etherfuse virtual account
                       │
                       │ Pix MED 2.0 quarantine window
                       │ (per reliability.md § Quarantine windows)
                       │
                       │ Mutav-BR retains 20%; cedes 80% via cessão
                       ▼
                  Etherfuse mints TESOURO ──► Mutav-Fund treasury (Stellar)
                       │
                       │ webhook (correlationId from Mutav-BR's payments row,
                       │ entity codes MUTAV_BR + MUTAV_FUND tagged on audit entry)
                       ▼
                  Convex workflow step advances ──► indexer observes mint
                       │
                       │ Mutav-BR files BACEN câmbio record on cessão event
                       ▼
                  (per regulatory.md § BACEN câmbio reporting)
```

- Single-counterparty flow. Etherfuse already holds the BCB license, runs the Pix infrastructure, and mints TESOURO. No additional vendor dependency for v1.
- The MED 2.0 quarantine pattern (per [`reliability.md`](reliability.md) § Quarantine windows) still applies — Mutav credits the agency only after the quarantine window elapses. The pre-funded TESOURO float decouples customer experience from quarantine latency.
- Etherfuse exposes SEP-6 (programmatic) and SEP-24 (interactive). Agency settlement uses SEP-6 — system-initiated, no hosted UI needed.

#### Hedge rail — BaaS providers (capacity / concentration insurance)

BaaS providers serve scenarios where the Etherfuse-only rail breaks down:

1. **Capacity constraint** — if Mutav's Pix-in volume exceeds Etherfuse's anchor capacity per window
2. **Incident or downtime** — operational continuity during an Etherfuse-side issue
3. **Concentration reduction** — diversifying away from a single counterparty as a defensive posture

The BaaS rail uses a three-call orchestration (Pix-In → Trade BRL → USDC → Crypto-Out to Stellar → Etherfuse mint TESOURO from USDC). It is a **multi-hop** that adds spread and a vendor — that's the cost of the hedge:

```
                            ┌────────────────────────────────┐
                            │     BaaS provider              │
                            │   (Transfero / Bitso /         │
                            │    Foxbit Prime / …)           │
                            └────────────────────────────────┘
                                  ▲           │
       ① Pay-In (Pix QR)          │           │ ④ webhook (event id + correlationId)
       Mutav-BR virtual account   │           │
                                  │           ▼
   Agency ────► Pix ──────────────┘     Convex (workflow step)
                                              │
                                              │ ② Trade (BRL → USDC, quote-then-execute)
                                              ▼
                                        BaaS Trade endpoint
                                              │
                                              │ ③ Crypto-Out (USDC to Mutav-Fund Stellar address)
                                              ▼
                                        Stellar
                                              │
                                              │ ⑤ Mutav-Mgmt swaps USDC → TESOURO via Etherfuse
                                              │   (Mutav-Fund treasury balance updated)
                                              ▼
                                        Mutav-Fund treasury balance updated
```

**Architectural commitments shared by both rails:**

1. **One Convex workflow per settlement.** Per [`reliability.md`](reliability.md) § Workflow durability — exactly-once mutations, at-least-once external calls with retry, journal-based recovery. Partial failure (Pix-in confirmed but mint or swap fails) is recoverable, not a silent inconsistency.
2. **Quarantine before treasury credit.** The BRL Pix-in lands in a `quarantine` state per [`reliability.md`](reliability.md) § Quarantine windows. Mutav does **not** issue agency credit (or fire downstream operations) until the quarantine window elapses — Pix MED 2.0 (mandatory 2026) allows up to 80-day fraud reversal with multi-hop tracking. The quarantine applies regardless of which rail delivered the BRL.
3. **Pre-funded TESOURO float decouples customer experience.** `Mutav-Fund` maintains a TESOURO float on Stellar (operated by `Mutav-Mgmt`); agency operations settle against the float instantly (post-Pix-confirmation but pre-quarantine-clear), while the BRL is in quarantine in `Mutav-BR`'s account. The float is replenished in batches once quarantine clears. Full pattern in [`reliability.md`](reliability.md) § Pre-funded float — float denomination is TESOURO, matching the treasury asset.
4. **Destination address allowlist server-side.** Wrong-address crypto delivery has no recovery. The provider stores `Mutav-Fund`'s treasury addresses in a beneficiary allowlist; the destination is never user-supplied.
5. **Correlation id is mandatory and end-to-end.** `Mutav-BR`'s `payments` row id → settlement provider's external reference → carried through every subsequent step → matched against the indexer-observed onchain mint into `Mutav-Fund`. The reconciliation primitive depends on this; see [`reliability.md`](reliability.md) § Three-axis reconciliation.
6. **Webhook reconciliation gap to verify per provider.** For each shortlisted vendor, confirm in sandbox whether crypto-delivery / mint events fire webhooks with the correlation id, or whether Mutav must poll.

**Commitments specific to the BaaS rail:**

- **Slippage caps on Trade calls.** USDC liquidity at BaaS providers is good but spread shocks during volatile periods are real; each Trade call carries an acceptable-slippage parameter; rejected trades alert and roll back.
- **USDC as the intermediate**, not BRZ. BRZ-as-intermediate adds a peg-stability concern Mutav doesn't need. BaaS providers that only offer BRZ as intermediate are lower-priority candidates.
- **TESOURO conversion is the final step** — once USDC lands at `Mutav-Fund`'s Stellar address, a `Mutav-Mgmt`-initiated Convex workflow step calls Etherfuse to swap USDC → TESOURO. The treasury never holds USDC for material duration.

**Vendor shortlist** lives in [`regulatory.md`](regulatory.md) § Settlement provider selection.

**Why Etherfuse-primary, BaaS-as-hedge.** TESOURO as treasury collapses the rationale for an intermediate stablecoin step. Etherfuse already owns the BRL ↔ TESOURO primitive; routing through a BaaS provider adds an FX spread, a vendor hop, and reconciliation surface for the same end state. The BaaS rail exists for resilience (capacity, concentration, incident hedge), not efficiency — match it to that purpose. Concentration on Etherfuse is the trade-off Mutav accepts in exchange for operational simplicity.

**Why this is distinct from purely investor flows.** Investor on-ramp is user-initiated (SEP-24 hosted UI, KYC step, single transaction). Agency settlement is system-initiated (SEP-6 programmatic, recurring monthly volume, decoupled customer experience via float). Same anchor counterparty for v1, two distinct integration shapes.

## Reconciliation

The highest-leverage reliability investment for any anchor-backed protocol. Mutav's pattern follows Circle Mint's published architecture: every offchain credit event carries a correlation id that propagates to the onchain operation it triggers; a periodic reconciliation job compares the two sides; mismatches trip the circuit breaker.

Full pattern, invariants, and failure modes are in [`reliability.md`](reliability.md) § Reconciliation. **Architectural commitment in this doc:** the anchor↔onchain mint path is designed for reconciliation from day one — `correlationId` flows from Etherfuse webhook → `payments` row → onchain mint event → indexer observation, end-to-end. A scheduled reconciliation action compares anchor-reported settled balance against onchain supply per fund per chain.

## Reliability primitives reference

The orchestration patterns this integration depends on:

| Need                                      | Convex primitive                       | Where used                                        |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Multi-step deposit / redeem orchestration | `@convex-dev/workflow`                 | Investor flows (see [`investor.md`](investor.md)) |
| Multi-step liquidation (5 steps)          | `@convex-dev/workflow`                 | Admin A3 (see [`admin.md`](admin.md))             |
| One-settlement-at-a-time per agency       | `@convex-dev/workpool`                 | Admin A4 when scoped                              |
| Single idempotent retry (NAV update)      | `@convex-dev/action-retrier`           | Admin NAV updates                                 |
| Per-chain polling                         | Convex cron + `scheduler.runAfter`     | Per-chain indexer module                          |
| Materialized financial totals             | `@convex-dev/aggregate` (already used) | UI dashboards, admin observability                |

Full guarantees, limits, and the **drain-before-deploy caveat** (changing workflow step shape breaks in-flight runs) are documented in [`reliability.md`](reliability.md). Any payment-affecting deploy must follow the runbook.

## The stub-first contract

The architectural promise that lets the portal and admin observability ship before the chain is real:

> **The UI reads Convex tables. The writer of those tables is unspecified.**

```
TODAY                                    TOMORROW
────────────────────                     ─────────────────────────
convex/seed.ts                           Indexer action (polling)
       │                                       │
       │ populate fundState                    │ populate fundState
       ▼                                       ▼
  Convex tables ─────────► UI            Convex tables ─────────► UI
                          ▲                                       ▲
                          │                                       │
                same query                            same query
                same shape                            same shape
                same reactive update                  same reactive update
```

- The Convex table schemas are designed once, at domain-design time
- A seed file populates them with realistic mock data (replacing the hardcoded `fund-data.ts` mock)
- The UI is wired to Convex queries — no `fund-data.ts` import in the runtime path
- When contracts deploy, the indexer action lands and starts overwriting seeded rows on its first run
- The seed file is kept for local dev / test environments where deploying contracts is overkill

The win: investor portal work and admin observability work can proceed in parallel with `mutav-stellar` development. Neither blocks the other.

## Failure model

| Failure                                         | Effect                                                               | Recovery                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Indexer action throws                           | Tables stale; `lastUpdatedAt` shows it                               | Next cron tick retries. If persistent → ops alert (alerting infra TBD)                                                            |
| RPC returns malformed data                      | Action validates, throws, no upsert                                  | Same as above. Convex tables never partially updated.                                                                             |
| Cursor lost / desync                            | Indexer re-derives from genesis or last known good cursor            | Documented re-derivation procedure in the per-chain module                                                                        |
| Chain reorg                                     | Confirmed values may shift                                           | Stellar finality is fast; reorgs are rare. Indexer re-derives from latest cursor on next tick.                                    |
| Multisig signers unavailable                    | Attested liquidations stay in `attested` state; chain unaffected     | Operational issue, not architectural. Surface via admin queue UI.                                                                 |
| Wallet kit incompatible with chain upgrade      | Investor writes fail                                                 | UI shows error; users can transact via any wallet directly with the contract. Non-custodial means there's always an escape hatch. |
| Duplicate webhook from anchor                   | None (idempotency at unique index)                                   | Idempotency guard returns early — see [`reliability.md`](reliability.md) § Idempotency                                            |
| Anchor confirms deposit but mint never observed | Reconciliation detects mismatch, circuit breaker pauses mint         | See [`reliability.md`](reliability.md) § Reconciliation                                                                           |
| Mint succeeds but indexer misses event          | Reconciliation detects mismatch (chain supply > Convex-known supply) | Indexer re-derives; backfill from chain                                                                                           |
| Workflow step shape changed mid-deploy          | In-flight workflows fail at the changed step                         | Drain-before-deploy procedure per [`reliability.md`](reliability.md) § Drain-before-deploy                                        |
| Per-chain module fails                          | Only that chain's funds are affected                                 | Per-chain isolation contains blast radius; other chains continue                                                                  |

## Out of scope for this doc

- Specific Soroban contract interfaces (lives in `mutav-stellar`)
- Specific Convex table schemas (lives in domain-design at implementation time)
- UI implementation details of the Mutav-built proposal queue (architectural commitment is the queue exists in `(admin)`; specific UI specs belong to A3/A6 implementation work — see [`admin.md`](admin.md))
- RPC provider selection (Stellar's public RPC vs self-hosted vs third-party)
- Indexer alerting and on-call procedures (operational, separate from architecture)
- Cost model for RPC usage at scale (operational, revisit when scale forces the question)
- Per-chain Soroban / SVM / EVM implementation details (chain-specific, each per-chain module's concern)
- Specific reconciliation cadence and tolerance thresholds (operational, in compliance runbook)

## Related reading

- [`entities.md`](entities.md) — `Mutav-Fund` owns custody, `Mutav-Mgmt` operates signers, `Mutav-BR` handles BR-side câmbio
- [`tranches.md`](tranches.md) — MTVH/MTVM/MTVL onchain representation, per-tranche custody contracts
- [`reliability.md`](reliability.md) — workflow durability, idempotency, three-axis reconciliation, audit log integrity, NAV safety
- [`regulatory.md`](regulatory.md) — offshore fund-admin segregation, per-entity multisig governance, KYC vendor criteria
- [`compliance.md`](compliance.md) — account-level gating that applies before any operation reaches this layer
- [`admin.md`](admin.md) — admin-side consumers (A3 liquidation, A4 fund payments, A5 observability)
- [`investor.md`](investor.md) — investor-side consumers (deposit, redeem, portfolio, Subscription Agreement with `Mutav-Fund`)
