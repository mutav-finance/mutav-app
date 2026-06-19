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

### 3. End-to-end flow — a lightweight idempotent draw ledger (not a durable approval workflow) _(two-way · confidence: high)_

The flow is plain, gated only at the two correct loci (OE4): **in-panel staff (Auth0) → Convex composes the withdraw XDR (key-free, OE2 builder, destination from an env allowlist) → the admin's Smart Account passkey quorum signs + submits client-side (kit `signAndSubmit`) → Convex records the returned tx hash + reconciles.** A `coverageDraw` row exists for idempotency, audit correlation, and reconciliation — its states collapse to `initiated → submitted → reconciled`. There is **no separate Convex `approved` gate** (the wallet signature is the approval) and **no durable multi-step approval orchestration**.

Audit (correctness, not auth) is written at each Convex write: the `initiate` and record-hash transitions are `*WithMutavStaff` mutations writing `appendStaffAudit` (user actor); the reconcile Action routes audit through a **companion `internalMutation`** with the `{ kind: "system", source }` actor (`appendAuditEntry` can't run inside an Action).

- **Alternatives:** a six-state durable approval workflow with a Convex `approved` gate (rejected as over-complication — see OE4; the wallet is the gate); KMS signing (violates the custody boundary); client-side compose (contradicts "Convex composes, never signs").
- **Trade-off accepted:** the `submitted` transition is just hash bookkeeping on the client-returned result, not a Convex broadcast — so Convex never sees a signed XDR and never re-broadcasts.
- **Revisit if:** stage-2 KMS lands (operator path), or per-amount/timelock approval needs reintroduce explicit states.

### 4. Authorization — two tiers, no second Convex gate _(two-way · confidence: high)_

**Don't over-complicate: the admin panel is gated by Auth0; reserve operations are gated by the wallet signature.** Two tiers, each at its correct locus:

- **Tier 1 — panel + backend management (Auth0 / `mutavStaff`).** Opening the admin panel and any action that **moves no on-chain value** (KYC/KYB review, onboarding approve/reject, internal management, backend parameter changes) is gated solely by the just-shipped Auth0 + `mutavStaff` access (#202–#205).
- **Tier 2 — reserve / treasury on-chain ops (the wallet signature).** `cover_default` / reserve withdraws are authorized by the **OZ Smart Account M-of-N passkey quorum**, enforced **on-chain by `__check_auth`**. The signature _is_ the authority.

**Convex does NOT add a co-equal authorization gate for the money move.** Composing an unsigned XDR moves nothing, so the compose mutation only needs Tier-1 panel access (a `*WithMutavStaff` wrapper — "you're staff"); `treasury` is simply the panel role that can _see/trigger_ the reserve screen, **not** a money-move authority. The classic-G-account "collect signatures in Convex" model (`regulatory.md:291-303`) does **not** apply. Pilot quorum 2-of-3; per-amount thresholds + timelocks + the 3-of-5 mainnet target are later Context-Rule additions (no vault change).

- **Alternatives:** a Convex `treasury`-role gate as a _second co-equal authorization_ on the draw (rejected as over-complication — the wallet quorum already is the authority; a gate on an unsigned-XDR compose authorizes nothing); a single admin (rejected — the admin is a Smart Account); Convex counting the quorum (rejected — the real M-of-N is on-chain `__check_auth`).
- **Trade-off accepted:** a flat 2-of-3 with no per-amount escalation/timelock for the pilot, and `treasury` as panel-RBAC-only — simpler, with the gaps being later Context-Rule additions.
- **Revisit if:** mainnet cutover (→ 3-of-5 + amount rules + timelock), the v0.7.2 audit forcing an admin swap, or an inability to field three distinct signers.

### 5. Idempotency, trigger, reconciliation — the settled spine _(two-way · confidence: high)_

- **Idempotency:** `drawId = canonical(guaranteeId, coveragePeriod)` (UTC billing-month string, mirroring invoices' `periodMonth`); `ref_hash = SHA-256(drawId)` **derived, never an input**. A `coverageDraw` table with a `by_idempotency` index on `(guaranteeId, coveragePeriod)`; the guard is **read-before-insert in one mutation** (`initiateCoverageDraw`), mirroring `creditAnalysis.recordSignal` (`creditAnalysis/useCases.ts:33-48`). First initiation wins → a default never mints a second `ref_hash`.
- **Amount (precision):** the withdraw `i128` is computed by a **new BigInt-only `centsToBaseUnits(cents, decimals)` write helper** — **not** the existing `rawBalanceToCents`/`assetValueCents`, which return a JS `Number` (display/read-path only, round-down). No value-moving amount may round-trip through a `Number`/float (preserves the integer-money invariant). _(Caught by the doc-grounded re-run; the read helpers end in `return … Number(rounded)`.)_
- **Trigger:** two-stage, signal-separated-from-draw. A staff member initiates against a contract whose invoices are overdue (derived `overdue` status is the eligibility gate); a cron **may surface candidates but must not auto-initiate** a value-moving draw in the pilot.
- **Reconciliation:** a scheduled `internalAction` (~15 min, aligned to the reserve refresh) polls `rpc.getEvents(topics=[withdraw, ref_hash])` with a **persisted watermark**, matches by `ref_hash`, and verifies asset/amount/destination from the event data vec; a mismatch (submitted-but-no-event after grace, or orphan on-chain event) **trips a fail-closed circuit breaker** blocking new initiation/submission. **Bounded by RPC `getEvents` retention (~24 h, max 7-day, no streaming)** — a longer outage exceeds the window and requires a dedicated indexer (revisit trigger). _(Surfaced by the doc-grounded re-run, via the `data` skill / RPC docs.)_
- **Alternatives:** external-id idempotency on the submit tx hash (not deterministic pre-submit); on-chain dedup (rejected — vault doesn't); fully-automated auto-draw (rejected for pilot — human-in-the-loop on every capital movement); amount/timestamp reconciliation (weaker than `ref_hash`); alert-only, no breaker (rejected).
- **Trade-off accepted:** a manual staff-initiated trigger (throughput for a human gate + smaller blast radius).
- **Revisit if:** the pilot needs automated/high-volume draw initiation (pair with OE4's deferred amount-rules/timelocks).

## Convergence

The decisions were re-read together against the constraints; the rule "more-foundational / less-reversible wins → re-open the dependent" resolved **three** conflicts (all from code-verified facts), after which `reopen: []` (consistent):

1. **OE4 conflated two M-of-N gates.** "App collects signatures and gates approve" mixed a Convex authorization with the on-chain quorum. → Split into the two complementary gates above (Convex `treasury` workflow gate ≠ on-chain withdraw quorum).
2. **OE3 audit in Actions.** `appendStaffAudit`/`appendAuditEntry` require a `MutationCtx` and cannot run inside an Action. → Action transitions route audit through a companion `internalMutation` (system actor).
3. **OE4 `treasury` gate vs `mutationWithMutavRole`.** That factory only accepts a `MutavLadderRole`, which excludes `treasury` by design. → The gate is an inline `hasExactRole(roles, "treasury")` check inside a `mutationWithMutavStaff` handler.

> **Simplification (2026-06-19, post-converge).** Conflicts 1 & 3 originally produced a _Convex `treasury` authorization gate_ co-equal with the on-chain quorum. That was over-built: composing an unsigned XDR authorizes no money movement, so §4 was simplified to the **two-tier model** — Auth0/`mutavStaff` gates the panel (Tier 1), the wallet quorum is the _sole_ money authority (Tier 2), and `treasury` is panel-RBAC only. Conflict 2 (audit-in-Actions) stands unchanged.

## Build sequencing

0. **Pre-work:** reconcile the CLAUDE.md authority row ("hardware wallet inside `apps/admin`" → "OZ Smart Account M-of-N passkeys at the vault admin address") so docs match the deployed contract.
1. **OE2 write builder** (`reserveVault.ts buildReserveWithdrawOp`) — ratifies the contract's arg shape.
2. **OE1 signing surface** in `apps/admin` (depends on OE2's XDR shape) — `smart-account-kit` passkey enroll + 2-of-3 quorum.
3. **OE3 draw ledger + OE5 idempotency** together (the `coverageDraw` table + `by_idempotency` guard + `ref_hash` derivation on `initiate`, behind a `*WithMutavStaff` panel gate).
4. **OE4 — no extra gate to build:** Tier-1 panel access is the existing `mutavStaff` wrapper; Tier-2 authority is the on-chain quorum from step 2. (`treasury` stays panel-RBAC for who sees the reserve screen.)
5. **OE5 reconciliation cron + circuit breaker** last (needs submitted rows + indexed events).
6. **OE3 audit companions** (system-actor `internalMutation`s) wired into the compose/submit/reconcile Actions as each is built.

## Stellar-doc grounding (re-run, 2026-06-19)

The decision run was **re-executed with the official Stellar docs + the installed Stellar expert skills as the mandated guideline** (the first pass's external `standardsFound` came back empty for the Stellar decisions). The core decisions **held** and are now cited to primary sources:

- **OE1 (signing):** [dapp skill § Smart Accounts](../../.claude/skills/dapp/SKILL.md) · [OpenZeppelin Stellar Contracts](https://developers.stellar.org/docs/tools/openzeppelin-contracts) · [Contract (custom) accounts](https://developers.stellar.org/docs/build/guides/contract-accounts) · [OpenZeppelin Relayer](https://developers.stellar.org/docs/tools/openzeppelin-relayer) — confirms `smart-account-kit` (`kalepail/smart-account-kit`) + OZ `stellar-contracts`, M-of-N passkey (secp256r1) thresholds via Context Rules, and that `__check_auth` enforces the quorum **on-chain**.
- **OE2 (compose):** [Invoke a contract (SDK)](https://developers.stellar.org/docs/build/guides/transactions/invoke-contract-tx-sdk) + `data` skill — confirms key-free `assembleTransaction` compose feeding the kit's signer.
- **OE4 (authorization):** [Soroban authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization) + [multisig](https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig).

Three refinements emerged **natively (cited)** in the re-run and are folded in:

1. **Submit locus (refines OE3) — folded into the sequencing above.** The kit's `signAndSubmit` **signs _and_ submits client-side**, so the planned Convex _submit Action is removed_: `apps/admin` signs+submits the passkey-quorum tx; Convex reaches `submitted` only by **recording the client-returned tx hash** through the treasury-gated transition mutation (audit inline, user actor). Compose + reconcile stay Actions with system-actor audit companions.
2. **Fee sponsorship (operational, decide before build).** A passkey Smart Account holds no XLM — either **fund the admin Smart Account with XLM** or route submission through the **OpenZeppelin Relayer / Stellar Channels Service** (Launchtube deprecated). Added to OE1's watch-list.
3. **Deployment prerequisites (refines OE1).** The kit needs a configured **WebAuthn verifier contract address** + **account-WASM hash** (+ network passphrase/RPC) — pilot setup alongside passkey enrollment + the quorum ceremony.

The re-run also caught **two code-verified findings** the first pass missed — folded into OE5 above: the **cents→base-unit write helper** (the existing `reserve/domain.ts` helpers return a `Number`, unsafe for a value-moving amount) and the **`rpc.getEvents` retention bound** on reconciliation.

## Consequences

- Commits the pilot to the OZ Smart Account admin model (and its v0.7.2 audit obligation) and to taking a pinned `@mutav-finance/mutav-stellar` dependency for the withdraw builder.
- The CLAUDE.md / workspace authority tables should cite **this ADR** as the authority for the admin-signing mechanism (as other docs cite ADR 0003).
- All five decisions are `confidence: high`; the revisit triggers above are the standing watch-list (chief among them: the OZ-experimental dependency audit, and the mainnet escalation to 3-of-5 + amount rules + timelocks).

---

_Method: senior-engineering-decision workflow (run `wf_3ae84f5a-e7b`, re-grounded against the official Stellar docs + installed expert skills) — triage (constraints/invariants/ordering) → sequential fan-out (internal context + deep research + driver scoring + decide-carrying-priors) → convergence loop. Decision drivers: correctness · security (weighted) · reversibility · time-to-ship · operational cost · team familiarity._
