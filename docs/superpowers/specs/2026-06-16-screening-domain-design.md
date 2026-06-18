# Screening domain — vendor-neutral risk/verification signal layer

**Date:** 2026-06-16
**Branch:** `feat/bigdatacorp-integration`
**Status:** Design approved (decisions locked); pending spec review → implementation plan

## Problem

Mutav needs external-data-driven **risk analysis for tenant scoring** (rental-guarantee
underwriting) and **agency data verification on onboarding** (KYB). A working BigDataCorp
integration already exists for tenant credit scoring (`convex/contracts/scoreProviders.ts`),
but it is:

- **Vendor-shaped, not capability-shaped** — a single `fetchScore(cpf) → number` that can't
  express registration/KYB lookups or compose multiple bureaus.
- **Lock-in prone** — naming a domain `bigdatacorp` (or growing `scoreProviders` per vendor)
  bakes one vendor into the architecture. We expect to **compose multiple providers** to
  improve risk analysis.
- **Carrying a provenance bug** — on any provider error it silently falls back to mock and
  persists the mock score labeled as the real provider (`contracts/actions.ts:31-45` writes
  `provider: provider.name` after `result` came from mock).

We want a vendor-neutral layer where BigDataCorp is *one provider among several*, consumed by
both the contracts (tenant) and compliance (agency) domains without either depending on a vendor.

## What this is — and is not

The existing architecture already names this seam. `compliance.md:96-105` defines **"Inputs to
risk"**: *"the compliance domain doesn't implement transaction monitoring itself — it receives
signals and translates them to classification."* **That signal pipe is the `screening` domain.**

- Screening **is** the signal-collection layer: fan out to data sources, normalize, persist
  signals + reproducible assessment snapshots.
- Screening **is not** the KYC verification *workflow* — that is the existing session-shaped port
  `convex/compliance/providers/{vendor}.ts` (`startVerification/getStatus/getRef/revoke`,
  compliance.md:79). Document/liveness verification, if ever needed, reuses that port.
- Screening **is not** the risk-classification state machine (`Low/Med/High/Blocked`) — that is
  compliance's (compliance.md:83-95). Screening *feeds* it.

`screening` becomes the **fourth provider family**, consistent with the repo's established
convention: `anchors/`, `settlement/providers/*`, `compliance/providers/*`.

## Locked decisions

| # | Decision | Choice | Rationale / citation |
|---|---|---|---|
| 1 | Composition model | **Fan-out + aggregate** | "compose better risk analysis"; compliance.md:96-105 multi-signal inputs |
| 2 | Domain name | **`convex/screening/`** | Names the activity, not the vendor or one consumer; avoids lock-in |
| 3 | Port shape | **Pull** — `query({subjectType, document, capability}) → signal` | Credit/registration/sanctions are request→response; session port already exists in compliance for KYC |
| 4 | Provider selection | **Capability-typed registry**, role `primary`/`hedge` as config | anchors capability flags + settlement role-as-config (regulatory.md:244) |
| 5 | Reproducibility | **Immutable signals + assessment snapshots** stamped `policyVersion` + `signalIds[]` | Risk decisions must be auditable & reproducible (compliance.md:94, reliability.md:304) |
| 6 | Idempotency | **Unique index** `(subjectHash, capability, provider, windowKey)`; insert-then-catch | Paid per query — no double charge (reliability.md:125) |
| 7 | Fail policy | **Signals-only; never auto-decide.** Provider error → `status:error` signal, excluded from aggregation; zero usable signals → assessment `unavailable` | Kills the provenance bug structurally; mirrors PR #178 "unavailable instead of R$ 0,00" |
| 8 | Payload storage | **Summary + vendor ref always; raw payload encrypted only where dispute/CVM-defensible (e.g. KYB registration)** | LGPD minimization (security.md: "PII stays at vendor") balanced against audit defensibility (constraint #26) |
| 9 | Subject model | **Polymorphic, keyed by `subjectHash = HMAC(document)`** (reuses `hashPii`) | Natural cache key; dedupes a CPF across consumers; matches today's `tenantCreditReports.cpfHash` |
| 10 | Sequencing | **Phase 1:** engine + `credit_score` + migrate tenant path. **Phase 2:** agency KYB consumer | Validate the abstraction against working, tested code before net-new |

## Architecture

### Layering

```
 external vendors      BigDataCorp · Serasa · sanctions/PEP · cpfcnpj
        ▲
 screening/providers/{vendor}.ts    adapters — vendor mechanics + capability→dataset map (per-vendor)
        ▲                            registry: capability-typed, role = primary|hedge
 screening/{domain,useCases,actions} ENGINE — resolve → fan-out → persist signals → snapshot assessment
        ▲                            signals-only; the "Inputs to risk" pipe
 consumers
   contracts/   → tenant underwriting tier (bom/regular/ruim/negado)
   compliance/  → risk classification (Low/Med/High/Blocked) + agency-KYB gate   [Phase 2]
```

### The port

```
Capability = subjectType × question
  e.g. credit_score (CPF|CNPJ), registration (CNPJ|CPF), sanctions_pep (CPF|CNPJ)

interface ScreeningProvider {
  readonly name: string                       // "bigdatacorp"
  readonly capabilities: readonly Capability[] // what it can answer
  query(req: { subjectType, document, capability }): Promise<ProviderSignal>
}
```

- The **adapter owns vendor mechanics** — BigDataCorp token mint, `/marketplace` POST, and the
  **capability→dataset map** (`credit_score → partner_boavista_one_score_person`,
  `registration → registration_data`). The single global `BIGDATACORP_DATASET` env var is
  removed; dataset choice becomes adapter config keyed by capability (still env-overridable).
- The **registry** resolves providers *by capability* with a `primary`/`hedge` role per
  capability. No silent fallback to mock (anchors precedent: surface error state, don't mask it).
  Mock remains available only via explicit dev config.

### Data model

**`screeningSignals`** — append-only, immutable:

| Field | Notes |
|---|---|
| `subjectType` | `tenant` \| `agency` \| `investor` |
| `subjectHash` | `HMAC(document)` via `hashPii` — indexed lookup key |
| `capability` | `credit_score` \| `registration` \| `sanctions_pep` … |
| `provider` | `bigdatacorp` \| `cpfcnpj` \| `mock` … |
| `status` | `ok` \| `error` |
| `vendorRef` | provider's query/reference id (audit trail) |
| `correlationId` | end-to-end id for reconciliation/audit |
| `pulledAt` | timestamp |
| `normalized` | `{ score+scale }` \| `{ flags }` \| `{ registrationSummary }` \| `{ hits }` |
| `rawEncrypted?` | present **only** for dispute/CVM-defensible capabilities (KYB registration); AES-256-GCM envelope + hash sidecar; erasable |

- Unique index `(subjectHash, capability, provider, windowKey)` → idempotency.
- Index `(subjectHash, capability, pulledAt)` → freshness/lookup.

**`screeningAssessments`** — derived snapshot; the row gates/UI read synchronously:

| Field | Notes |
|---|---|
| `subjectType`, `subjectHash` | as above |
| `purpose` | `tenant_underwriting` \| `agency_kyb` |
| `policyVersion` | which aggregation policy produced this |
| `signalIds[]` | provenance — exactly which signals fed this decision |
| `result` | consumer-shaped: tenant tier \| verification status \| risk class |
| `status` | `ok` \| `unavailable` |
| `decidedAt` | timestamp |

**Aggregation lives in the consumer, versioned.** The engine only gathers + stores signals; each
consumer owns a pure `policyVersion`-stamped function mapping the signal set to its `result`
(multi-provider merge policy — min/weighted/primary — is the consumer's swappable call).

### Subject model

Polymorphic subject `{ type, document, documentHash }`, keyed on `documentHash`. No unified
subject table; each consumer maps its entity → `(type, document)` (contracts: `tenant.cpf`;
agencies: `cnpj`/`cpf`). Per-chain investor caveat (investor.md:42) deferred to Phase 2+.

### Data flow

1. Consumer requests an assessment (e.g. `requestTenantRisk(cpf)`): fresh `screeningAssessment`
   within TTL → return cached; else schedule `screening.runScreening`.
2. `screening.runScreening` action: resolve providers for requested capabilities →
   `Promise.allSettled` fan-out → idempotent-insert each `screeningSignal` (skip if window
   already pulled) → consumer's versioned aggregation derives `result` → insert
   `screeningAssessment` snapshot.
3. Reactive read updates the UI (today's scheduler + reactive-table pattern, `useCases.ts:479`).

### Error handling & audit

- Provider error → `status:error` signal (audited), excluded from aggregation. **Never** a
  fabricated score.
- Zero usable signals → assessment `status: unavailable`; consumer routes to manual review /
  shows "indisponível", never a guessed number.
- Auto-`Blocked` risk class allowed **only** on a sanctions hit (compliance.md:94); lifted only by
  manual review.
- Each assessment and each risk-class change → audit-log entry with entity code + `correlationId`
  (reliability.md:304-346).

### Testing

`convex-test` with **stub adapters** (no live paid calls in CI):

- fan-out across N providers; one failing ≠ whole pull failing
- idempotency: double `runScreening` in the same window → exactly one signal row
- aggregation policy versions produce expected `result` from fixed signal sets
- `unavailable` path when all providers error
- erasure: `eraseUserData` blanks `rawEncrypted` + drops lookup rows
- adapter **contract tests** against recorded vendor fixtures

## Phase 1 — scope (this spec → implementation plan)

**Build the engine and migrate the working tenant path.**

1. `convex/screening/domain.ts` — `Capability`, `ProviderSignal`, `ScreeningProvider` types;
   validators; `SCREENING_PROVIDER` / capability constants.
2. `convex/screening/providers/{bigdatacorp,cpfcnpj,mock}.ts` — port adapters; BigDataCorp adapter
   owns token mint + `/marketplace` + capability→dataset map. Credentials via lazy env getters
   (existing `getBigDataCorp*`), dataset map internal.
3. `convex/screening/registry.ts` — capability-typed resolution + `primary`/`hedge` role config.
4. `convex/screening/useCases.ts` + `actions.ts` — `runScreening` fan-out, idempotent signal
   persistence, assessment snapshot write.
5. `schema.ts` — add `screeningSignals`, `screeningAssessments` + indexes.
6. **Migrate contracts tenant path:** `requestCreditScore` → thin consumer calling screening with
   `credit_score`; tenant tier becomes the contracts aggregation policy (`tenant_underwriting`
   assessment); retire `contracts/scoreProviders.ts` + the `fetchCreditScore` fallback bug. The
   score/tier is **folded into `screeningAssessments`** as the single source of truth;
   `tenantCreditReports` is replaced by reads of the assessment (migrate existing rows or keep a
   thin compatibility view — decide in plan). Phase 1 **surfaces the score/tier only** — it does
   not yet drive contract terms (see [#184](https://github.com/mutav-finance/mutav-app/issues/184)).
7. Tests per above; update `docs/architecture/README.md` domain catalog + a short
   `convex/screening/README.md`.

## Phase 2 — outline (separate spec)

Agency KYB consumer: `registration` capability (CNPJ situação cadastral, QSA/partners, address),
`rawEncrypted` retained for dispute defense, compliance-domain consumer mapping signals → agency
`verificationStatus` + risk classification, wired into `agencies` onboarding review
(`adminUseCases.ts`). New `agencies` verification fields. Consult `security.md` for the new PII
field; honor LGPD erasure.

## Constraints honored

- PII: `subjectHash` via existing two-key envelope; `rawEncrypted` only where defensible; erasable
  (security.md, ADR 0001).
- Idempotency + correlationId for paid calls (reliability.md:125).
- Audit logging of assessments / risk-class changes (compliance.md:94, reliability.md:304).
- No silent vendor fallback for compliance-grade decisions (anchors precedent).
- On-convention with the existing provider-family layout.

## Out of scope

- **Tenant tier → contract product/terms** — deferred to
  [#184](https://github.com/mutav-finance/mutav-app/issues/184). Phase 1 surfaces the score/tier;
  nothing consumes the tier to select a product yet (contract terms stay fixed defaults). The
  current lean is a tier-eligible product catalog, unconfirmed — decided in #184.
- Investor screening / per-chain identity (investor.md:42) — future.
- Sanctions/PEP provider integration — capability is modeled; no vendor wired in Phase 1.
- Transaction-monitoring signals (velocity) — compliance receives these elsewhere.
- Vendor selection beyond BigDataCorp/cpfcnpj/mock — registry supports adding; no new vendor wired.

## Open questions (deferred, not blocking Phase 1)

- Re-screening cadence per subject type (tenant 24h today; agency KYB renewal TBD).
- Which sanctions/PEP provider, and whether it overlaps the investor KYC vendor (Sumsub).
- Entity ownership of investor screening (`Mutav-Fund` vs `Mutav-Mgmt`) — Phase 2+.
