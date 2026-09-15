# Guarantee lifecycle — specification

The lifecycle of one guarantee, from draft to closure, as enforced by the code on `main`. Every rule below cites the file and line that enforces it and the test that proves it, so a reader can verify each claim without trusting this document. Where the shipped code deviates from the protocol-level scenarios document that seeded the design, § 10 says so.

Diagram: [`guarantee-lifecycle.html`](guarantee-lifecycle.html) (the seven states and every edge, labelled by actor). Design record: [ADR 0007](decisions/0007-lease-guarantee-split.md). Domain code: [`convex/guarantees/`](../../convex/guarantees/), [`convex/delinquencies/`](../../convex/delinquencies/).

## 1. Scope

A **guarantee** is what Mutav sells: the rental-guarantee obligation on one lease, with its own immutable pricing snapshot and its own coverage capacity. A **lease** is the rental relationship it is written against; one lease takes many guarantees over its life, at most one of them open (`leases.openGuaranteeId`). A **delinquency notice** is one reported missed rent; notices are the events that move a guarantee through its default states.

This document covers the guarantee state machine, the notice state machine, how the two are coupled, the capacity policy, the single write path, and the audit trail. It does not cover pricing (products / `terms`), the agency UI, or the on-chain reserve draw (see [ADR 0004](decisions/0004-pilot-cover-default-coverage-draw.md) and `mutav-app#286`).

## 2. States

`GUARANTEE_STATE` — [`convex/guarantees/machine.ts:4-12`](../../convex/guarantees/machine.ts). The schema literal union mirrors it at [`convex/schema.ts:14-22`](../../convex/schema.ts).

| State              | Meaning                                                                                     | In force? | Capital effect                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `drafted`          | Created and priced; the lease has not started. `capacity` already holds the priced ceiling. | no        | none — `reservedCents` must be `0` to activate                                                    |
| `active`           | Lease running, rent current.                                                                | yes       | counts toward platform exposure                                                                   |
| `in_arrears`       | At least one delinquency notice is `open`.                                                  | yes       | no change — arrears alone never moves capacity                                                    |
| `default_verified` | Compliance verified a notice (`staffVerifyDefault`); the default is real, nothing paid yet. | yes       | no change — **verify ≠ pay**                                                                      |
| `cover_committed`  | Mutav paid the landlord at least once; a regressive receivable exists.                      | yes       | `reservedCents` holds the sum of every applied draw                                               |
| `in_eviction`      | Eviction proceedings under way; the only exit is `closed(eviction)`.                        | yes       | reserved cents stay held                                                                          |
| `closed`           | Terminal. Carries a `closure { reason, closedAt, note? }`.                                  | no        | closing never touches `capacity` ([`mutations.ts:186-188`](../../convex/guarantees/mutations.ts)) |

- **Insured states** = `active, in_arrears, default_verified, cover_committed, in_eviction` — `INSURED_STATES`, [`domain.ts:61-67`](../../convex/guarantees/domain.ts). They are not lexically contiguous, so every aggregate read iterates the list rather than a key range.
- **Terminal states** = `{ closed }` — `TERMINAL_STATES`, [`machine.ts:26`](../../convex/guarantees/machine.ts).
- `activatedAt` is stamped once, on the first entry to `active` ([`transitions.ts:122-137`](../../convex/guarantees/transitions.ts)); a cure that returns to `active` does not reset it.

## 3. Transition matrix

`ALLOWED_TRANSITIONS` — [`machine.ts:37-60`](../../convex/guarantees/machine.ts). This map is the enforcement point; nothing else in the codebase decides whether a move is legal.

| from →             | `active` | `in_arrears` | `default_verified` | `cover_committed` | `in_eviction` | `closed` |
| ------------------ | :------: | :----------: | :----------------: | :---------------: | :-----------: | :------: |
| `drafted`          |    ✓     |              |                    |                   |               |    ✓     |
| `active`           |          |      ✓       |                    |                   |       ✓       |    ✓     |
| `in_arrears`       |    ✓     |              |         ✓          |                   |       ✓       |    ✓     |
| `default_verified` |    ✓     |              |                    |         ✓         |       ✓       |    ✓     |
| `cover_committed`  |    ✓     |      ✓       |                    |                   |       ✓       |    ✓     |
| `in_eviction`      |          |              |                    |                   |               |    ✓     |
| `closed`           |          |              |                    |                   |               |          |

Three deliberate choices a reader may not expect:

1. **`cover_committed` is not terminal.** A tenant can cure after Mutav has paid; the guarantee returns to `active` (or to `in_arrears` if a second rent slips) and keeps the reserved cents on its row so the receivable is not forgotten. Tested at [`machine.test.ts`](../../convex/guarantees/machine.test.ts) "scenarios-doc corrections".
2. **Any activated state may enter eviction.** Eviction is a legal fact, not a stage of the default ladder.
3. **Any activated state may close.** End of lease, rescission, abandonment or death can happen while a notice is open; the close reason, not the state, records why.

`assertTransition(from, to)` — [`machine.ts:73-99`](../../convex/guarantees/machine.ts) — returns a `Result`, never throws, and checks in this order:

| Code                 | When                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `SELF_TRANSITION`    | `from === to` (any state, incl. terminal) — this is the replay guard |
| `TERMINAL_STATE`     | `from` is `closed`                                                   |
| `ILLEGAL_TRANSITION` | edge not in `ALLOWED_TRANSITIONS`                                    |

## 4. Close reasons

A close is a transition **plus** a reason, and the reason is gated by the state it comes from. `CLOSE_REASON` and `CLOSE_REASON_ALLOWED_FROM` — [`machine.ts:102-154`](../../convex/guarantees/machine.ts).

| Reason                    | Allowed from                          | Meaning                                                                                           |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `end_of_lease`            | any activated state                   | the lease ran its term                                                                            |
| `rescission`              | any activated state                   | the parties ended the lease early                                                                 |
| `abandonment`             | any activated state                   | the tenant left without notice                                                                    |
| `death`                   | any activated state                   | the tenant died                                                                                   |
| `eviction`                | `in_eviction` only                    | the eviction concluded                                                                            |
| `dispute_reversal`        | `default_verified`, `cover_committed` | a verified default was overturned                                                                 |
| `canceled_pre_activation` | `drafted` only                        | a draft is **canceled**, never ended ([`machine.ts:134-137`](../../convex/guarantees/machine.ts)) |

"Any activated state" = `ENDED_FROM_ANY_ACTIVATED_STATE` = the five insured states ([`machine.ts:138-144`](../../convex/guarantees/machine.ts)).

`assertClose(from, reason)` ([`machine.ts:164-183`](../../convex/guarantees/machine.ts)) composes with `assertTransition(from, "closed")` rather than replacing it, returning `TERMINAL_STATE` or `REASON_NOT_ALLOWED_FROM_STATE`. Two further checks live in the write path ([`transitions.ts:90-104`](../../convex/guarantees/transitions.ts)): a move to `closed` without a `closure` → `CLOSURE_REQUIRED`; a `closure` on any other move → `CLOSURE_NOT_ALLOWED`. Full `(from, reason)` matrix: [`close.test.ts`](../../convex/guarantees/close.test.ts).

## 5. The single write path

Every change to `guarantees.status` goes through `applyGuaranteeTransition` — [`convex/guarantees/transitions.ts:81-187`](../../convex/guarantees/transitions.ts). It is not a Convex function; the public mutations compose it **inside their own transaction**. From its doc comment:

> an error `Result` is returned before the first write, so a refused call leaves the transaction untouched. Once a write has happened, a failure throws and the whole transaction rolls back.

Ordered side effects, exactly as coded:

| #   | Step                                                                                    | Where                    |
| --- | --------------------------------------------------------------------------------------- | ------------------------ |
| 1   | `assertTransition(from, to)`                                                            | `transitions.ts:85`      |
| 2   | closure presence: `CLOSURE_REQUIRED` / `CLOSURE_NOT_ALLOWED`                            | `transitions.ts:90-104`  |
| 3   | `assertClose(from, reason)` when closing                                                | `transitions.ts:105-110` |
| 4   | `isValidCapacity` on any supplied capacity (refused, never repaired)                    | `transitions.ts:111-117` |
| 5   | `db.patch` — `status`, `closure`, `activatedAt` (first `active` only), `capacity`       | `transitions.ts:122-137` |
| 6   | rewrite the three aggregates (`guaranteesByState`, `…Platform`, `insuredCentsPlatform`) | `transitions.ts:139-141` |
| 7   | insert a `guaranteeHistory` row with `transition { from, to, closeReason? }`            | `transitions.ts:143-154` |
| 8   | append `guarantee.transitioned` to the hash-chained audit log                           | `transitions.ts:156-171` |
| 9   | when closing, null `leases.openGuaranteeId` if it points at this row                    | `transitions.ts:173-180` |

Steps 1–4 write nothing; steps 5–9 are one Convex transaction. The scheduler is never used for a lifecycle move ([ADR 0007 § 5](decisions/0007-lease-guarantee-split.md)), so a notice and the guarantee state it implies cannot disagree. Proven at [`transitions.test.ts`](../../convex/guarantees/transitions.test.ts) "machine composition" and [`scenarios.test.ts`](../../convex/guarantees/scenarios.test.ts) "guard before patch".

## 6. Who may move what

Two actors move a guarantee: the **agency** (any member of the guarantee's agency, via `mutationWithAgencyScope` — [`convex/lib/auth.ts:132`](../../convex/lib/auth.ts)) and **Mutav staff at `compliance` or above** (`mutationWithMutavRole({ minRole: "compliance" })` — [`auth.ts:213`](../../convex/lib/auth.ts); ladder `support < compliance < admin`, [`convex/mutavStaff/domain.ts:31`](../../convex/mutavStaff/domain.ts)). Authority is narrower than the machine: some legal edges have no caller today.

### 6.1 Guarantee mutations — `convex/guarantees/`

| Mutation          | Actor  | Move                                        | Notes                                                                                                                                         | Code               |
| ----------------- | ------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `create`          | agency | inserts `drafted`                           | prices from the default product, snapshots `terms`, sets `capacity`, sets `leases.openGuaranteeId`                                            | `useCases.ts:936`  |
| `cancelDraft`     | agency | `drafted → closed(canceled_pre_activation)` | any refusal surfaces as `NOT_DRAFTED`                                                                                                         | `useCases.ts:1166` |
| `activate`        | agency | `drafted → active`                          | refuses `reservedCents ≠ 0` (`CAPACITY_INVARIANT_BROKEN`); re-initialises `capacity` from `terms.coverageCeilingCents`                        | `mutations.ts:96`  |
| `closeEndOfLease` | agency | `→ closed(end_of_lease)`                    | the only close an agency can perform; no reason argument                                                                                      | `mutations.ts:152` |
| `close`           | staff  | `→ closed(reason)`                          | any reason legal from the current state; capacity untouched                                                                                   | `mutations.ts:190` |
| `enterEviction`   | staff  | `→ in_eviction`                             |                                                                                                                                               | `mutations.ts:229` |
| `reprice`         | staff  | **no move**                                 | new `terms` snapshot + `nextRenewalDate`; refuses `closed` (`GUARANTEE_CLOSED`); history row without `transition`; audit `guarantee.repriced` | `mutations.ts:289` |

### 6.2 Notice mutations — `convex/delinquencies/mutations.ts`

Each row is one mutation that moves the **notice** and, in the same transaction, may move the **guarantee**.

| Mutation                       | Actor  | Notice move                                                   | Guarantee move                                                                                                                                                                                                                                                         | Code   |
| ------------------------------ | ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `openNotice`                   | agency | insert `open`                                                 | `active → in_arrears`; from any other insured state the guarantee keeps its state; non-insured → `GUARANTEE_NOT_INSURED`. One `open` notice per `(guarantee, rentDueDate)`.                                                                                            | `:198` |
| `markResolved`                 | agency | `open → resolved(tenant_cured \| stale)`                      | `tenant_cured` returns `in_arrears → active` only when no other notice is `open` or `verified`; `stale` never moves the guarantee. Refuses a `verified` notice (`NOTICE_VERIFIED`).                                                                                    | `:359` |
| `markCanceled`                 | agency | `open → canceled(agency_withdrew \| duplicate \| data_error)` | `in_arrears → active` when nothing else is outstanding                                                                                                                                                                                                                 | `:454` |
| `staffVerifyDefault`           | staff  | `open → verified`                                             | `in_arrears → default_verified` the first time; already `default_verified` / `cover_committed` / `in_eviction` keep state; anything else → `GUARANTEE_TRANSITION_REFUSED`. Audit `delinquency.verified`.                                                               | `:566` |
| `staffMarkResolvedByCover`     | staff  | `verified → resolved(cover_committed)`                        | requires the notice to be `verified`; reserves capacity (§ 7); `default_verified → cover_committed` on the first draw, later draws keep state. Audit `delinquency.resolved_by_cover`.                                                                                  | `:672` |
| `staffMarkCanceledByDismissal` | staff  | `→ canceled(staff_dismissed)` or `→ resolved(staff_dispute)`  | `staff_dismissed`: back to `active` from `in_arrears` or `default_verified`, never from `cover_committed`. `staff_dispute`: **no guarantee move** — it stays in default for a later `close(dispute_reversal)`. Audit `delinquency.dismissed` / `delinquency.disputed`. | `:827` |

The "who may return to `active` from where" rules are the constants `AGENCY_RETURN_TO_ACTIVE_FROM` (`in_arrears` only, `:113`) and `STAFF_DISMISSAL_RETURN_TO_ACTIVE_FROM` (`in_arrears`, `default_verified`, `:123-126`), and are tested exhaustively at [`mutations.test.ts`](../../convex/delinquencies/mutations.test.ts) "return to active — who may leave which state".

### 6.3 Notice state machine — `convex/delinquencies/machine.ts`

Statuses `open, verified, resolved, canceled` (`:18-23`); terminal = `resolved, canceled` (`:39-42`); edges `open → verified | resolved | canceled`, `verified → resolved | canceled` (`:53-60`); the same three error codes as the guarantee machine (`:62-65`). Value objects in [`delinquencies/domain.ts`](../../convex/delinquencies/domain.ts): resolution kinds `tenant_cured, cover_committed, staff_dispute, stale`; cancellation reasons `agency_withdrew, staff_dismissed, duplicate, data_error`; evidence sources `agency_reported, tenant_confirmed, bank_attested, onchain_observed, system_scheduled` (only `agency_reported` is accepted by `openNotice` today, `mutations.ts:207-214`).

## 7. Capacity policy

Policy **C — reserve side only** ([ADR 0007 § 6](decisions/0007-lease-guarantee-split.md)). Row shape `guarantees.capacity { ceilingCents, availableCents, reservedCents }` — [`schema.ts:470-474`](../../convex/schema.ts).

- **Invariant**: every leg ≥ 0 and `availableCents + reservedCents === ceilingCents` — `isValidCapacity`, [`transitions.ts:71-74`](../../convex/guarantees/transitions.ts). A row that violates it is **refused, not repaired** (`CAPACITY_INVARIANT_BROKEN`).
- **Only cover moves capacity.** Arrears, verification, eviction and closure leave it alone.
- **Draw** — `reserveCoverCapacity` ([`transitions.ts:206-257`](../../convex/guarantees/transitions.ts)): `appliedCents = min(availableCents, amountCents)` (`:229`), moved from `available` to `reserved`. The applied figure — not the requested one — is stored on the notice as `resolution.appliedCoverCents` ([`delinquencies/mutations.ts:769`](../../convex/delinquencies/mutations.ts); [`schema.ts:602-611`](../../convex/schema.ts)) and audited as `guarantee.capacity_reserved { requestedCents, appliedCents }`. The admin queue shows claimed / remaining / to-be-drawn before the operator confirms, because of this clamp.
- **Reversal** — `releaseCoverCapacity({ appliedCents })` ([`transitions.ts:271-327`](../../convex/guarantees/transitions.ts)) gives back **exactly the stored figure**; releasing more than is reserved → `RELEASE_EXCEEDS_RESERVED`. Reversing a recomputed amount is how `available + reserved` drifts from `ceiling`; reversing the applied number keeps the invariant exact. **Not wired yet**: nothing calls it (`:265-269`); `close(dispute_reversal)` leaves the cents held and a dismissal never returns from `cover_committed`.
- `INVALID_AMOUNT` for a non-integer or negative amount (`:214-219`, `:279-284`).
- `reservedCents` is a high-water mark of what was drawn; there is no `consumed` leg until the receivable ledger exists ([ADR 0007 § 9](decisions/0007-lease-guarantee-split.md)).
- A capacity write is an aggregate write: `writeCapacity` patches the row and rewrites `insuredCentsPlatform` together (`:333-343`).

`terms` (immutable snapshot taken at `create`, refreshed only by `reprice`) — [`schema.ts:451-469`](../../convex/schema.ts): `productSlug, plan, rentCents, feeCents, taxaFeeCents, prestamistaFeeCents, oneTimeActivationFeeCents, commissionRate, prestamistaCommissionRate, coverageCeilingMultiplier, exitCostMultiplier, coverageCeilingCents, exitCostCapCents, appliedAt`. Platform exposure per guarantee = `capacity.availableCents + terms.exitCostCapCents` ([`aggregate.ts`](../../convex/guarantees/aggregate.ts) `insuredCentsPlatform`).

## 8. History and audit

- **`guaranteeHistory`** — [`schema.ts:527-563`](../../convex/schema.ts): `agencyId, guaranteePublicId, at, username, message, transition? { from, to, closeReason? }, tenantSnapshot?`. `transition` is absent on the creation and reprice rows. Indexes `by_guarantee`, `by_agency_guarantee`. This table feeds the agency's state timeline (`getStateTimelineByPeriod`).
- **Audit log** (hash-chained, `mutavAuditLog`) — action literals in [`convex/audit/domain.ts`](../../convex/audit/domain.ts): `guarantee.created`, `guarantee.transitioned`, `guarantee.repriced`, `guarantee.capacity_reserved`, `guarantee.capacity_released`, `lease.created`, `delinquency.verified`, `delinquency.resolved_by_cover`, `delinquency.dismissed`, `delinquency.disputed`. The legacy `contract.*` literals are frozen, never renamed, because the chain hashes them ([ADR 0007 § 8](decisions/0007-lease-guarantee-split.md)).
- **Known gap**: the three agency-side notice mutations (`openNotice`, `markResolved`, `markCanceled`) do not append to the audit log — `TODO(audit)` at `delinquencies/mutations.ts:319, 411, 505`. Their guarantee moves _are_ audited (via `guarantee.transitioned`); only the notice action itself is not. Rationale in [`.claude/notes/deferred-conventions.md`](../../.claude/notes/deferred-conventions.md) § Agency-side audit.

## 9. Idempotency

The notice is the unit of idempotency ([ADR 0007 § 7](decisions/0007-lease-guarantee-split.md)): `openNotice` refuses a second `open` notice for the same `(guarantee, rentDueDate)`, and every state-changing mutation re-runs `assertTransition`, so a replayed request lands on `SELF_TRANSITION` (or the notice's `TERMINAL_STATE`) and writes nothing. There is no separate dedupe key. A concurrent pair of `openNotice` calls for the same due date is not serialised by a unique constraint (Convex has none) — accepted at pilot volumes, documented in the same deferred-conventions note.

## 10. Deviations from the protocol scenarios document

The machine was derived from `docs/operation/contract-default-scenarios.md` in the `mutav` protocol repo (`mutav-finance/mutav#185`), which the code comment at [`machine.ts:30-35`](../../convex/guarantees/machine.ts) names as the source of truth for the edges. The shipped implementation departs from that document in these places; where the two disagree, **this document describes what runs**.

| Scenarios doc                                                                                                                                            | Shipped                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A second machine for the **receivable** (`pending → in_installments → partially_paid → settled / written_off`) in `convex/receivables/`, `convex/cover/` | Not built. Cover is recorded on the notice (`resolution.appliedCoverCents`); the receivable ledger is ADR 0007 § 9 out-of-scope.                                               |
| Derived `consumedCents / recoveredCents / writtenOffCents` and a `capacityPolicy` field on the row                                                       | `capacity` is `{ ceiling, available, reserved }` only; policy C is the code, not a field.                                                                                      |
| `internal.guarantees.autoMarkArrears` cron with `system_scheduled` evidence                                                                              | No cron. `openNotice` is agency-driven and accepts only `agency_reported`.                                                                                                     |
| `in_arrears → closed(dispute_reversal)` via `guarantees.staffDispute`                                                                                    | `dispute_reversal` is legal only from `default_verified` / `cover_committed`; `staff_dispute` is a notice resolution that leaves the guarantee in default for a later `close`. |
| `cover_committed` closes with `end_of_lease \| eviction \| abandonment`                                                                                  | `eviction` is legal only from `in_eviction`; the four "ended" reasons are legal from any activated state.                                                                      |
| Staff guard "role ≥ reviewer"                                                                                                                            | `minRole: "compliance"` (ladder `support < compliance < admin`).                                                                                                               |
| Evidence sources `judicial_document`, `cover_operation`                                                                                                  | Not in `NOTICE_EVIDENCE_SOURCE`.                                                                                                                                               |
| Spelling `cancelled_pre_activation`; mutation names `contracts.activate`, `guarantees.markCured`, `cover.recordIntent`                                   | American spelling `canceled_pre_activation`; names as in § 6.                                                                                                                  |
| Open question 4 — death → co-signer transfer                                                                                                             | Plain `close(death)` only.                                                                                                                                                     |

## 11. Verification

Run from the repo root: `bun run test:convex` (one-shot, all domains) or `bun run test:file convex/guarantees/machine.test.ts` for a single file. Counts below are `it(` / `test(` blocks on `main` @ `abad3cb`; the full convex suite is 1064 tests across 51 files.

| File                                                                                                                                                     | Tests | What it proves                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------ |
| [`guarantees/machine.test.ts`](../../convex/guarantees/machine.test.ts)                                                                                  |    17 | every legal edge, every illegal move, the four "scenarios-doc corrections", exhaustive 7×7 coverage                      |
| [`guarantees/close.test.ts`](../../convex/guarantees/close.test.ts)                                                                                      |     6 | full `(from, reason)` matrix; `assertClose` composes with `assertTransition`                                             |
| [`guarantees/domain.test.ts`](../../convex/guarantees/domain.test.ts)                                                                                    |    13 | `INSURED_STATES` / `isInsured`, value objects                                                                            |
| [`guarantees/transitions.test.ts`](../../convex/guarantees/transitions.test.ts)                                                                          |    14 | machine composition; capacity arithmetic incl. `INVALID_AMOUNT`, `CAPACITY_INVARIANT_BROKEN`, `RELEASE_EXCEEDS_RESERVED` |
| [`guarantees/mutations.test.ts`](../../convex/guarantees/mutations.test.ts)                                                                              |    18 | `activate`, `closeEndOfLease`, `close`, `enterEviction`, `reprice` — happy paths, refusals, auth                         |
| [`guarantees/useCases.test.ts`](../../convex/guarantees/useCases.test.ts)                                                                                |    33 | `create`, `cancelDraft`, timeline, reads                                                                                 |
| [`guarantees/scenarios.test.ts`](../../convex/guarantees/scenarios.test.ts)                                                                              |    60 | schema conformance, one open guarantee per lease, guard-before-patch, index reads, cross-agency isolation                |
| [`guarantees/aggregateWrites.test.ts`](../../convex/guarantees/aggregateWrites.test.ts) + [`backfill.test.ts`](../../convex/guarantees/backfill.test.ts) |     6 | aggregates stay in lockstep with the row                                                                                 |
| [`delinquencies/machine.test.ts`](../../convex/delinquencies/machine.test.ts)                                                                            |    14 | the five legal notice edges, illegal moves, exhaustive                                                                   |
| [`delinquencies/domain.test.ts`](../../convex/delinquencies/domain.test.ts)                                                                              |     6 | predicates and value objects                                                                                             |
| [`delinquencies/mutations.test.ts`](../../convex/delinquencies/mutations.test.ts)                                                                        |    90 | every notice mutation, the composed guarantee transition, the capacity draw, "who may return to active from where"       |
| [`delinquencies/scenarios.test.ts`](../../convex/delinquencies/scenarios.test.ts)                                                                        |    52 | multi-notice lifecycle matrix, resolution / cancellation cause coverage, assertTransition gates the write                |
| [`delinquencies/useCases.test.ts`](../../convex/delinquencies/useCases.test.ts)                                                                          |    28 | agency reads, `openStats`, the admin queue                                                                               |

Behavioural verification of the surfaces that drive these transitions is recorded on the PRs: agency `/guarantees` and dashboard (`#319`, `#321`), admin `/defaults` verify → record cover → dismiss (`#323`, browser-verified on the dev deployment and on production after `#324`).

## 12. Traceability

| Concept              | Definition                              | Enforcement                                                 | Proof                                       |
| -------------------- | --------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| States               | `machine.ts:4-12`, `schema.ts:14-22`    | `assertTransition` `machine.ts:73-99`                       | `machine.test.ts`                           |
| Edges                | `machine.ts:37-60`                      | same                                                        | `machine.test.ts`                           |
| Close reasons        | `machine.ts:102-154`, `schema.ts:24-32` | `assertClose` `machine.ts:164-183`; `transitions.ts:90-110` | `close.test.ts`                             |
| Single write path    | `transitions.ts:81-187`                 | callers in § 6                                              | `transitions.test.ts`, `scenarios.test.ts`  |
| Notice ↔ guarantee   | `delinquencies/mutations.ts` (§ 6.2)    | same transaction, no scheduler                              | `delinquencies/mutations.test.ts`           |
| Capacity invariant   | `schema.ts:470-474`                     | `isValidCapacity` `transitions.ts:71-74`                    | `transitions.test.ts` "capacity arithmetic" |
| Applied-figure store | `schema.ts:602-611`                     | `delinquencies/mutations.ts:769`                            | `mutations.test.ts` "capacity draw"         |
| History              | `schema.ts:527-563`                     | `transitions.ts:143-154`                                    | `useCases.test.ts` timeline                 |
| Audit                | `audit/domain.ts:44-50, 78-81`          | `transitions.ts:156-171`, notice mutations                  | `mutations.test.ts` audit emission          |
