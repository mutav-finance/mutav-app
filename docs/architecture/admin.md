# Mutav Admin — Architecture

> Mutav Admin is the surface where Mutav-internal staff operate the platform across the three entities (see [`entities.md`](entities.md)): review agency onboarding (`Mutav-BR`), screen investor compliance (`Mutav-Fund`), audit liquidation requests (cross-entity), observe fund state (`Mutav-Fund`), and (later) manage NAV updates and treasury operations (`Mutav-Mgmt`). It is a distinct shell with cross-tenant access — every other surface is agency-scoped or wallet-scoped. This document covers the architectural shape of the **admin foundations bundle** (shell, role, onboarding review, default-request approval) and sketches the future pillars (fund payments, onchain observability). Sub-role scoping per entity lives in [`compliance.md`](compliance.md) § Mutav-internal capabilities by sub-role.

## Scope

**In (foundations bundle):**

- A1 — Admin shell + role plumbing
- A2 — Agency onboarding & compliance review
- A3 — Default request approval

**Sketched (future):**

- A4 — Fund payments management
- A5 — Fund-side onchain observability

A5 shares infrastructure with the investor portal — see [`onchain-integration.md`](onchain-integration.md).

## Actor model

Mutav-internal users are a distinct actor from agency staff. They are not "an agency owner with admin powers"; they have no agency context at all. The data model reflects this.

### `mutavStaff` table (parallel to `memberships`)

`memberships` connects `users` to `agencies` with an agency-scoped role. `mutavStaff` connects `users` to the platform itself with a platform-scoped role. The two are independent — a user can be in both (e.g., a Mutav employee who also runs a test agency for QA), in either, or in neither.

Sub-roles encode "what can this Mutav staff member do":

| Role         | Permissions (architectural intent)                                   |
| ------------ | -------------------------------------------------------------------- |
| `admin`      | All operations across all pillars. Owner-equivalent.                 |
| `compliance` | A2 (onboarding review, approve/reject). Read-only on other pillars.  |
| `support`    | Read all agencies/contracts/payments for support tickets. No writes. |
| `treasury`   | A4 (fund payments) + A3 (default approval). No A2.                   |

Sub-roles are additive in effect (a `compliance` user can do compliance writes; a user with both `compliance` and `support` can do both). A user has zero or more `mutavStaff` rows, one per role. (Alternative — a single row with a role array — is simpler but loses per-role audit attribution. Defer that choice to implementation.)

### Pre-Auth0 stopgap

Today the wrappers resolve identity to a hardcoded `dev-user`. The same `dev-user` will be seeded with a `mutavStaff` row of role `admin` so the new shell renders in dev. The Auth0 swap is documented in [`../auth.md`](../auth.md); when it lands, `mutavStaff` rows are provisioned from Auth0 group membership (e.g., the Auth0 group `mutav-compliance` grants a row of role `compliance`).

## Shell architecture

### Same domain, separate route group

`(admin)/admin/*` lives in the same Next.js deployment as `(app)/*`. Shared session (one Auth0 login covers both), shared infrastructure (one Vercel project, one Convex deployment), zero duplicated code paths.

```
src/app/[locale]/
├── (app)/                  ← agency dashboard (existing)
│   └── layout.tsx          ← AppSidebar, agency switcher, agency-membership gate
├── (admin)/                ← Mutav admin (planned)
│   └── admin/
│       └── layout.tsx      ← AdminSidebar, Mutav branding, mutavStaff gate
└── (investor)/             ← investor portal (existing UI shell)
    └── layout.tsx          ← investor nav, wallet-aware
```

The shells are visually distinct on purpose. A Mutav-admin inside `(admin)` should never see "Agency X (Owner)" in the chrome — they are operating the platform, not an agency.

### Shell-switcher in user menu

A Mutav-admin who also has agency memberships flips between shells via a single link in `nav-user.tsx`:

- Inside `(app)` user menu: "Switch to Mutav admin →" → `/admin`
- Inside `(admin)` user menu: "Switch to agency view →" → `/` (lands on the last selected agency)

Same component, two render modes. Visible only when the current user has at least one `mutavStaff` row.

### Subdomain split as a future trigger

Same-domain is correct for v1. A future migration to `admin.mutav.app` is warranted when any of these trigger:

- Mutav-admin actions can affect customer funds (treasury moves) — cookie isolation becomes a hard requirement
- Auth0 needs separate applications for the two audiences (different MFA policies, different post-login flows)
- Regulatory scrutiny demands separation of audit surfaces

The migration cost is one extra Vercel project + DNS + a separate Auth0 application. It is reversible; do it when one of the triggers fires, not before.

## Auth wrapper integration

The existing `convex/lib/auth.ts` ships `*WithAgencyScope` wrappers for agency-scoped handlers (see [`../auth.md`](../auth.md)). Admin handlers need a parallel family — they require staff role membership, not agency membership.

```
queryWithMutavStaff       — any mutavStaff row exists
mutationWithMutavStaff    — any mutavStaff row exists
queryWithMutavRole({ minRole })       — staff with at least this sub-role
mutationWithMutavRole({ minRole })    — staff with at least this sub-role
```

Architectural properties:

- Same swap point as the existing wrappers — Auth0 migration is still one function (`resolveCurrentUser`)
- Cross-agency by design — handlers receive `ctx.user` and `ctx.mutavStaff` but **not** `ctx.agencyId` (there isn't one — admin operates across agencies)
- The agency-scope wrappers and the mutav-staff wrappers are mutually exclusive on a handler. A handler either operates inside one agency (agency staff) or across all agencies (mutav staff), never both. UI patterns that need "all agencies" data go through mutav-staff wrappers; the agency dimension is data, not auth.

The strict-compliance rule from [`../auth.md`](../auth.md) extends: **every public query/mutation under `(admin)` must use a `*WithMutav*` wrapper.** No bare `query`/`mutation` for admin handlers.

## Pillar responsibility map

Each pillar owns a slice of platform state. The slices are read-from and written-to according to the actor model — agencies own their own data; Mutav-admin observes across all agencies and writes only into Mutav-controlled domains.

### A1 — Shell + role (plumbing)

- Owns: `mutavStaff` table, `(admin)` shell, admin sidebar, layout gate, shell-switcher in user menu, the `*WithMutav*` wrapper family
- Reads: `users` (for shell-switcher visibility)
- Writes: nothing (the foundation for everything else)

### A2 — Compliance review

Mutav-side counterpart to the agency-side onboarding wizard (separate issue, agency-driven). Agencies submit; Mutav-admin reviews. **A2 is one specific consumer of the broader `compliance` domain documented in [`compliance.md`](compliance.md)** — the same domain that gates investor account levels, risk classifications, and transaction limits. A2 is the agency-side surface; investor compliance is a separate surface on the same domain.

- Owns within `compliance`: agency onboarding state machine, compliance checklist state, approve/reject decisions, the review queue
- Reads: `agencies` (the agency under review), `anchors.anchorAccounts` (Etherfuse KYB status — see below), uploaded documents (storage backend separate)
- Writes: `compliance.reviews` (decisions + notes), `mutavAuditLog` (every write produces a row — via the `mutationWithMutavRole({ minRole: "compliance" })` wrapper that bakes audit-log writes in)
- External integrations: Etherfuse KYB step is a checklist item — Mutav-admin attests, but the actual KYB submission is between the agency and Etherfuse directly. See [`../stellar-anchors.md`](../stellar-anchors.md).

Approving the final checklist step flips `agencies.onboardingState` to `active`, transitions the agency's compliance state to `Active` per [`compliance.md`](compliance.md), and (per the existing #32/#45 work) unblocks the agency's Pix-anchor flow. This transition is implemented as a workflow per [`reliability.md`](reliability.md) § Workflow durability — multiple downstream effects must succeed atomically or roll back together.

### A3 — Default request approval

The whitepaper's Liquidação Programável flow puts Mutav-admin in a mandatory audit position between agency-detected default and onchain liquidation. The architectural shape:

```
┌────────┐        ┌────────────┐         ┌──────────────┐         ┌──────────────┐         ┌──────────┐
│Agency  │ open   │  Convex    │ pre-    │  Soroban     │ audit   │ Mutav-admin  │ multi-  │ Soroban  │
│dash    ├───────►│  delin-    ├────────►│  contract    ├────────►│ approval     ├────────►│ liquid-  │
│"Abrir" │ delin- │  quency    │ check   │  (read-only  │ queue   │ in (admin)   │ sig     │ ate fn   │
│        │ quency │  domain    │         │  view of     │         │ shell        │ sign    │          │
└────────┘        └────────────┘ ◄───────┤  conditions) │         └──────────────┘         └──────────┘
                       ▲                  └──────────────┘                                       │
                       │                                                                         │
                       └─────────────────  indexer observes execution  ──────────────────────────┘
```

- Step 1 (agency): existing `(app)` button opens a delinquency row
- Step 2 (Convex): `delinquencies` domain logs the request, triggers a read-only contract simulation via a Convex action
- Step 3 (Soroban): smart contract validates contract terms, returns pre-approval verdict (no state change yet)
- Step 4 (Mutav-admin): pre-approved requests land in an approval queue in `(admin)`. Mutav-admin attests with a sub-role of `admin` or `treasury`. **Convex records the attestation but does not sign.**
- Step 5 (external multisig + Soroban): the signed liquidation transaction is submitted via the multisig tool. The indexer (see [`onchain-integration.md`](onchain-integration.md)) observes execution and updates `delinquencies` row state.

**Implementation primitive:** the 5-step flow is implemented as a `@convex-dev/workflow` per [`reliability.md`](reliability.md) § Workflow durability — not as five independent mutations. Workflow guarantees (exactly-once mutations, at-least-once actions with retry, journal-based crash recovery) prevent partial-failure states like "attested in Convex but never submitted to multisig" or "submitted to multisig but state never advanced past `attested`". Step 5 (await onchain execution) uses workflow's sleep-until-event pattern, observed by the indexer.

A3 owns:

- `delinquencies` domain — request lifecycle (`opened` / `pre-approved` / `rejected` / `attested` / `submitted` / `executed` / `failed`)
- The workflow handler that coordinates the 5 steps
- Read: `contracts` (the contract being liquidated), `fundState` (which fund covers this contract — see [`onchain-integration.md`](onchain-integration.md))
- Write: `delinquencies.requests`, `mutavAuditLog`
- Gates: every state-changing operation in this flow consults `compliance` (per [`compliance.md`](compliance.md)) — e.g., `regulatory pause` halts new attestations

A3 does **not** own:

- The actual onchain liquidation function (lives in the Soroban contract, `mutav-stellar` repo)
- The signing wallets themselves (each ops staff member signs in their personal Lobstr Vault — push-notification-based, biometric approval; see [`regulatory.md`](regulatory.md) § Stellar implementation pattern)

A3 **does** own the **proposal queue UI** inside the `(admin)` shell — Mutav's Safe-equivalent. Stellar has no production-ready Safe/Squads-equivalent in 2026 (per [`regulatory.md`](regulatory.md)), so Mutav builds the queue: `treasury/proposals` route that constructs the XDR for the attested liquidation, persists pending transactions with collected signatures, exposes "Sign on Lobstr" deep links per signer, and submits to Stellar once the multisig threshold is met. The indexer observes execution and advances the workflow's terminal step. The queue is ~1–2 weeks of work and is shared by A6 (NAV updates) below.

### A4 — Fund payments management

`Mutav-BR` charges agencies for guarantees (per-contract activation fee + ongoing percentage). The money flow now crosses entities: tenant pays agency invoice → agency pays `Mutav-BR` → `Mutav-BR` retains 20% → `Mutav-BR` cedes 80% via cessão de recebíveis to `Mutav-Fund` (which mints TESOURO into its Stellar address) → `Mutav-Fund` covers liquidations on `Mutav-Mgmt`'s instruction (per A3). The existing `payments` domain handles tenant → agency invoices (the Pix portal under `(public)/pay/[publicId]`). A4 adds the **Mutav-side** layer: agency → `Mutav-BR` settlement, `Mutav-BR` → `Mutav-Fund` cessão, plus the Mutav-internal view across both legs.

**Treasury denomination: TESOURO.** `Mutav-Fund` holds Etherfuse's tokenized Brazilian Treasury bonds as the treasury asset — BRL-denominated, yield-bearing. Agency settlement lands in `Mutav-BR`'s BR bank account first; the cessão step mints TESOURO into `Mutav-Fund`'s Stellar address via the primary Etherfuse rail (BRL Pix → TESOURO direct); the BaaS rail (Transfero / Bitso / Foxbit) exists as capacity/concentration hedge per [`onchain-integration.md`](onchain-integration.md) § Agency settlement. The câmbio reporting on the cessão step is owned by `Mutav-BR` per [`regulatory.md`](regulatory.md) § BACEN câmbio reporting.

**A4 will own:**

- The agency-settlement orchestration workflow per [`onchain-integration.md`](onchain-integration.md) — covering both legs: agency → `Mutav-BR` Pix collection, and `Mutav-BR` → `Mutav-Fund` cessão (Etherfuse primary or BaaS hedge), both with quarantine state before treasury credit
- The `Mutav-Fund` TESOURO treasury float on Stellar (per [`reliability.md`](reliability.md) § Pre-funded float — float denomination is TESOURO) — admin UI for float monitoring + replenishment workflow (float operations executed by `Mutav-Mgmt`)
- The settlement provider abstraction (`convex/settlement/providers/{etherfuse,transfero,bitso,foxbit}.ts`) parallel to the KYC and anchor abstractions; Etherfuse is the primary, others are hedges
- Mutav-admin view over the `payments` domain at the platform level (all agencies, all flows, settlement state per invoice — including which leg is in flight)
- Reconciliation primitives applied to both legs — `correlationId` from agency Pix → `Mutav-BR` ledger → cessão event → onchain mint into `Mutav-Fund`, end-to-end. Maps to two of the three axes in [`reliability.md`](reliability.md) § Three-axis reconciliation.
- The MED 2.0 reversal handler: when an MED reversal arrives on the agency → `Mutav-BR` leg, cancel the quarantined event (no-op onchain); if quarantine had already cleared (cessão already executed and treasury credited), trigger an offsetting treasury operation rather than a silent rollback. Cross-entity unwind requires both `Mutav-BR` and `Mutav-Mgmt` attestations.

**A4 does not own:**

- The settlement provider's internal Pix infrastructure (delegated to provider — Etherfuse for primary, BCB-licensed BaaS for hedge)
- The destination chain's treasury account itself (lives in [`onchain-integration.md`](onchain-integration.md) § Contract topology — owned by `Mutav-Fund`, signed by `Mutav-Mgmt` keys)
- Specific vendor selection — see [`regulatory.md`](regulatory.md) § Settlement provider selection for the shortlist (Etherfuse primary; Transfero BaaSiC, Bitso Business, Foxbit Prime Desk as hedge candidates)

**Architectural sensitivity to land before A4 ships:**

- **Float sizing** is operational policy (set by `Mutav-Mgmt`'s treasury role based on observed reversal rate × 3 buffer per [`reliability.md`](reliability.md))
- **Quarantine window length** is pending Draau input per the [Pending Treasury Decisions pack](pending-treasury-decisions.md) (Decision 3 — 7/30/80 day options with stated trade-offs)
- **Regulatory cliff Oct 30, 2026** — `Mutav-BR` cannot transact with unauthorized VASPs after this date. Any settlement provider used on `Mutav-BR`'s side must clear the relevant BCB authorizations (IP authorization under Resolutions 494–497, May 2026 window; VASP authorization under Resolutions 519–521). Etherfuse's current status applies to the primary rail; each BaaS hedge candidate's status applies to the hedge path. Document each provider's status before integration ships.
- **Etherfuse concentration risk.** Etherfuse fills four roles across the architecture (investor on-ramp for `Mutav-Fund`, agency settlement primary for `Mutav-BR` → `Mutav-Fund` cessão, TESOURO issuer to `Mutav-Fund`, TESOURO redemption counterparty for `Mutav-Fund`) — four roles, one counterparty. A4's hedge-rail abstraction is the architectural mitigation; ensure at least one BaaS hedge integration is operational before any volume of agency capital flows through the system, even if Etherfuse-primary handles steady-state. Concentration risk also intersects with L3 (whether Etherfuse permits offshore TESOURO holding at all — see [`regulatory.md`](regulatory.md) § TESOURO as treasury asset).

### A5 — Fund-side onchain observability (sketch)

Read-only Mutav-admin view of fund state: NAV per fund, AUM, contract count, redemption queue depth, weekly cap utilization, treasury balances, multisig signer set, contract paused/upgrade status. Shares the indexer infrastructure with the investor portal's I2 (real fund data) — same Convex tables, different consumers. The Mutav-admin view exposes operator-only fields (signer set, paused state) that the investor view does not.

The indexer is the architecturally significant piece. It is documented in [`onchain-integration.md`](onchain-integration.md).

### A6 — NAV updates (sketch)

NAV (Net Asset Value) updates are the most safety-critical admin operation in the protocol. Wrong NAV directly causes wrong mint and redeem amounts — historically the most-prosecuted DeFi failure class (Mango Markets, Curve LP exploit, …). A6 is the architectural surface for safely operating NAV updates.

**Mutav's NAV inputs simplify because `Mutav-Fund`'s treasury holds TESOURO:** per [`reliability.md`](reliability.md) § NAV safety, both NAV inputs — rental-guarantee fee income (received from `Mutav-BR` via the cessão) and treasury yield (TESOURO accrual) — are exogenous, well-defined, not market-quoted. The Mango / Curve oracle-manipulation failure class is architecturally inapplicable to Mutav. What remains is the discipline of _computing_ per-tranche NAV correctly from those inputs and recording inputs in the audit log so external auditors can reproduce.

**Per-tranche NAV.** Each NAV update produces three new NAVs (one per tranche: MTVH / MTVM / MTVL — see [`tranches.md`](tranches.md)), not one. Loss waterfall (MTVH first → MTVM → MTVL) means MTVH may move more per epoch than MTVL. Per-epoch change cap applies per tranche, not globally. Pause-on-deviation tolerance is per-tranche. A6 owns the three-NAV update primitive.

- **Authority:** Only `mutavStaff` with sub-role `treasury` (which serves `Mutav-Mgmt` per [`compliance.md`](compliance.md)) or `admin` can propose NAV updates. Onchain commit requires multisig consensus by `Mutav-Mgmt` signers per [`onchain-integration.md`](onchain-integration.md) and [`regulatory.md`](regulatory.md).
- **Inputs are captured:** per-tranche active layer value, liquidity layer value, outstanding shares — recorded in the audit log on every proposal (tagged with entity code `MUTAV_MGMT` and `MUTAV_FUND`) so external auditors can reproduce the computation at any historical point.
- **Safeguards** (full spec in [`reliability.md`](reliability.md) § NAV safety):
  - Per-tranche per-epoch change cap (NAV cannot move more than X% per update; threshold X per tranche set by treasury policy in the compliance runbook)
  - Monotonicity invariants where applicable (active layer's yield accrual is one-way; the waterfall is loss-side only, appreciation distributes pro-rata)
  - Per-tranche pause-on-deviation circuit breaker (if indexer-observed onchain NAV differs from Convex-recorded proposal beyond tolerance, mint and redeem pause on that specific tranche)
  - No automated NAV updates — human-triggered with multisig consensus, always
- **Failure path:** the regulatory-pause primitive (per [`compliance.md`](compliance.md)) is the kill switch — can be invoked per-tranche, per-fund, or global. Single-actor invocation, multisig lift.

> 📌 **Pending input from Draau (treasury policy owner) — NAV update policy and deposit pricing approach.** Two of the three decisions in the [Pending Treasury Decisions pack](pending-treasury-decisions.md). NAV policy covers epoch length, per-epoch change cap, pause-on-deviation tolerance, and off-NAV operations during paused state. Deposit pricing covers BRL NAV vs dual share class vs USD NAV with TESOURO underlying. Architecture supports any combination — values land in the compliance runbook once decided.

A6 will own:

- `nav` domain (or extension of `fundState`) — NAV proposals, inputs, current value per fund per chain
- Read: `fundState` (current onchain NAV via indexer)
- Write: `nav.proposals`, `mutavAuditLog`
- Gates: compliance domain (`treasury` sub-role required; regulatory pause respected)
- Multisig surface: shares the **proposal queue UI** with A3 — same `treasury/proposals` route, different proposal type. The queue is the cross-pillar Safe-equivalent built into the `(admin)` shell.

This is the highest-stakes admin pillar; design it before any volume of investor capital is in production.

## Audit log architecture

Cross-tenant access requires forensic accountability. Every admin write produces an append-only `mutavAuditLog` row capturing actor, target, action, and timestamp. The log is:

- **Append-only at the domain level** — no `update` or `delete` mutations; the schema has no validators for them
- **Hash-chained for tamper evidence** — every entry carries `prevHash` (hash of the previous entry) and `hash` (hash of this entry's body + `prevHash`). Tampering with an old entry invalidates every subsequent `prevHash`, making detection trivial. Full pattern in [`reliability.md`](reliability.md) § Audit log integrity.
- **Merkle-anchored daily to Stellar** — a Convex cron computes the Merkle root of audit entries since the last anchor and submits it as a no-op transaction. External auditors verify by re-deriving the tree and comparing the root. Matches SEC Rule 17a-4(f) (2022) recognition of hash chains + Merkle trees as alternatives to WORM storage.
- **Wrapped into the mutation wrapper** — the `mutationWithMutavStaff` wrapper logs automatically on successful commit, including computing the `prevHash`/`hash` chain entries. Handlers cannot accidentally bypass it; they would need to switch to a different wrapper, which is reviewable.
- **Cross-domain** — one table for all admin writes (`compliance.review_passed`, `delinquencies.attested`, `mutavStaff.role_granted`, `nav.proposed`, `regulatory.paused`, …). Sub-domain tables would multiply audit surfaces; one table is one place to look during an incident.
- **Indexed by `(actor, at)` and `(targetType, targetId, at)`** so both "what did Alice do last week" and "what happened to agency X" are cheap queries.

The audit log is read by Mutav-admin only (gated by `mutavStaff` sub-role — `support` gets read access; full investigation requires `admin` or `compliance`). Agencies do not see Mutav's internal log; they see their own (agency-scoped) log of changes to their own data (which lives separately — see issue #49 for the agency-side audit-log scope).

The hash-chain + Merkle anchoring upgrade is the bar for CVM/BCB defensibility per [`regulatory.md`](regulatory.md). The append-only-by-convention baseline is acceptable for early v1 but should not be deferred past the point where real investor capital is in production.

## Out of scope for this doc

- Specific field names, validators, indexes — implementation, lives in the per-domain `domain.ts` when each domain is built
- Sidebar/UI mockups — design work, separate track
- Compliance vendor decisions (PEP screening, CNPJ lookups) — see [`regulatory.md`](regulatory.md) for selection criteria; specific vendor choice is operational
- Multisig tool selection — see [`regulatory.md`](regulatory.md) for governance constraints; specific tool choice is operational
- Auth0 application split (one app for both shells vs two) — revisit at Auth0 wiring time per [`../auth.md`](../auth.md)
- Specific NAV update epoch length and change-cap percentages — treasury policy, lives in compliance runbook
- Specific limit amounts for compliance gates — see [`compliance.md`](compliance.md); set by compliance team

## Related reading

- [`entities.md`](entities.md) — pillar-to-entity mapping; `Mutav-BR` vs `Mutav-Fund` vs `Mutav-Mgmt` scoping
- [`tranches.md`](tranches.md) — MTVH/MTVM/MTVL specification; per-tranche NAV update mechanics
- [`compliance.md`](compliance.md) — account types, verification levels, risk classification, limits, sub-role × entity matrix — the gating layer that every admin operation respects
- [`reliability.md`](reliability.md) — workflow durability for A3 liquidation, NAV safety for A6, three-axis reconciliation for A4, audit log integrity
- [`regulatory.md`](regulatory.md) — per-entity CVM/BCB/LGPD constraints, BACEN câmbio reporting that A4 owns
- [`onchain-integration.md`](onchain-integration.md) — indexer, multisig write path, offshore custody, contract topology
- [`investor.md`](investor.md) — counterpart surface; shares the indexer infrastructure
