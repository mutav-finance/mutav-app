# ADR 0004 — Pilot `cover_default` coverage-draw architecture

**Status:** Accepted (2026-06-19) · **Phase:** Pilot ([#208](https://github.com/mutav-finance/mutav-app/issues/208)) · **Anchor:** [#201](https://github.com/mutav-finance/mutav-app/issues/201) (reserve-vault coverage draw) · **Builds on:** [ADR 0003](0003-persona-app-origin-isolation-single-convex.md), staff-access cascade (#202–#205)

## Context

The pilot draws guarantee coverage from the **stage-1 reserve-vault** (managed in `apps/admin`); the stage-2 fund and the operator-runtime cluster are out of scope. The single missing piece is the **`cover_default` coverage-draw path** — turning a tenant default into an on-chain reserve withdrawal — and it is unbuilt today: the `@mutav-finance/mutav-stellar` SDK is **not** a dependency (reserve state is read via hand-rolled raw Soroban RPC in `convex/reserve/actions.ts`), and `apps/admin` is a near-stub with no reserve or signing surface.

This ADR records the architecture decided for that path. It was produced by a senior-engineering-decision workflow (triage → ordered fan-out with deep research → convergence loop) and records not just the choices but the alternatives weighed, the trade-off accepted, the **confidence**, and the **revisit trigger** for each.

## Constraints (hard) & domain invariants

**Constraints**

- **Custody boundary** (workspace rule): `mutav-stellar` holds no signing keys (SDK composes XDRs only); Convex composes + submits but **never signs**; the dependency direction never reverses. Operator (hot) KMS authority is **stage-2, not in the pilot** — the only in-pilot value-flow authority is **Admin (cold)**.
- `cover_default` is an **admin cold-authority op** = `reserve_vault.withdraw(asset, amount, destination, ref_hash)`, gated on-chain by `require_auth(admin)` + pause/allowlist checks (`contracts/stage1/reserve_vault/src/lib.rs:452`).
- The deployed vault's admin address is an **OZ Smart Account** (`CustomAccountInterface.__check_auth`, M-of-N passkey threshold) per the stage-1 spec — **not** a plain hardware-wallet keypair. (Reconciles a looser CLAUDE.md authority row.)
- `@creit.tech/stellar-wallets-kit` is **banned** (9 critical CVEs via Trezor/Hot/NEAR adapters).
- **`ref_hash` is emit-only** (`#[topic]` for indexer correlation), **not** an on-chain dedup key (`lib.rs:153-159`) → idempotency must be enforced off-chain.
- The Brazilian prudential floor (CMN 4.893 etc.) is a **non-binding best-practice target** for the pilot (no BCB authorization required) → weight security/correctness over compliance-attestation.

**Invariants** — idempotent coverage draw (a single default must never double-draw); money is integer cents / unscaled `i128` base-units via BigInt (no floats); hash-chained single-writer audit on every cold-authority transition; fail-closed authz; chain is source of truth (Convex is a rebuildable cache); reconciliation with a circuit breaker; reserve reads never sign.

## Decisions

Ordered by dependency + reversibility (foundational one-way doors first).

### 1. Cold-authority signing — OZ Smart Account M-of-N passkeys _(one-way · confidence: high)_

Sign `cover_default` with the **OZ Smart Account M-of-N passkey threshold at the deployed reserve-vault admin address**, via the `smart-account-kit` (WebAuthn passkeys) inside `apps/admin`. Convex composes + submits; the passkey quorum signs client-side; the key never reaches Convex.

- **Alternatives:** a single hardware-wallet keypair in `apps/admin` (pushes M-of-N/timelock into fragile app code, contradicts the deployed contract); a hot/server keypair in a Convex Action (violates the custody boundary); defer behind a manual out-of-band signer.
- **Trade-off accepted:** an OZ-experimental, pre-1.0 load-bearing dependency (OZ Stellar Contracts v0.7.2 + the kit) enters audit scope, plus a heavier first integration (passkey enrollment, quorum ceremony) — in exchange for ratifying the deployed contract's intended admin model and sidestepping the banned wallet-kit (passkeys carry no Trezor/Hot/NEAR adapters).
- **Revisit if:** a focused audit/live testing surfaces a critical unpatched flaw in v0.7.2 or the kit with no timely fix → fall back via `propose_admin`/`accept_admin` to a simpler admin.

### 2. Reserve chain-integration — split along the risk gradient _(two-way · confidence: high)_

**Write path:** add a pure `buildReserveWithdrawOp(contractId, asset, amount: bigint, destination, refHash) -> xdr.Operation` to a new `mutav-stellar/src/providers/soroban/reserveVault.ts` (mirrors `fund.ts`: no keys, no network, no submit), exported via the package exports map. `mutav-app` takes a **pinned** dep and imports **only `./soroban/*`** — never `core/network.ts` (it reads `process.env`, colliding with the centralized-env rule). The only value-moving encoding thus lives in the **audited** package. **Read path:** keep the hand-rolled raw Soroban RPC in `convex/reserve/actions.ts` (all-zero simulation source, never-signs, `available:false`-on-failure).

- **Alternatives:** keep hand-rolling the withdraw XDR too (value-moving encoding outside the audited package); full SDK adoption incl. porting reads (net-new work, risks the tested never-mock discipline); CLI-generated bindings; publish the SDK to npm first.
- **Trade-off accepted:** a split integration (audited SDK for writes, raw RPC for reads) and its short-term inconsistency, for getting the value-moving encoding into the audited package now without regressing the working read path.
- **Revisit if:** the read path needs something raw RPC can't express cleanly (e.g. `Withdrawn`-event decoding for reconciliation) → port reads into the SDK then.

### 3. End-to-end flow — a six-state `coverageDraw` state machine _(two-way · confidence: high)_

`pending → approved → composed → signing → submitted → reconciled`. Transitions split by Convex ctx capability: **mutation** transitions (`initiate`, `approve`) run in `mutationWith*` wrappers and write audit inline via the injected `appendStaffAudit` (user actor); **action** transitions (`compose`, `submit`, `reconcile`) route their audit through a **companion `internalMutation`** with the `{ kind: "system", source }` actor (because `appendAuditEntry` requires a `MutationCtx` and cannot run inside an Action). Compose uses the OE2 SDK builder (destination from an env allowlist); signing is the only off-Convex step; submit is a key-free Action with a terminal-state no-op guard.

- **Alternatives:** KMS signing (violates the custody boundary); client-side compose (contradicts "Convex composes").
- **Trade-off accepted:** a six-state ledger and a two-round-trip signing handoff, for vault-absent idempotency, per-transition audit, and resumability across the async signature.
- **Revisit if:** OE4 needs more states, stage-2 KMS lands, the signed XDR stops being opaque to Convex, or review flags the unsigned-XDR round-trip.

### 4. Approval model — two complementary, non-identical gates _(two-way · confidence: high)_

(A) A **Convex fail-closed `treasury`-role gate** authorizes the _workflow_: `initiate`/`approve` check `hasExactRole(roles, "treasury")` — `treasury` is **off-ladder**, so it is checked with `hasExactRole`, **never** `meetsMinRole`, inside a `mutationWithMutavStaff` handler. (B) The **on-chain OZ Smart Account 2-of-3 passkey quorum** (a Context Rule enforced by `__check_auth`) authorizes the _withdraw_. The classic-G-account "collect signatures in Convex" proposal-queue model (`regulatory.md:291-303`) does **not** apply to the vault admin and must not be implemented here. Per-amount thresholds + timelocks are deferred (pure Context-Rule additions later); mainnet target is 3-of-5.

- **Alternatives:** a single admin (rejected — the admin is a Smart Account); Convex faking/counting the quorum (rejected — the real M-of-N is the on-chain `__check_auth`); 3-of-5 now (deferred to mainnet); per-amount/timelock now (deferred, reconfigurable).
- **Trade-off accepted:** a flat 2-of-3 with no per-amount escalation/timelock for the pilot — weaker than the 3-of-5 target but still "no single signer," with the gaps being later Context-Rule additions.
- **Revisit if:** mainnet cutover (→ 3-of-5 + amount rules + timelock), the v0.7.2 audit forcing an admin swap, or an inability to field three distinct signers.

### 5. Idempotency, trigger, reconciliation — the settled spine _(two-way · confidence: high)_

- **Idempotency:** `drawId = canonical(guaranteeId, coveragePeriod)` (UTC billing-month string, mirroring invoices' `periodMonth`); `ref_hash = SHA-256(drawId)` **derived, never an input**. A `coverageDraw` table with a `by_idempotency` index on `(guaranteeId, coveragePeriod)`; the guard is **read-before-insert in one mutation** (`initiateCoverageDraw`), mirroring `creditAnalysis.recordSignal` (`creditAnalysis/useCases.ts:33-48`). First initiation wins → a default never mints a second `ref_hash`.
- **Trigger:** two-stage, signal-separated-from-draw. A staff member initiates against a contract whose invoices are overdue (derived `overdue` status is the eligibility gate); a cron **may surface candidates but must not auto-initiate** a value-moving draw in the pilot.
- **Reconciliation:** a scheduled `internalAction` (~15 min, aligned to the reserve refresh) reads on-chain `Withdrawn` events by `ref_hash` (read-only simulation) and compares the off-chain ledger to chain; a mismatch (submitted-but-no-event after grace, or orphan on-chain event) **trips a fail-closed circuit breaker** blocking new initiation/submission.
- **Alternatives:** external-id idempotency on the submit tx hash (not deterministic pre-submit); on-chain dedup (rejected — vault doesn't); fully-automated auto-draw (rejected for pilot — human-in-the-loop on every capital movement); amount/timestamp reconciliation (weaker than `ref_hash`); alert-only, no breaker (rejected).
- **Trade-off accepted:** a manual staff-initiated trigger (throughput for a human gate + smaller blast radius).
- **Revisit if:** the pilot needs automated/high-volume draw initiation (pair with OE4's deferred amount-rules/timelocks).

## Convergence

The decisions were re-read together against the constraints; the rule "more-foundational / less-reversible wins → re-open the dependent" resolved **three** conflicts (all from code-verified facts), after which `reopen: []` (consistent):

1. **OE4 conflated two M-of-N gates.** "App collects signatures and gates approve" mixed a Convex authorization with the on-chain quorum. → Split into the two complementary gates above (Convex `treasury` workflow gate ≠ on-chain withdraw quorum).
2. **OE3 audit in Actions.** `appendStaffAudit`/`appendAuditEntry` require a `MutationCtx` and cannot run inside an Action. → Action transitions route audit through a companion `internalMutation` (system actor).
3. **OE4 `treasury` gate vs `mutationWithMutavRole`.** That factory only accepts a `MutavLadderRole`, which excludes `treasury` by design. → The gate is an inline `hasExactRole(roles, "treasury")` check inside a `mutationWithMutavStaff` handler.

## Build sequencing

0. **Pre-work:** reconcile the CLAUDE.md authority row ("hardware wallet inside `apps/admin`" → "OZ Smart Account M-of-N passkeys at the vault admin address") so docs match the deployed contract.
1. **OE2 write builder** (`reserveVault.ts buildReserveWithdrawOp`) — ratifies the contract's arg shape.
2. **OE1 signing surface** in `apps/admin` (depends on OE2's XDR shape) — `smart-account-kit` passkey enroll + 2-of-3 quorum.
3. **OE3 state machine + OE5 idempotency** together (table/states + `by_idempotency` guard + `ref_hash` derivation on `initiate`).
4. **OE4 Convex `treasury` gate** on `initiate`/`approve`; the on-chain quorum (step 2) is the independent second gate.
5. **OE5 reconciliation cron + circuit breaker** last (needs submitted rows + indexed events).
6. **OE3 audit companions** (system-actor `internalMutation`s) wired into the compose/submit/reconcile Actions as each is built.

## Stellar-doc grounding & refinements (2026-06-19)

The decision run's external **Stellar** grounding was thin (the `standardsFound` records came back empty for OE1–OE3). Verified post-hoc against the installed Stellar `dapp` expert skill + the Smart Account Kit / OpenZeppelin docs. The core decisions **hold** — `smart-account-kit` is real (`kalepail/smart-account-kit` + OpenZeppelin `stellar-contracts`; `SmartAccountKit` + `IndexedDBStorage` + Context Rules + threshold multisig over secp256r1 passkeys), and compose-separately-from-sign is the supported flow. Three refinements fold in:

1. **Submit locus (refines OE3).** The kit's `signAndSubmit` **signs _and_ submits client-side**. So the flow is: Convex **composes** (key-free, via the OE2 builder) → `apps/admin` **signs _and_ submits** the passkey-quorum tx via the kit → Convex records the returned tx hash and transitions `submitted`, then reconciles. This **removes the planned Convex submit Action** and its round-trip; the `submitted` transition becomes a hash-recording mutation, not a submit. The compose/reconcile Actions and their system-actor audit companions stay.
2. **Fee sponsorship (new operational requirement).** A passkey Smart Account needs XLM for fees, or fee-bump sponsorship via the **OpenZeppelin Relayer / Stellar Channels Service** (Launchtube is deprecated). Decide before build: fund the admin Smart Account with XLM, or route `cover_default` submission through the OZ Relayer for gasless. **Revisit trigger:** add to OE1's watch-list.
3. **Deployment prerequisites (refines OE1).** The kit requires a configured **WebAuthn verifier contract address** + **account-WASM hash** (plus the network passphrase/RPC). These are pilot setup tasks alongside passkey enrollment + the quorum ceremony.

## Consequences

- Commits the pilot to the OZ Smart Account admin model (and its v0.7.2 audit obligation) and to taking a pinned `@mutav-finance/mutav-stellar` dependency for the withdraw builder.
- The CLAUDE.md / workspace authority tables should cite **this ADR** as the authority for the admin-signing mechanism (as other docs cite ADR 0003).
- All five decisions are `confidence: high`; the revisit triggers above are the standing watch-list (chief among them: the OZ-experimental dependency audit, and the mainnet escalation to 3-of-5 + amount rules + timelocks).

---

_Method: senior-engineering-decision workflow (run `wf_3ae84f5a-e7b`) — triage (constraints/invariants/ordering) → sequential fan-out (internal context + deep research + driver scoring + decide-carrying-priors) → convergence loop. Decision drivers: correctness · security (weighted) · reversibility · time-to-ship · operational cost · team familiarity._
