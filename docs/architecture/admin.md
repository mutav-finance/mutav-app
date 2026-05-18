# Mutav Admin — Architecture

> Mutav Admin is the surface where Mutav-internal staff operate the platform: review agency onboarding, audit liquidation requests, observe fund state, and (later) manage treasury flows. It is a distinct shell with cross-tenant access — every other surface is agency-scoped or wallet-scoped. This document covers the architectural shape of the **admin foundations bundle** (shell, role, onboarding review, default-request approval) and sketches the future pillars (fund payments, onchain observability).

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
- The multisig signing tool (external — likely Stellar Lab or a dedicated multisig UI for v1; see [`regulatory.md`](regulatory.md) for governance constraints on the signer set)

### A4 — Fund payments management (sketch)

Mutav charges agencies for guarantees (per-contract activation fee + ongoing percentage). That money flows: tenant pays agency invoice → agency pays Mutav SA → Mutav SA covers liquidations. Today the `payments` domain handles tenant → agency invoices end-to-end (Pix or Stellar). A4 adds the Mutav-side observability layer: invoice settlement across all agencies, treasury reconciliation between agency-paid Pix (Etherfuse) and the Mutav SA onchain balance.

A4 will own no new domain — it's a Mutav-admin view over the existing `payments` domain plus a new reconciliation layer that joins offchain settlement (Etherfuse) with onchain treasury (Stellar account). Architecturally it sits at the intersection of `payments`, `anchors`, and `fundState`. Detail when A4 enters scope.

### A5 — Fund-side onchain observability (sketch)

Read-only Mutav-admin view of fund state: NAV per fund, AUM, contract count, redemption queue depth, weekly cap utilization, treasury balances, multisig signer set, contract paused/upgrade status. Shares the indexer infrastructure with the investor portal's I2 (real fund data) — same Convex tables, different consumers. The Mutav-admin view exposes operator-only fields (signer set, paused state) that the investor view does not.

The indexer is the architecturally significant piece. It is documented in [`onchain-integration.md`](onchain-integration.md).

### A6 — NAV updates (sketch)

NAV (Net Asset Value) updates are the most safety-critical admin operation in the protocol. Wrong NAV directly causes wrong mint and redeem amounts — the failure class that most-prosecuted DeFi protocols (Mango Markets, Curve LP exploit, …) have been compromised on. A6 is the architectural surface for safely operating NAV updates.

- **Authority:** Only `mutavStaff` with sub-role `treasury` (or `admin`) can propose NAV updates. Onchain commit requires multisig consensus per [`onchain-integration.md`](onchain-integration.md) and [`regulatory.md`](regulatory.md).
- **Inputs are captured:** active layer value, liquidity layer value, outstanding shares — recorded in the audit log on every proposal so external auditors can reproduce the computation at any historical point.
- **Safeguards** (full spec in [`reliability.md`](reliability.md) § NAV safety):
  - Per-epoch change cap (NAV cannot move more than X% per update; threshold X is set by treasury policy in the compliance runbook)
  - Monotonicity invariants where applicable (active layer's yield accrual is one-way)
  - Pause-on-deviation circuit breaker (if indexer-observed onchain NAV differs from Convex-recorded proposal beyond tolerance, mint and redeem pause)
  - No automated NAV updates — human-triggered with multisig consensus, always
- **Failure path:** the regulatory-pause primitive (per [`compliance.md`](compliance.md)) is the kill switch — single-actor invocation, multisig lift.

A6 will own:

- `nav` domain (or extension of `fundState`) — NAV proposals, inputs, current value per fund per chain
- Read: `fundState` (current onchain NAV via indexer)
- Write: `nav.proposals`, `mutavAuditLog`
- Gates: compliance domain (`treasury` sub-role required; regulatory pause respected)

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

- [`compliance.md`](compliance.md) — account types, verification levels, risk classification, limits — the gating layer that every admin operation respects
- [`reliability.md`](reliability.md) — workflow durability for A3 liquidation, NAV safety for A6, audit log integrity
- [`regulatory.md`](regulatory.md) — CVM/BCB/LGPD constraints that shape these pillars
- [`onchain-integration.md`](onchain-integration.md) — indexer, multisig write path, contract topology
- [`investor.md`](investor.md) — counterpart surface; shares the indexer infrastructure
