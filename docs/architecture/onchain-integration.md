# Chain ↔ Convex Integration — Architecture

> The Mutav SA fund lives onchain (Stellar / Soroban for v1; additional chains in the future per [`investor.md`](investor.md)). The web app is offchain (Convex + Next.js). This document defines the boundary between them: how chain state becomes Convex tables (read path), how user and admin intents become onchain transactions (write path), the contract topology that satisfies the segregated-account model, and the stub-first contract that lets both sides ship independently. The infrastructure here is **shared** between Mutav Admin's A5 (fund observability) and the Investor portal's I2 (real fund data).

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

```
   Admin UI ── record attestation ──► Convex (delinquencies.attested, mutavAuditLog)
                  │
                  │ "open in multisig"
                  ▼
           External signing tool (Stellar Lab / dedicated multisig UI)
                  │
                  │ multisig signers sign
                  ▼
              Soroban contract
                  │
                  │
   indexer observes ── update delinquencies row to "executed"
```

- Mutav-admin in the (admin) shell attests a liquidation request (or any other treasury-affecting action)
- Convex records the attestation in the relevant domain (`delinquencies`, future `treasuryOps`, etc.) + audit log
- The Convex write does **not** initiate the onchain transaction. It surfaces a "ready to sign" link to the external multisig tool.
- Multisig signers (could be Mutav employees, board members, external custodians — defined offchain) sign through the multisig tool
- Onchain execution happens when the signature threshold is met
- The indexer observes the execution and flips the Convex-side state from `attested` to `executed`

Convex's role is intent + bookkeeping. Custody is the multisig, owned by people outside the app deployment.

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

CVM 175 (and the Mutav whitepaper) commit to a Segregated Account structure: investor capital is legally and operationally separated from protocol operations. This is not just a legal artifact — it must be enforced in the contract topology onchain. The architectural commitment, per chain:

```
┌────────────────────────────────────────────────────────┐
│                   Mutav SA on {chain}                  │
│                                                        │
│   ┌──────────────────────┐    ┌──────────────────┐     │
│   │  Custody contract    │    │  Operations      │     │
│   │  (per risk tier)     │◄───┤  contract        │     │
│   │                      │    │                  │     │
│   │ • Holds investor     │    │ • Mint authority │     │
│   │   capital            │    │ • Redeem queue   │     │
│   │ • Issues MUTAV       │    │ • NAV updater    │     │
│   │   tokens             │    │ • Liquidation    │     │
│   │ • Narrow interface   │    │   executor       │     │
│   │   (deposit / redeem) │    │ • Multisig-gated │     │
│   └──────────────────────┘    └──────────────────┘     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Invariants the topology enforces:**

- **One custody contract per fund (per risk tier).** Low-risk, medium-risk, and high-risk funds each have their own custody contract. Cross-fund contamination is impossible at the protocol level — a default in the high-risk fund cannot drain the low-risk fund.
- **Operations contracts are subordinate.** Operations contracts hold no investor capital. They have approval-gated authority to invoke custody operations (mint on deposit, burn on redeem, transfer-out on liquidation) but cannot move capital except through these narrow entry points.
- **Multisig gates operations.** Operations contracts that affect treasury (NAV update, liquidation, mint authority changes) require multisig consensus per [`reliability.md`](reliability.md) and [`regulatory.md`](regulatory.md). Single-actor authority does not exist.
- **Topology is verifiable.** External auditors can verify the separation by reading the contract registry — the architecture commits to publishing the contract addresses and their relationships in a public manifest.

This is architecture, not implementation. The actual Soroban contracts (and equivalent contracts on future chains) live in `mutav-stellar` and follow this topology. The doc commits to what the topology must enforce; it does not specify contract signatures.

## External integrations

Every external system that pushes events into Convex (anchor webhooks, KYC vendor callbacks, chain-event bridges, future payment processor webhooks) goes through a hardened ingestion path. The rules:

1. **Signature verification first.** The HTTP action that receives the webhook validates the provider's signature before any business logic runs. Unsigned webhook endpoints don't exist.
2. **Idempotency by external event id.** Every webhook payload carries a provider event id (Etherfuse `event_id`, KYC vendor `request_id`, Stellar event `paging_token`). The ingest mutation uses a unique-index guard on this id — duplicate webhooks are dropped at the storage layer, no business logic runs twice. See [`reliability.md`](reliability.md) § Idempotency.
3. **Replay window enforcement.** Webhook timestamps that fall outside an acceptable window (default: ±5 minutes from server time) are rejected to prevent replay of captured payloads.
4. **Secret rotation is documented.** Webhook secrets are stored via the env-var pattern (`convex/lib/env.ts` lazy getters per [CLAUDE.md § "Environment variables"](../../CLAUDE.md)), with documented rotation procedures.
5. **Per-provider HTTP action.** Each external integration has its own action endpoint, never a shared catch-all. Vendor-specific signature schemes and error semantics stay isolated.

For Mutav today, the integrations that need this hardening: **Etherfuse webhooks** (Pix deposit confirmations, KYB status changes), **KYC vendor callbacks** (when one is selected — see [`compliance.md`](compliance.md)), **Stellar event ingestion** (when polling is replaced with event subscription per § Read architecture). The pattern is the same; only the per-provider verification routine differs.

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
- Choice of multisig tool (Stellar Lab vs custom vs other — operational; see [`regulatory.md`](regulatory.md) for governance constraints)
- RPC provider selection (Stellar's public RPC vs self-hosted vs third-party)
- Indexer alerting and on-call procedures (operational, separate from architecture)
- Cost model for RPC usage at scale (operational, revisit when scale forces the question)
- Per-chain Soroban / SVM / EVM implementation details (chain-specific, each per-chain module's concern)
- Specific reconciliation cadence and tolerance thresholds (operational, in compliance runbook)

## Related reading

- [`reliability.md`](reliability.md) — workflow durability, idempotency, reconciliation, audit log integrity, NAV safety
- [`regulatory.md`](regulatory.md) — CVM segregated account topology, multisig governance, KYC vendor criteria
- [`compliance.md`](compliance.md) — account-level gating that applies before any operation reaches this layer
- [`admin.md`](admin.md) — admin-side consumers (A3 liquidation, A4 fund payments, A5 observability)
- [`investor.md`](investor.md) — investor-side consumers (deposit, redeem, portfolio)
