# Reliability Primitives — Architecture

> Cross-cutting primitives that every Mutav surface depends on: reconciliation (three-axis, cross-entity), idempotency, durable orchestration, bounded parallelism, audit-log integrity (entity-tagged), and per-tranche NAV safety. These are not features of any one pillar — they are the substrate. [`admin.md`](admin.md), [`investor.md`](investor.md), and [`onchain-integration.md`](onchain-integration.md) reference this document rather than re-explaining each primitive. The three-entity model from [`entities.md`](entities.md) shows up here as cross-entity reconciliation axes and entity-tagged audit entries.

Every primitive here has a documented industry analog or a Convex-native component. None are speculative. None require custom infrastructure beyond what the Convex ecosystem already provides.

## Reconciliation

The most important primitive for any system that moves money across multiple ledgers. With the three-entity model (see [`entities.md`](entities.md)), Mutav reconciles across three independent axes — see § Three-axis reconciliation below.

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

### Three-axis reconciliation

The three-entity model from [`entities.md`](entities.md) means reconciliation runs across three independent axes — each catches a different class of mismatch:

```
   Axis 1: Mutav-BR BRL ledger ←──→ collected agency fees (Etherfuse / BaaS confirmed)
                                       │
                                       │ (catches: missing Pix-in, BaaS provider drift,
                                       │  agency dispute, MED reversal not applied)
                                       ▼

   Axis 2: Mutav-BR 80% cessão outflow ←──→ Mutav-Fund TESOURO mint inflow
                                       │
                                       │ (catches: cessão recorded but mint never landed,
                                       │  duplicate mint, wrong-tranche assignment,
                                       │  câmbio reporting mismatch)
                                       ▼

   Axis 3: Mutav-Fund recorded position ←──→ on-chain TESOURO balance at fund's Stellar address
                                       │
                                       │ (catches: indexer lag, chain reorg, mint event missed,
                                       │  TESOURO transfer out without record)
                                       ▼

                                   Three independent reconciliation jobs;
                                   each axis pauses its own affected operations
                                   on detected mismatch.
```

**Axis-1 reconciler** runs on `Mutav-BR`'s schedule (typically daily, aligned to BR business days). Owned by `Mutav-BR` ops. Mismatches pause new agency Pix collection.

**Axis-2 reconciler** runs on the cessão batch cadence (typically monthly, matching the cessão event schedule). Owned by `Mutav-BR` × `Mutav-Mgmt` (cross-entity audit log entry per `reliability.md` § Audit log integrity). Mismatches pause new cessão operations and trigger the BACEN câmbio reporting workflow's correction path.

**Axis-3 reconciler** runs continuously (every N minutes per chain). Owned by `Mutav-Mgmt`. Mismatches pause mint / redeem operations on the affected tranche (per [`tranches.md`](tranches.md) § Redemption queue semantics) and surface for treasury review.

**Why three axes, not one composite check.** A composite "agency fee → on-chain mint" check would fire on any mismatch across the chain, masking which leg failed. Splitting the axes localizes the diagnosis: an Axis-2 mismatch with Axis-1 and Axis-3 clean means the cessão step itself is broken (specific operations team to involve); an Axis-3 mismatch with Axis-1 and Axis-2 clean means an indexer issue. Faster mean-time-to-resolve.

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

- **Every reversible credit event sits in a `quarantine` state** before becoming a settled event. The quarantine duration is policy per credit type — for Pix specifically, see the [Pending Treasury Decisions pack § Decision 3](pending-treasury-decisions.md#decision-3--pix-quarantine-window-length) (7/30/80-day options with trade-offs); SEPA SDD ~8 weeks; etc.
- **Quarantined events still produce audit log entries** but do not trigger downstream actions (mint, treasury credit, agency-balance update).
- **Reversal handlers cancel quarantined events idempotently.** When the BaaS provider notifies of an MED, the matching event flips to `canceled`; if the event already settled (quarantine elapsed), the cancel handler triggers an offsetting treasury operation rather than a silent rollback — chain state is preserved, the loss is accounted for explicitly.
- **The reconciliation primitive accounts for quarantined events separately.** "Pix balance" splits into `pending_quarantine`, `settled`, and `reversed` buckets, each reconciled against the relevant rail.
- **Pre-funded treasury float as the customer-facing decoupler.** `Mutav-Fund` maintains a TESOURO float on Stellar (operated by `Mutav-Mgmt`) large enough to settle agency operations against immediately, while the corresponding BRL Pix sits in quarantine in `Mutav-BR`'s account. The float is replenished in batches once quarantine clears and the cessão is executed. The customer sees instant settlement; `Mutav-Fund` holds the chargeback risk against the float's accumulated reserve. This is the production pattern (Bitso, Wise, Circle Settlements all do variants of it).

### Pre-funded float — sizing rules of thumb

- **Cap per operation < float / N** where N is the number of operations expected within the quarantine window. Prevents float exhaustion from a single bad day.
- **Reserve ratio matches observed reversal rate × 3** as a buffer (a 0.5% historical reversal rate suggests holding ~1.5% of float liquid for chargebacks).
- **Alert thresholds at 50% / 80% / 95% of float depletion**, plus pre-defined replenishment workflow per Convex `@convex-dev/workflow`.

**Float denomination for Mutav:** `Mutav-Fund`'s treasury asset is **TESOURO** (Etherfuse's tokenized Brazilian Treasury bonds — BRL-denominated, yield-bearing). The pre-funded float therefore holds TESOURO rather than USDC. Trade-off vs a USDC float: TESOURO accrues yield while sitting in float (no opportunity cost), and matches the treasury denomination (no FX leg), but liquidity for emergency replenishment depends on Etherfuse's secondary market depth. A small auxiliary BRL float at Etherfuse (held by `Mutav-BR`, or at the BaaS provider if one is in the loop) absorbs same-day Pix-in events that haven't cleared quarantine yet.

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

The decision rule: if you can write a query that surfaces "writes to this row in the last second" and the count is reliably >1 in production, the row needs workpool isolation. For Mutav this applies to per-agency `payments` aggregation and per-fund-tranche `redemptionQueue` updates.

## Cross-entity flows

Three flows cross entity boundaries (per [`entities.md`](entities.md)) and need special workflow + audit-log discipline. Each is implemented as a single `@convex-dev/workflow` with the entity boundary explicit in the step structure.

### Monthly fee split (agency → `Mutav-BR` → `Mutav-Fund`)

```
Agency invoice paid (Pix)
      │
      ▼
[Mutav-BR step] Pix landed in BR account; enter quarantine
      │  audit: MUTAV_BR.pix_received
      ▼
... (quarantine window elapses per Decision 3) ...
      │
      ▼
[Mutav-BR step] Recognize 20% as revenue; book 80% as cessão receivable
      │  audit: MUTAV_BR.revenue_recognized + MUTAV_BR.cessao_booked
      ▼
[Mutav-BR step] File BACEN câmbio reporting record
      │  audit: MUTAV_BR.cambio_filed
      ▼
[Mutav-Fund step] Initiate Etherfuse SEP-6 mint into Fund's Stellar address
      │  audit: MUTAV_FUND.mint_initiated
      ▼
[Mutav-Mgmt step] Multisig-sign the mint authorization (if required by tier)
      │  audit: MUTAV_MGMT.mint_signed
      ▼
[Indexer step] Observe TESOURO mint event on Stellar
      │  audit: MUTAV_FUND.mint_observed
      ▼
[Mutav-Mgmt step] Recompute and propose new per-tranche NAVs
      │  audit: MUTAV_MGMT.nav_proposed
      ▼
[Workflow complete] correlationId preserved end-to-end across 7 audit entries
```

### Default coverage (`Mutav-BR` notification → `Mutav-Fund` liquidation → `Mutav-BR` payout)

```
[Mutav-BR step] Agency reports default; pre-check contract eligibility
      │  audit: MUTAV_BR.default_received
      ▼
[Cross-entity step] Mutav-Mgmt attests liquidation request (admin queue)
      │  audit: MUTAV_MGMT.liquidation_attested
      ▼
[Mutav-Mgmt step] Mutav-Mgmt multisig signs TESOURO burn at Etherfuse
      │  audit: MUTAV_MGMT.burn_signed + MUTAV_FUND.burn_executed
      ▼
[Mutav-Fund step] Waterfall: MTVH NAV absorbs first, propagates if exhausted
      │  audit: MUTAV_FUND.waterfall_applied (per tranche)
      ▼
[Mutav-BR step] BRL arrives in Mutav-BR account from Etherfuse redemption
      │  audit: MUTAV_BR.brl_received + MUTAV_BR.cambio_filed (return leg)
      ▼
[Mutav-BR step] Disburse to imobiliária / proprietário
      │  audit: MUTAV_BR.disbursed
      ▼
[Workflow complete] every step logged with originating entity code;
                   liquidation event reconciles against Axis-3 reconciler
```

### Investor deposit / redeem (investor → `Mutav-Fund` direct)

This flow is unique in that `Mutav-BR` isn't in the path — investors interact with `Mutav-Fund` directly via Subscription Agreement (see [`investor.md`](investor.md)). Only the BR-investor variant has a `Mutav-BR` câmbio reporting leg:

```
Investor selects tranche (MTVH / MTVM / MTVL) and submits deposit
      │
      ▼
[Mutav-Fund step] Pre-flight compliance check (level + risk + tranche eligibility)
      │  audit: MUTAV_FUND.deposit_intent
      ▼
... investor signs in wallet; tx submitted to Stellar ...
      │
      ▼
[Indexer step] Observe mint event for chosen tranche
      │  audit: MUTAV_FUND.tranche_minted
      ▼
[Conditional: BR investor only]
[Mutav-BR step] File BACEN câmbio reporting record (cross-jurisdiction inflow)
      │  audit: MUTAV_BR.cambio_filed (investor leg)
      ▼
[Mutav-Mgmt step] Update Fund position; next NAV proposal reflects new outstanding
      │  audit: MUTAV_MGMT.position_updated
      ▼
[Workflow complete]
```

Redeem mirrors deposit in reverse; the câmbio leg fires for BR investors on the outflow.

### Why cross-entity steps need their own attestation primitive

A workflow that crosses entities cannot rely on a single signer's authority — each entity is a separate legal vehicle with its own multisig signer set per [`regulatory.md`](regulatory.md) § Multisig governance. The cross-entity step requires attestations from both entities, logged separately, with the correlation id tying them together. This is more than just "one transaction with two signers" — it's two independent attestations that the workflow must collect before advancing.

The architecture supports this via a `cross_entity_attestation` table that pairs entity codes with attestation events. A workflow step that needs cross-entity authority sleeps until both attestations land. Treat this as a workflow building block; specific operations (liquidation, signer-set change, large cessão) are use cases.

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

### Entity tagging

Every audit log entry carries an `entity` column with one of `MUTAV_BR` / `MUTAV_FUND` / `MUTAV_MGMT` (per [`entities.md`](entities.md)), reflecting which entity initiated the operation. This:

- Lets regulators query the log filtered to their entity of interest (BACEN inquires about `MUTAV_BR` flows; CVM about `MUTAV_FUND` offerings; the offshore regulator about `MUTAV_MGMT` admin acts) without seeing irrelevant cross-entity noise
- Enables per-entity reconciliation reports (axis-1 reconciler queries `MUTAV_BR.pix_received` and `MUTAV_BR.revenue_recognized`; axis-2 queries the cessão pair `MUTAV_BR.cessao_booked` + `MUTAV_FUND.mint_observed`)
- Maintains forensic clarity when a cross-entity workflow produces interleaved entries — the entity tag distinguishes "Mutav-BR booked the cessão" from "Mutav-Fund received the mint" even when they share a correlation id

Cross-entity operations (where both entities act) produce two entries — one per entity — with the same correlation id linking them.

## NAV safety

NAV is the per-share value of a fund. Wrong NAV = wrong mint amount or wrong redeem amount = direct loss to investors. The whitepaper specifies that NAV is computed onchain; this section covers the off-chain bookkeeping that feeds it and the safeguards that bound what can happen.

### Why a DEX-style oracle is the wrong primitive

Mango Markets (Oct 2022, $117M) — naive median of three spot exchanges; attacker manipulated thin venue, drained protocol. Curve read-only reentrancy (2023) — `get_virtual_price` returned inconsistent state mid-call; dForce lost $3.7M. These are the most-prosecuted DeFi failure class.

For Mutav, the NAV's inputs are **two exogenous, well-defined sources**: (a) rental-guarantee fee income (BRL flows from agencies, deterministic from contract state), and (b) treasury yield from TESOURO (BRL Treasury bond yield, set by the Brazilian government — not a market oracle). Neither is a DEX-quoted price; neither can be manipulated by a thin-venue attacker. The Mango / Curve oracle-manipulation failure class is **architecturally inapplicable** here — a meaningful win.

What remains is the discipline of _computing_ NAV correctly from those inputs and recording the inputs in the audit log so external auditors can reproduce. The safeguards below ensure that discipline.

### Push-only NAV updates (per tranche)

NAV is updated by a designated `treasury` sub-role on `mutavStaff` (the sub-role serves `Mutav-Mgmt` per [`compliance.md`](compliance.md)), through the Mutav admin UI, with multisig signing for the onchain commit. **Each NAV update produces three new per-tranche NAVs** (one each for MTVH / MTVM / MTVL per [`tranches.md`](tranches.md)), not one. The five-step flow runs once per update event:

1. Treasury role computes new per-tranche NAV inputs (per-tranche active layer value, liquidity layer value, outstanding shares) using `Mutav-Mgmt`'s bookkeeping for the Fund (separate from `Mutav-BR`'s own books)
2. Submits the proposed NAVs through the admin UI (three values; one event)
3. Convex records the proposal with the inputs in the audit log (tagged with entity codes `MUTAV_MGMT` proposing and `MUTAV_FUND` affected)
4. `Mutav-Mgmt` multisig signers approve the onchain NAV-update transaction
5. Indexer observes the update, `fundState` rows (one per tranche) reflect the new values

### Safeguards

- **Per-tranche per-epoch change cap.** Each tranche's NAV cannot move more than X% per update; the cap may differ per tranche (MTVH legitimately moves more under loss-waterfall pressure than MTVL). Larger changes require explicit override + additional signers.
- **Monotonicity invariants where they apply.** The active layer's yield accrual is one-way (rent fees only add, distributed pro-rata across tranches). Anomalous per-tranche decreases (outside the waterfall mechanics) trip pause.
- **Per-tranche pause-on-deviation circuit breaker.** If the indexer observes an onchain NAV that differs from the most-recent Convex-recorded proposal by more than tolerance, mint and redeem pause on the affected tranche specifically — other tranches continue unless the deviation cascades through the waterfall.
- **Audit log captures inputs.** Not just the resulting per-tranche NAVs — the proposal carries per-tranche active layer, liquidity layer, outstanding shares, so the computation is reproducible by external auditors at any point in history.
- **No automated NAV updates.** No cron writes NAV. Human-triggered with `Mutav-Mgmt` multisig consensus, always.

> 📌 **Pending input from Draau (treasury policy owner) — NAV update policy.** Epoch length, change cap, deviation tolerance, paused-state policy — Decision 1 in the [Pending Treasury Decisions pack](pending-treasury-decisions.md). Architecture enforces whatever values Draau commits to; runbook holds the numbers.

## What this doc is not

- A spec for any of the Convex tables involved (those live in domain.ts files when each domain is built)
- A choice of multisig tool (Stellar Lab vs custom; operational, see [`regulatory.md`](regulatory.md) for considerations)
- A spec of NAV bounds or epoch length (treasury policy, set by humans, documented in runbook)
- An incident-response playbook (operational, separate from architecture)

## Related reading

- [`entities.md`](entities.md) — three-entity model that informs three-axis reconciliation, cross-entity flows, entity-tagged audit log
- [`tranches.md`](tranches.md) — per-tranche NAV update mechanics
- [`onchain-integration.md`](onchain-integration.md) — uses reconciliation, idempotency, per-chain indexer module pattern, offshore custody
- [`admin.md`](admin.md) — uses workflow durability (liquidation, per A3), audit log integrity (hash chain), per-tranche NAV safety (per A6)
- [`investor.md`](investor.md) — uses workflow durability (deposit/redeem; dual-regime for BR investors)
- [`regulatory.md`](regulatory.md) — names which of these primitives satisfy which entity's regulator expectations
- [Convex Workflow](https://github.com/get-convex/workflow) · [Workpool](https://github.com/get-convex/workpool) · [Action Retrier](https://github.com/get-convex/action-retrier) · [Aggregate](https://github.com/get-convex/aggregate)
- [Stack: Durable Workflows](https://stack.convex.dev/durable-workflows-and-strong-guarantees)
- [Trillian](https://transparency.dev/) — reference verifiable append-only log
- SEC Rule 17a-4(f) (2022 amendment) — regulatory anchor for cryptographic audit trails
