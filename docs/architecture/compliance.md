# Compliance Architecture

> The compliance domain is the **operational layer** that translates regulatory requirements (see [`regulatory.md`](regulatory.md)) into per-account state: who they are, what they have verified, what risk they carry, what they can do today, and how much. Every actor on the platform has a compliance posture; every state-changing operation is gated by it. This document defines the taxonomy, the state machine, and the capability matrix. It does not set specific limit amounts or pick vendors — those are operational decisions made by the compliance team within this framework.

## Why a separate compliance domain

Authentication (who are you) and authorization (what role do you have) are not enough for a financial product. A KYC-verified investor with admin role can still be blocked from depositing because their risk classification is elevated, or because they exceeded a monthly cap, or because regulators paused their jurisdiction. These checks are orthogonal to identity and role — they belong in a domain that every other domain consults before allowing a state change.

The compliance domain owns:

- **Account classification** — what kind of account each principal is (the type and level taxonomy below)
- **Verifications** — what each account has proven (KYC, KYB, source of funds, qualified investor declaration)
- **Risk** — the current risk classification per account (low / medium / high / blocked)
- **Limits** — configurable rules that gate operations (per-day, per-month, per-lifetime caps)
- **Capability resolution** — given an account and a requested operation, can they do it right now
- **Review queue** — cases that need human decision (level upgrades, risk escalations, manual unblocks)

It does **not** own:

- Identity or authentication (lives in `users`, `mutavStaff`, Auth0, wallet)
- Domain-specific business rules ("a contract can't be cancelled after activation" — lives in `contracts`)
- The audit log (compliance writes to the shared `mutavAuditLog` — see [`reliability.md`](reliability.md))

## Account types

Every principal on the platform has exactly one account type. The type determines the verification model, the surface they access, and the capability matrix that applies. Types are exhaustive — every interaction starts by resolving the principal to a type.

| Account type                    | Surface                            | Identity source                            | Principal of                                                                |
| ------------------------------- | ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| **Anonymous visitor**           | `(public)`, `(investor)` read-only | None                                       | Browse-only sessions                                                        |
| **Tenant**                      | `(public)/pay/[publicId]`          | `publicId` bearer                          | A single assigned contract                                                  |
| **Agency member**               | `(app)`                            | Auth0 (planned) → `users` + `memberships`  | An agency, with role `member` / `admin` / `owner`                           |
| **Investor — retail PF**        | `(investor)`                       | Wallet on a supported chain                | One (chain, wallet) pair                                                    |
| **Investor — qualified PF**     | `(investor)`                       | Wallet + qualified-investor classification | One (chain, wallet) pair with CVM 175 qualified declaration                 |
| **Investor — institutional PJ** | `(investor)`                       | Wallet + corporate KYB                     | A corporate entity holding through a wallet                                 |
| **Mutav-internal staff**        | `(admin)`                          | Auth0 (planned) → `users` + `mutavStaff`   | Mutav itself, with sub-role `admin` / `compliance` / `support` / `treasury` |

Account type is not mutable in the normal case — a retail investor doesn't become an institutional investor; if institutional capacity is needed, a new account is opened. The exception is **upgrade within the investor family** (retail → qualified, retail PF → institutional PJ via a separate KYB) — those are explicit state transitions reviewed by the compliance team.

### Per-chain account instances (investor only)

By design (see [`investor.md`](investor.md)), each (chain, wallet) pair is a distinct investor account. The same person operating on Stellar and Solana has two unrelated accounts in this domain. Each carries its own verification level, risk classification, and limit budget. Cross-chain linking is a future capability anticipated by [`regulatory.md`](regulatory.md) (for per-CPF tax aggregation) but is not v1 architecture.

## Verification levels

Verification level applies primarily to **investor** accounts. Other account types have their own verification model:

- **Agency staff** — verified through agency onboarding (KYB on the agency itself, then staff invitation via Auth0)
- **Tenant** — not verified; bearer-token access only
- **Mutav-internal staff** — verified through Auth0 + manual `mutavStaff` row provisioning
- **Anonymous visitor** — never verified

For investors, the level ladder:

| Level                       | Verifications required                                                                                            | Brazilian regulatory anchor                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **L0 — Connected**          | Wallet connected; no PII collected                                                                                | None (read only)                                            |
| **L1 — Identified**         | CPF + email + phone (PF) or CNPJ + corporate contact (PJ)                                                         | BCB 519/2025 minimum identification                         |
| **L2 — Verified**           | L1 + biometric liveness + ID document + proof of address                                                          | BCB 519/2025 + LGPD-compliant biometric (Unico / Caf grade) |
| **L3 — Enhanced**           | L2 + source-of-funds attestation + sanctions/PEP screening                                                        | BCB 519/2025 source-of-funds + COAF screening               |
| **L4 — Qualified investor** | L3 + CVM 175 qualified investor declaration (R$1M+ net financial assets, or financial professional certification) | CVM Resolução 175 Art. 4                                    |
| **L5 — Institutional**      | L4-equivalent corporate KYB + signed master agreement                                                             | CVM 175 + sector-specific rules per institutional class     |

Levels are achieved sequentially. A user at L2 wanting to reach L4 completes L3 first. Level downgrade is possible (compliance can revoke a level after a finding) and is itself an audit-logged decision.

### Level state and transitions

Each level has a state independent of the level itself:

- `not_started` — user has not initiated this level's verification
- `pending` — verification submitted, awaiting vendor or human review
- `passed` — level achieved
- `failed` — verification rejected (vendor or manual); recovery path documented in compliance runbook
- `expired` — periodic re-verification due (e.g., re-attestation of source of funds every N months)
- `revoked` — compliance team rescinded the level after a finding

Transitions produce audit log entries with the actor (vendor name or staff user id), the inputs (vendor request id), and the resulting state. The compliance domain owns the state machine; consumers query "what level is this account at right now" via a single resolution call.

### KYC vendor abstraction

The architectural commitment from [`regulatory.md`](regulatory.md) — `convex/compliance/providers/{vendor}.ts` implementing a stable interface (`startVerification`, `getStatus`, `getRef`, `revoke`) — lives in this domain. Multiple vendors can be active simultaneously (failover; or different vendors per investor class). The compliance domain orchestrates the verification workflow (see [`reliability.md`](reliability.md) § Workflow durability) and persists the resulting state; the vendor holds the sensitive payloads.

## Risk classification

Orthogonal to level. A fully-verified L3 investor can carry a risk classification that elevates friction or blocks operations entirely. Risk classification is the compliance team's lever for AML, sanctions, and behavioral anomalies.

| Classification       | Effect                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| **Low**              | Reduced friction (no additional approvals); standard limits apply                                |
| **Medium** (default) | Standard limits and friction                                                                     |
| **High**             | Elevated friction (manual review on large operations); reduced limits; weekly monitoring         |
| **Blocked**          | All state-changing operations refused; read access preserved; visible to compliance review queue |

Risk classification is set by the compliance team (manual) or by automated rules (sanctions list hit, velocity threshold). Every classification change is audit-logged with the triggering signal. A `Blocked` classification can be set autonomously by the system (e.g., on sanctions list match) but only **lifted** by manual compliance review — never automatically.

### Inputs to risk

The architecture supports inputs from:

- **Sanctions/PEP screening** (vendor — typically the KYC provider or a dedicated provider like Refinitiv World-Check)
- **Transaction monitoring** (velocity, value, geography, counterparty patterns)
- **Manual flags** (compliance team observation, COAF report filed, regulator inquiry)
- **External signals** (chain analytics provider flagging a wallet — Chainalysis, TRM Labs)

The compliance domain doesn't implement transaction monitoring itself — it receives signals and translates them to classification changes. The actual monitoring (whether vendor-mediated or in-house) plugs in as a separate concern.

## Account state machine

Beyond verification level and risk classification, the account itself has a lifecycle state:

```
   ┌──────────┐  user opens account     ┌────────────┐  initial verification    ┌─────────┐
   │   New    ├────────────────────────►│  Pending   ├─────────────────────────►│ Active  │
   └──────────┘                         │ verification│                          └────┬────┘
                                        └─────┬──────┘                                │
                                              │                                       │
                                              │ rejected / abandoned                  │ compliance hold
                                              ▼                                       ▼
                                        ┌──────────┐                            ┌──────────────┐
                                        │  Failed  │                            │  Restricted  │
                                        └──────────┘                            └──────┬───────┘
                                                                                       │
                                                                                       │ resolved / never resolved
                                                                                       ▼
                                                                                ┌──────────────┐
                                                                                │ Closed/Banned │
                                                                                └──────────────┘
```

- **New** — account exists in domain but no verification started
- **Pending verification** — at least one verification level in flight
- **Active** — account is operational at its current level; can perform operations the level + risk + limits allow
- **Restricted** — compliance hold (separate from risk = Blocked; restricted is account-state, blocked is risk-state); state-changing operations refused until resolved
- **Closed/Banned** — terminal; read access preserved for legal retention period (CVM 5-year requirement), then PII-scrubbed per LGPD

State transitions are audit-logged. The wrapper that gates state-changing handlers resolves account state in the same pass it resolves level and risk — one check, one outcome.

## Transaction limits — rules, not constants

Limits are configurable rule rows, not code constants. This lets the compliance team adjust without deploys (which would require re-verification of the entire deploy pipeline for a financial change).

A limit rule has the shape:

| Field               | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| Scope               | Account type, verification level, risk classification, or specific account id |
| Operation           | What operation this limit applies to (deposit, redeem, transfer)              |
| Window              | Time window (per-day, per-month, per-lifetime, rolling-30-day)                |
| Currency / asset    | Which asset the cap measures                                                  |
| Cap                 | The maximum allowed                                                           |
| Precedence          | Tie-break when multiple rules match                                           |
| Effective from / to | Time-bounded rule (for promotional periods, regulatory holds)                 |

Resolution: when an operation is requested, the compliance domain selects the most specific matching rule and returns either "allowed" or "would exceed cap X with current usage Y". The handler enforces the answer.

### Why this matters architecturally

If limits live in code, every limit change is a deploy + audit + announcement cycle. With rule rows, limit changes are audit-logged admin operations (made through the `(admin)` shell by `mutavStaff` with role `compliance`) — fast, traceable, reversible. The architecture supports this from day one; the alternative ("we'll move it to a table later") is the classic technical debt that compounds.

### Limit categories the architecture must support

- **Per-account caps** — most common (this investor can deposit up to X/month)
- **Per-account-class caps** — applies to all L1 investors (default rules)
- **Per-jurisdiction caps** — region-based, where the architecture knows the user's region
- **Per-fund caps** — applies regardless of account (the fund itself has a redemption cap per the whitepaper)
- **Velocity caps** — N operations per time window (separate from value caps)

### Example default rules (for the official policy doc)

Architecture commits to the rule shape and resolution semantics. The example default rule set below is **for the official compliance policy document, not for code**. Values are starting points constrained by Brazilian regulation; the compliance team adjusts in production through the `(admin)` shell.

The 2.5% weekly redemption cap and 0.25% redemption fee are protocol-level invariants set by the whitepaper, not compliance rules — they live on the fund contract itself and are not adjustable per account.

| Scope                       | Operation                         | Window       | Cap                               | Regulatory anchor                                                                                                |
| --------------------------- | --------------------------------- | ------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| L0 (Connected)              | Deposit                           | —            | **0** (refused)                   | BCB 519/2025 — no anonymous transactions                                                                         |
| L0 (Connected)              | Redeem                            | —            | **0** (refused)                   | BCB 519/2025                                                                                                     |
| L1 (Identified)             | Deposit                           | per-month    | example: **R$ 5,000**             | Aligned with BCB low-friction onboarding bracket (revisit when the regulator publishes specific VASP thresholds) |
| L1 (Identified)             | Deposit                           | per-lifetime | example: **R$ 30,000**            | Caps total exposure pre-full-KYC                                                                                 |
| L1 (Identified)             | Redeem                            | —            | **0** (refused)                   | BCB 519/2025 — full KYC required before BRL outflow                                                              |
| L2 (Verified)               | Deposit                           | per-month    | example: **R$ 100,000**           | Retail PF default                                                                                                |
| L2 (Verified)               | Redeem                            | per-month    | example: **R$ 100,000**           | Mirrors deposit; subject to fund-level weekly cap                                                                |
| L2 (Verified)               | Deposit                           | per-day      | example: **R$ 25,000**            | Velocity smoothing                                                                                               |
| L3 (Enhanced)               | Deposit                           | per-month    | example: **R$ 1,000,000**         | Source-of-funds verified                                                                                         |
| L3 (Enhanced)               | Redeem                            | per-month    | example: **R$ 1,000,000**         | Mirrors deposit                                                                                                  |
| L3 (Enhanced)               | Transfer to other verified wallet | per-day      | example: **R$ 250,000**           | Optional capability                                                                                              |
| L4 (Qualified)              | Deposit / Redeem                  | per-month    | example: **R$ 10,000,000**        | CVM 175 qualified investor minimum (R$ 1M+ net financial assets) justifies higher cap                            |
| L4 (Qualified)              | Access to restricted products     | —            | **enabled**                       | CVM 175 Art. 4                                                                                                   |
| L5 (Institutional)          | All operations                    | —            | **Custom per contract**           | Negotiated per institutional onboarding                                                                          |
| Risk = High                 | Deposit                           | per-day      | example: **50% of class default** | Velocity reduction for elevated risk                                                                             |
| Risk = High                 | Operations above R$ 50,000        | per-event    | **Requires manual review**        | Adds friction without removing capability                                                                        |
| Risk = Blocked              | Any state-changing operation      | —            | **0** (refused)                   | Read-only access preserved                                                                                       |
| Regulatory pause (any axis) | Operations in scope               | —            | **0** (refused)                   | Highest-precedence rule; lifted only by multisig                                                                 |

Notes:

- **Currency.** Caps are in BRL for BR retail and stablecoin-equivalent (USDC/USDT at the latest fund-mint quote) for crypto-native investors. The compliance domain resolves the equivalency at evaluation time.
- **Multi-rule resolution.** When an investor is L2 + Risk=High, the most specific rule applies. L2 default cap is R$ 100k/month; Risk=High cap is 50% of class default = R$ 50k/month. Lowest cap wins.
- **Per-CPF aggregation.** The per-chain-account model means an L2 investor with both a Stellar wallet and a Solana wallet (when Solana ships) has separate per-account caps per chain. Per-CPF aggregation across chains is anticipated by [`regulatory.md`](regulatory.md) but not v1 architecture — until it lands, each chain's account has independent caps.
- **Effective dates.** Promotional periods (e.g., relaxed L1 cap for first 30 days) and regulatory holds (e.g., emergency cap during reconciliation pause) use the `effective from / to` fields rather than rule edits.

These values are **examples for the official policy document**; the compliance team confirms them with legal/regulatory counsel before production. The architecture supports any value combination.

## Capability matrix

Capabilities are what an account can do, given its type, level, risk, state, and the operation it's attempting. The matrix is the source of truth for "can this user do this thing right now". UI components consult the matrix to enable/disable buttons; handlers consult the matrix server-side to enforce the answer.

### Investor capabilities by level

The matrix below covers cross-cutting investor capabilities. Tranche-specific subscription capabilities (which level can hold MTVH vs MTVM vs MTVL) live in [`tranches.md`](tranches.md) § Tranche × verification-level capability matrix and are an overlay on top of these — an investor at L2 can deposit (capped) into MTVM or MTVL but not MTVH, regardless of cap headroom.

| Capability                                                              | L0  | L1         | L2         | L3  | L4              | L5  |
| ----------------------------------------------------------------------- | --- | ---------- | ---------- | --- | --------------- | --- |
| Browse `Mutav-Fund`, view NAV, view portfolio                           | ✓   | ✓          | ✓          | ✓   | ✓               | ✓   |
| Connect wallet, link account                                            | ✓   | ✓          | ✓          | ✓   | ✓               | ✓   |
| Sign Subscription Agreement with `Mutav-Fund`                           | —   | ✓          | ✓          | ✓   | ✓               | ✓   |
| Deposit MTVL / MTVM (mint, capped per tranche)                          | —   | ✓ (capped) | ✓ (capped) | ✓   | ✓               | ✓   |
| Deposit MTVH (subordinada — see [`tranches.md`](tranches.md))           | —   | —          | —          | —   | ✓ (if L4 floor) | ✓   |
| Redeem MTVL / MTVM (burn)                                               | —   | —          | ✓ (capped) | ✓   | ✓               | ✓   |
| Redeem MTVH (above SitG floor)                                          | —   | —          | —          | —   | ✓               | ✓   |
| Transfer tokens to other verified wallets                               | —   | —          | —          | ✓   | ✓               | ✓   |
| Access qualified-investor-only products                                 | —   | —          | —          | —   | ✓               | ✓   |
| Programmatic API access                                                 | —   | —          | —          | —   | —               | ✓   |
| Statements + tax reports (inc. cross-jurisdiction PII for BR investors) | —   | ✓          | ✓          | ✓   | ✓               | ✓   |

Risk classification overlays this: a Blocked classification removes all "✓" except read-only browse. A High classification adds friction (manual review on deposits above a threshold) without removing the capability outright.

**BR investor overlay.** A BR-resident investor's tranche access is further gated by their CVM 175 classification per [`regulatory.md`](regulatory.md) § Marketing offshore Fund to BR investors. A BR L4 (qualificado) investor can subscribe to `Mutav-Fund` under the "restricted to qualified investors" oferta pública carve-out; a BR L2 (retail) investor cannot subscribe at all, even though they have L2 capabilities for everything else. The most-restrictive rule wins.

### Agency staff capabilities by role

| Capability                     | Member | Admin | Owner |
| ------------------------------ | ------ | ----- | ----- |
| View agency contracts          | ✓      | ✓     | ✓     |
| Create / edit contracts        | ✓      | ✓     | ✓     |
| Open delinquency on a contract | ✓      | ✓     | ✓     |
| Invite agency members          | —      | ✓     | ✓     |
| Configure agency settings      | —      | ✓     | ✓     |
| Manage billing                 | —      | —     | ✓     |
| Submit KYB documents           | —      | ✓     | ✓     |

Agency staff don't have verification levels (agency-side KYB is the agency's verification, not the staff member's). They do have role and they do have a personal risk classification (a member flagged for fraud loses the ability to act on contracts).

### Mutav-internal capabilities by sub-role

(Authoritative version in [`admin.md`](admin.md). Reproduced here for the matrix view. The **Entity** column indicates which of the three Mutav legal entities (see [`entities.md`](entities.md)) the capability is exercised on behalf of. A Mutav-internal user can hold roles across multiple entities — for v1 the same physical operations team serves all three.)

| Capability                                  | Entity                      | Admin | Compliance | Support       | Treasury |
| ------------------------------------------- | --------------------------- | ----- | ---------- | ------------- | -------- |
| Review agency onboarding                    | `Mutav-BR`                  | ✓     | ✓          | —             | —        |
| Approve / reject agency                     | `Mutav-BR`                  | ✓     | ✓          | —             | —        |
| Read all agencies / contracts (no write)    | `Mutav-BR`                  | ✓     | ✓          | ✓             | ✓        |
| Adjust investor verification level          | `Mutav-Fund` (KYC ref)      | ✓     | ✓          | —             | —        |
| Adjust risk classification                  | `Mutav-Fund`                | ✓     | ✓          | —             | —        |
| Adjust limit rules                          | both                        | ✓     | ✓          | —             | —        |
| Attest liquidation request (A3)             | cross-entity                | ✓     | —          | —             | ✓        |
| Propose NAV update (treasury role)          | `Mutav-Mgmt` → `Mutav-Fund` | ✓     | —          | —             | ✓        |
| Execute treasury operations (sign onchain)  | `Mutav-Mgmt`                | ✓     | —          | —             | ✓        |
| File BACEN câmbio reports                   | `Mutav-BR`                  | ✓     | ✓          | —             | —        |
| File offshore fund regulator reports        | `Mutav-Mgmt`                | ✓     | ✓          | —             | ✓        |
| Manage `mutavStaff` (invite / role change)  | all                         | ✓     | —          | —             | —        |
| Initiate regulatory pause (kill switch)     | per pause dimension         | ✓     | ✓          | —             | ✓        |
| View audit log (cross-domain, cross-entity) | all                         | ✓     | ✓          | ✓ (read only) | ✓        |
| Resolve support tickets                     | `Mutav-BR`                  | ✓     | —          | ✓             | —        |

The **`treasury` sub-role serves `Mutav-Mgmt`** specifically — it's the signing role for the offshore-Fund-controlling multisig (per [`regulatory.md`](regulatory.md) § Multisig governance). The **`compliance` sub-role spans both `Mutav-BR` and `Mutav-Mgmt`** because BR-side KYC + AML and offshore-side Subscription Agreement compliance are tightly coupled (the same person screening an investor is responsible for both BCB 519 and offshore-jurisdiction AML). The **`support` sub-role is `Mutav-BR`-scoped** (tenants and agencies are the support audience; investors get separate-channel support).

A Mutav-internal user can hold multiple sub-roles across multiple entities. Effects are additive. Role grants and revocations are themselves auditable operations performed by users with the `admin` sub-role; entity scoping is preserved on the audit entry (a role grant is logged as `MUTAV_BR:grant(role=compliance)` etc).

### Tenant capabilities

A tenant accesses only `(public)/pay/[publicId]` and can only pay the assigned invoice. No other capabilities; no escalation path; the bearer token is the entire authorization.

## Compliance review flow

The Mutav `compliance` sub-role on `mutavStaff` operates a review queue. Items land in the queue from multiple sources:

- **Verification escalations** — L3 source-of-funds attestations that need human verification
- **L4 / L5 upgrade requests** — qualified investor and institutional onboarding requires manual confirmation
- **Risk escalations** — sanctions match, velocity threshold, manual flag
- **Account state changes** — restriction requests, unblock requests
- **Audit triggers** — anomalies the audit-log monitor surfaces (out of scope here; operational)

The queue itself is a Convex query against the compliance domain — every record in `pending` / `restricted` state with metadata about why. The `(admin)` shell renders it under the compliance pillar (see [`admin.md`](admin.md) A2 — which is one specific use case of this queue).

Review decisions are state changes; they produce audit log entries; they may trigger workflows (e.g., approving an L4 upgrade triggers a workflow that updates state, notifies the user, recalculates the limit budget, and unblocks restricted operations).

## How the compliance domain plugs in

Every state-changing public handler in the protocol's domains follows this pattern:

1. Auth wrapper resolves identity and (where applicable) agency scope — see [`../auth.md`](../auth.md)
2. Compliance domain is consulted for the operation: "can this account perform this operation now, against this asset, with this value?"
3. If yes: proceed and (where applicable) record the operation against the limit budget
4. If no: return a Result error with a structured code (`COMPLIANCE_LEVEL_INSUFFICIENT`, `COMPLIANCE_RISK_BLOCKED`, `COMPLIANCE_LIMIT_EXCEEDED`, `COMPLIANCE_REGULATORY_PAUSE`)

The compliance check is a single function call from the handler's perspective. Internally it resolves type + level + risk + state + limits in one pass. Adding new capabilities, levels, or risk inputs doesn't change the call site — only the internal resolution.

### Pre-Auth0 / dev mode

The dev `dev-user` row is provisioned at the highest available levels (L5 investor + `admin` mutavStaff + active state + low risk) so the dev workspace exercises the full capability surface without manual KYC. The compliance check still runs — the wrapper isn't bypassed — but always returns "allowed" for dev-user. This is the same shape as the auth wrapper's dev shortcut (see [`../auth.md`](../auth.md)); when Auth0 lands, the dev user's compliance posture is provisioned from a fixture, not from real KYC vendor flows.

## Regulatory pause — the kill switch

A specific architectural primitive worth naming: a single admin operation (executed by `admin`, `compliance`, or `treasury` sub-role) that pauses all state-changing operations across one dimension:

- **Per-entity** (pause all `Mutav-BR` operations while `Mutav-Fund` continues, or vice versa — useful when one entity faces a regulator inquiry without contagion)
- **Per-jurisdiction** (pause all BR investors)
- **Per-operation** (pause all deposits across the platform)
- **Per-tranche** (pause MTVH inflows/outflows while MTVM and MTVL continue — see [`tranches.md`](tranches.md))
- **Per-fund** (pause `Mutav-Fund` deposits, redeems, or both)
- **Global** (pause everything except read access)

The pause is implemented as the highest-precedence limit rule (`cap = 0`, effective immediately). Lifting the pause requires multisig — single-actor lift is not allowed. This makes the kill switch trivial to invoke (one click) and intentionally hard to reverse (forces multi-actor consensus). Multisig signer set depends on the pause dimension — entity-scoped pauses lift on that entity's multisig; cross-entity pauses need co-signers from both entities.

Required for: BCB 519/2025 compliance posture (regulators expect this capability for `Mutav-BR` and its counterparties), offshore fund-admin pause capability (`Mutav-Mgmt` for `Mutav-Fund`), reconciliation circuit breaker (see [`reliability.md`](reliability.md) § Three-axis reconciliation), per-tranche NAV deviation circuit breaker (see [`reliability.md`](reliability.md)).

## Out of scope for this doc

- Specific limit amounts (operational; lives in compliance runbook)
- Specific KYC vendor selection (see [`regulatory.md`](regulatory.md) for criteria)
- Specific risk-scoring algorithms or transaction monitoring rules (operational)
- COAF reporting integration specifics (vendor-mediated)
- Tax reporting (operational, downstream of the compliance domain's account classification)
- Investor onboarding UX (design work, separate track)

## Related reading

- [`README.md`](README.md) — actor catalog, shell catalog
- [`entities.md`](entities.md) — the three Mutav entities; sub-roles in this doc scope per entity
- [`tranches.md`](tranches.md) — MTVH/MTVM/MTVL specification and the tranche × level matrix
- [`admin.md`](admin.md) — Mutav-staff sub-roles and review pillars (per entity); A2 is one consumer of this domain
- [`investor.md`](investor.md) — investor account model, KYC gating at redeem, Subscription Agreement to `Mutav-Fund`
- [`regulatory.md`](regulatory.md) — what regulators require that this domain implements (per entity)
- [`reliability.md`](reliability.md) — workflows for verification and review, three-axis reconciliation, audit log, regulatory pause primitive
- [`../auth.md`](../auth.md) — auth wrappers that the compliance check plugs into
