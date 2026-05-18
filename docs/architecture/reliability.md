# Reliability Primitives — Architecture

> Cross-cutting primitives that every Mutav surface depends on: reconciliation, idempotency, durable orchestration, bounded parallelism, audit-log integrity, and NAV safety. These are not features of any one pillar — they are the substrate. [`admin.md`](admin.md), [`investor.md`](investor.md), and [`onchain-integration.md`](onchain-integration.md) reference this document rather than re-explaining each primitive.

Every primitive here has a documented industry analog or a Convex-native component. None are speculative. None require custom infrastructure beyond what the Convex ecosystem already provides.

## Reconciliation

The most important primitive for any system that moves money across two ledgers (anchor BRL float ↔ onchain token supply, agency invoice ↔ Mutav SA balance, redemption queue ↔ executed burns). Without it, mismatches accumulate silently and surface as audit nightmares.

### The pattern (Circle Mint)

Every offchain credit event carries a correlation id (`bankRef`, `pixRef`, `anchorTxId` — name varies, role is the same). The id propagates to the onchain operation it triggers. A periodic reconciliation job compares the two sides:

```
Anchor / external ledger          Mutav (Convex)                   Onchain
───────────────────────           ────────────────                  ──────────────
Pix deposit                       payments row created              (no event yet)
  ↓ webhook                       with anchorTxId                       ↓
                                       ↓                            mint(bankRef=anchorTxId)
                                  workflow waits for                     ↓
                                  mint observation                  indexer observes
                                                                    mint event
                                       ↓                                 ↓
                                  reconciliation job: every N min, query
                                  anchor for "all completed deposits since cursor",
                                  match against onchain mints by correlation id.
                                  Discrepancies → alert + pause mint
```

### Invariants

- **Every onchain mint references a correlation id from the offchain source.** No anchor-less mints; no orphan mints.
- **The reconciliation job is the source of truth for "all books reconciled".** It runs independently of the mint flow itself.
- **Mismatches trip a circuit breaker.** Mint pauses; humans investigate. False positives are acceptable; missed mismatches are not.
- **The reconciliation cursor is persisted.** Job survives Convex restarts, picks up from the last reconciled point.

### Failure modes the reconciliation primitive catches

| Failure                                  | Without reconciliation               | With reconciliation                                                       |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Anchor confirms deposit, mint tx fails   | Stuck deposit, agency capital locked | Detected on next reconciliation run; mint retried                         |
| Mint succeeds, indexer misses event      | UI shows "pending" forever           | Detected — chain shows mint, Convex doesn't; row backfilled               |
| Anchor double-confirms (network glitch)  | Double-mint                          | Idempotency catches at write; reconciliation catches if idempotency fails |
| Anchor support manually reverses deposit | Onchain supply doesn't match custody | Detected, mint paused, treasury operation reverses onchain side           |

Reconciliation is the **highest-leverage reliability investment** for an anchor-backed protocol. Build it before you need it.

## Quarantine windows (reversible offchain credit events)

Pix is irrevocable for normal settlement, but **MED 2.0 (Mecanismo Especial de Devolução)** — mandatory in Brazil from **February 2026, penalties from May 2026** — allows up to **80 days** of fraud-driven reversal with multi-hop tracking across intermediate accounts. R$6.5B was reversed in 2025. Onchain settlement is **not** reversible; if Mutav mints crypto against a Pix that later gets MED-reversed, the protocol absorbs the loss.

This is not unique to Brazil. The same primitive applies anywhere offchain credit events can be reversed by the upstream system: SEPA SDD reversibility (8-week claim window in EU), ACH return codes (60 days in US), credit-card chargebacks (60–180 days depending on scheme).

### The pattern

Offchain credit events flow through three states before triggering onchain settlement:

```
Pix received          Quarantine window           Settled
(BaaS webhook)        (no onchain action)         (mint / treasury credit)
     │                                                  ▲
     │                     N days                       │
     └────────────── delay ──────────────────────────────┘

   ┌── if MED reversal arrives during window ──► canceled, no onchain action
   └── if window elapses without reversal ────► proceed to settle
```

### Architectural commitments

- **Every reversible credit event sits in a `quarantine` state** before becoming a settled event. The quarantine duration is policy (TBD per credit type — Pix shorter than the full 80 days if treasury appetite allows; SEPA SDD ~8 weeks; etc.).
- **Quarantined events still produce audit log entries** but do not trigger downstream actions (mint, treasury credit, agency-balance update).
- **Reversal handlers cancel quarantined events idempotently.** When the BaaS provider notifies of an MED, the matching event flips to `canceled`; if the event already settled (quarantine elapsed), the cancel handler triggers an offsetting treasury operation rather than a silent rollback — chain state is preserved, the loss is accounted for explicitly.
- **The reconciliation primitive accounts for quarantined events separately.** "Pix balance" splits into `pending_quarantine`, `settled`, and `reversed` buckets, each reconciled against the relevant rail.
- **Pre-funded treasury float as the customer-facing decoupler.** Mutav maintains a USDC float on the destination chain large enough to settle agency operations against immediately, while the corresponding BRL Pix sits in quarantine. The float is replenished in batches once quarantine clears. The customer sees instant settlement; Mutav holds the chargeback risk against the float's accumulated reserve. This is the production pattern (Bitso, Wise, Circle Settlements all do variants of it).

### Pre-funded float — sizing rules of thumb

- **Cap per operation < float / N** where N is the number of operations expected within the quarantine window. Prevents float exhaustion from a single bad day.
- **Reserve ratio matches observed reversal rate × 3** as a buffer (a 0.5% historical reversal rate suggests holding ~1.5% of float liquid for chargebacks).
- **Alert thresholds at 50% / 80% / 95% of float depletion**, plus pre-defined replenishment workflow per Convex `@convex-dev/workflow`.

**Float denomination for Mutav:** Mutav SA's treasury asset is **TESOURO** (Etherfuse's tokenized Brazilian Treasury bonds — BRL-denominated, yield-bearing). The pre-funded float therefore holds TESOURO rather than USDC. Trade-off vs a USDC float: TESOURO accrues yield while sitting in float (no opportunity cost), and matches the treasury denomination (no FX leg), but liquidity for emergency replenishment depends on Etherfuse's secondary market depth. A small auxiliary BRL float at Etherfuse (or at the BaaS provider if one is in the loop) absorbs same-day Pix-in events that haven't cleared quarantine yet.

Float sizing is operational policy, not architecture. The architectural commitment is the float exists as a concept and the quarantine state is enforced before the float is debited.

## Idempotency

Required everywhere a webhook, scheduled action, or workflow step might re-execute. Convex doesn't ship an idempotency-key component; the pattern uses unique indexes.

### The pattern

For any operation triggered by an external event:

1. The external system provides an event id (Etherfuse `event_id`, KYC provider `request_id`, Stellar tx `hash`)
2. The Convex domain that ingests the event has a table with a unique index on the external id
3. The ingest mutation does `insert`-then-catch — if the index conflict fires, the event was already processed, return early

```
withIndex("by_external_id", q => q.eq("externalId", event.id))
```

Convex mutations are full ACID transactions; the unique-index check and the downstream writes commit atomically. There is no race window between "is this duplicate" and "process it".

### What it covers

- **WebSocket client retries** are already idempotent — Convex's client records a mutation id and the server dedupes. Use the standard `useMutation` hook; don't roll your own.
- **Workflow steps** are inherently idempotent — the workflow journal replays cached results on retry. You don't add idempotency to step bodies.
- **Webhook handlers and cron actions** need the unique-index pattern explicitly. The wrapper that ingests the webhook does the dedupe.
- **Scheduled actions that wake up to do a thing** (poll the anchor, run reconciliation) carry their own state and don't need per-event idempotency, but their writes do.

### What it doesn't cover

User intent. If a user clicks "Deposit" twice, both clicks reach the mutation as distinct events and both produce distinct deposit intents. Intent-level deduplication is UI responsibility (disable the button while submitting, show pending state).

## Workflow durability

For multi-step flows where partial failure must be recoverable: investor deposit (await wallet sign → await indexer confirmation → update position), redeem (KYC check → queue placement → await execution → update balance), admin liquidation (5 steps from agency notification to onchain execution), agency onboarding (await documents → compliance review → KYB submission → activation).

### When to use what

| Need                                                      | Primitive      | Component                                                      |
| --------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| Multi-step with checkpoints, retries, human-in-the-loop   | Workflow       | `@convex-dev/workflow`                                         |
| Bounded parallelism (one settlement at a time per agency) | Workpool       | `@convex-dev/workpool`                                         |
| Retry one idempotent action with backoff                  | Action retrier | `@convex-dev/action-retrier`                                   |
| Fire-and-forget single execution                          | Scheduler      | `ctx.scheduler.runAfter` (built-in)                            |
| O(log n) sums/counts on indexed data                      | Aggregate      | `@convex-dev/aggregate` (already used for `contractsByStatus`) |

### Workflow guarantees

`@convex-dev/workflow` provides:

- **Mutations: exactly-once** — Convex's ACID transactions + OCC retries make this atomic
- **Actions: at-least-once with retry** — configurable `maxAttempts`, `initialBackoffMs`, exponential `base`. Action bodies must be idempotent
- **`onComplete` handler: exactly-once** — useful for cleanup, notifications
- **Crash recovery: journal-based** — workflow resumes from last checkpoint after Convex restart
- **Observability: live status** — UI subscribes to workflow status via reactive query

### Limits worth knowing

- 1 MB total data per workflow run; 8 MiB journal cap
- No `fetch` / `crypto` / env access in the workflow handler — only inside steps
- **Changing the shape of a step (signature, name, count) breaks in-flight workflows** — this is a determinism requirement, not a bug

### Drain-before-deploy

The last limit matters operationally. When workflows are live and a deploy changes a step's shape, in-flight runs fail. The mitigation:

- **Versioned step names** for non-trivial changes (`processDeposit_v2` alongside `processDeposit_v1` until v1 drains)
- **Drain windows** before high-impact deploys — pause new workflow starts, wait for in-flight to complete, deploy
- **Compatibility-first changes** — additive args (with defaults), no removed steps, no renamed steps

Document the chosen strategy in the runbook before any payment workflow goes live. Convex's docs cover the patterns; pick one and stick to it.

## Bounded parallelism

Convex uses OCC (optimistic concurrency). When two mutations write the same row, one retries. At low volume this is invisible. At high volume on a hot tenant (an agency processing hundreds of settlements concurrently), retries cascade and throughput collapses.

`@convex-dev/workpool` serializes execution per tenant key. Configure one pool per agency for write-heavy flows:

- Settlement writes for agency X go through the agency-X pool
- The pool processes them in order; OCC conflicts disappear
- Independent agencies process in parallel
- Backpressure is observable; pool depth surfaces in admin tooling

The decision rule: if you can write a query that surfaces "writes to this row in the last second" and the count is reliably >1 in production, the row needs workpool isolation. For Mutav this applies to per-agency `payments` aggregation and per-fund `redemptionQueue` updates.

## Audit log integrity

The floor is append-only-by-convention (no `update` / `delete` mutations on the audit table). The bar for a regulated financial product is higher.

### Why append-only-by-convention is not enough

A Convex compromise (compromised deploy key, malicious insider with deploy access) could ship a deploy that rewrites historic audit rows or adds a `delete` mutation. There would be no cryptographic evidence of the tampering. For internal use this is acceptable; for CVM defensibility it is not.

### Hash-chained log

Every audit entry carries:

- `prevHash` — hash of the previous entry in the chain (or the null hash for the genesis entry)
- `hash` — hash of (this entry's body + `prevHash`)

Tampering with an old entry invalidates every subsequent `prevHash`, making detection trivial. The chain is verified by walking it forward and recomputing hashes. The verifier doesn't need access to write history — only to the current rows.

### Merkle anchoring

Every N hours (start: daily), a Convex cron computes the Merkle root of all audit entries since the last anchor and submits it as a no-op transaction to Stellar (memo or contract event). External auditors:

1. Re-derive the Merkle tree from the audit table at any past anchor point
2. Compare the derived root to the onchain anchor
3. If they match, the log was unmodified up to that anchor

The cost is one Stellar transaction per anchor period — trivial. The defensibility upgrade is substantial. This pattern matches **SEC Rule 17a-4** (2022 amendment) recognition of hash chains + Merkle trees as alternatives to WORM storage.

### Coverage rules

- **Every write performed by a Mutav-admin handler** goes to the audit log. The `mutationWithMutavStaff` wrapper writes the audit row before returning; handlers cannot bypass it.
- **Every onchain treasury operation** (NAV update, liquidation, multisig signer change) produces an audit entry with the resulting tx hash.
- **Every state-affecting integration event** (anchor webhook, KYC vendor callback) produces an audit entry on receipt.
- **Agency-side audit log is separate.** Agencies see their own changes, never Mutav's internal audit log.

## NAV safety

NAV is the per-share value of a fund. Wrong NAV = wrong mint amount or wrong redeem amount = direct loss to investors. The whitepaper specifies that NAV is computed onchain; this section covers the off-chain bookkeeping that feeds it and the safeguards that bound what can happen.

### Why a DEX-style oracle is the wrong primitive

Mango Markets (Oct 2022, $117M) — naive median of three spot exchanges; attacker manipulated thin venue, drained protocol. Curve read-only reentrancy (2023) — `get_virtual_price` returned inconsistent state mid-call; dForce lost $3.7M. These are the most-prosecuted DeFi failure class.

For Mutav, the NAV's inputs are **two exogenous, well-defined sources**: (a) rental-guarantee fee income (BRL flows from agencies, deterministic from contract state), and (b) treasury yield from TESOURO (BRL Treasury bond yield, set by the Brazilian government — not a market oracle). Neither is a DEX-quoted price; neither can be manipulated by a thin-venue attacker. The Mango / Curve oracle-manipulation failure class is **architecturally inapplicable** here — a meaningful win.

What remains is the discipline of _computing_ NAV correctly from those inputs and recording the inputs in the audit log so external auditors can reproduce. The safeguards below ensure that discipline.

### Push-only NAV updates

NAV is updated by a designated `treasury` role on `mutavStaff`, through the Mutav admin UI, with multisig signing for the onchain commit:

1. Treasury role computes new NAV inputs (active layer value, liquidity layer value, outstanding shares) using Mutav SA's bookkeeping
2. Submits the proposed NAV through the admin UI
3. Convex records the proposal with the inputs in the audit log
4. Multisig signers approve the onchain NAV-update transaction
5. Indexer observes the update, fundState row reflects the new value

### Safeguards

- **Per-epoch change cap.** NAV cannot move more than X% per update. Larger changes require explicit override + additional signers.
- **Monotonicity invariants where they apply.** The active layer's yield accrual is one-way (rent fees only add). Anomalous decreases trip pause.
- **Pause-on-deviation circuit breaker.** If the indexer observes an onchain NAV that differs from the most-recent Convex-recorded proposal by more than tolerance, mint and redeem pause. Humans investigate.
- **Audit log captures inputs.** Not just the resulting NAV — the proposal carries active layer, liquidity layer, outstanding shares, so the computation is reproducible by external auditors at any point in history.
- **No automated NAV updates.** No cron writes NAV. Human-triggered with multisig consensus, always.

> 📌 **Pending input from Draau (treasury policy owner):** epoch length (daily? per-block? on-demand?), per-epoch change-cap percentage (X), pause-on-deviation tolerance percentage, off-NAV operations policy during a paused state. Policy decisions, not architecture decisions — the architecture enforces whatever Draau commits to. Values live in the compliance runbook once defined. Same pin in [`admin.md`](admin.md) § A6.

## What this doc is not

- A spec for any of the Convex tables involved (those live in domain.ts files when each domain is built)
- A choice of multisig tool (Stellar Lab vs custom; operational, see [`regulatory.md`](regulatory.md) for considerations)
- A spec of NAV bounds or epoch length (treasury policy, set by humans, documented in runbook)
- An incident-response playbook (operational, separate from architecture)

## Related reading

- [`onchain-integration.md`](onchain-integration.md) — uses reconciliation, idempotency, per-chain indexer module pattern
- [`admin.md`](admin.md) — uses workflow durability (liquidation), audit log integrity (hash chain), NAV safety
- [`investor.md`](investor.md) — uses workflow durability (deposit/redeem)
- [`regulatory.md`](regulatory.md) — names which of these primitives satisfy which regulator's expectations
- [Convex Workflow](https://github.com/get-convex/workflow) · [Workpool](https://github.com/get-convex/workpool) · [Action Retrier](https://github.com/get-convex/action-retrier) · [Aggregate](https://github.com/get-convex/aggregate)
- [Stack: Durable Workflows](https://stack.convex.dev/durable-workflows-and-strong-guarantees)
- [Trillian](https://transparency.dev/) — reference verifiable append-only log
- SEC Rule 17a-4(f) (2022 amendment) — regulatory anchor for cryptographic audit trails
