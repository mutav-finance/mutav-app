# Tenant underwriting architecture — verify → credit analysis → offer products

> **Canonical version promoted to `docs/architecture/`.** This file is the transient brainstorm artifact. The durable record lives in [`docs/architecture/underwriting.md`](../../architecture/underwriting.md) (architecture + data model + phasing) and [`docs/architecture/decisions/0002-b2b2c-tenant-credit-data-governance.md`](../../architecture/decisions/0002-b2b2c-tenant-credit-data-governance.md) (data-governance decision). Edit those, not this.

**Date:** 2026-06-17
**Status:** Design approved (decisions locked); supersedes the framing of `2026-06-16-screening-domain-design.md`
**Supersedes:** the "screening domain" framing — `screening` is renamed `creditRisk` and trimmed to risk-only; the underwriting *decision* moves out of it (see Decisions).

## Problem

When an agency submits a tenant and continues, Mutav must **verify the customer**, **run a credit/default risk analysis**, and **decide which guarantee product(s) it can safely offer** — keeping the protocol solvent. The earlier design modeled only "store a credit score," which conflated three distinct concerns and produced a schema that didn't fit the actual decision pipeline or Mutav's data-governance posture.

This spec defines the full architecture: three reusable capability modules composed at contract-creation, a product catalog, a coverage-decision artifact, and the LGPD data-governance substrate the B2B2C model requires — phased so the operational flow ships now and the proprietary-dataset capability is captured-early / built-later under counsel guidance.

## Reframe

Mutav is **B2B2C**: agencies (B2B) collect a tenant's (B2C) data and submit it; **Mutav decides** whether/how to service the tenant. Mutav is therefore the **data controller** for tenant data (`regulatory.md:28`), the agency is the collection point / co-controller, and the bureau is a processor or separate controller. This makes a **proprietary cross-agency dataset** an intended, lawful goal (with conditions) rather than a privacy problem.

The pipeline is **verify → credit-analyze → offer**, composed from independent units:

```
compliance/   VERIFICATION (KYC/identity)     → verifications          reusable: tenant · agency KYB · investor KYC
creditRisk/   CREDIT ANALYSIS (default risk)  → creditRiskAssessments  (renamed from screening; risk-only)
products/     CATALOG (guarantee products)    → products               admin-managed; global `enabled` capacity switch
contracts/    COMPOSITION → coverageDecisions  (verify + creditRisk ∩ enabled catalog → eligible set)
```

## Decisions (locked)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Pipeline shape | `verify → credit analysis → offer products` as three composable units + a composition | Verification has value beyond credit (reused across tenant/agency/investor); composition is one consumer |
| D2 | Decision output | **Eligible product set** from a catalog (+ recommended + reasons) | User choice; products are named bundles, agency picks |
| D3 | Protocol-health gate | **Hybrid**: per-tenant risk gates the set ∩ a coarse global `enabled` switch (reserve-coverage stress) | Per-tenant fine-grained capacity proved unnecessary; global switch suffices |
| D4 | Verify vs risk | **Separate** concerns/artifacts; verification is a hard gate (fail → decline) | KYC/identity is pass/fail and reusable; credit is graded |
| D5 | Verification home | **`convex/compliance/`** KYC vendor abstraction (`startVerification/getStatus/getRef/revoke`, per compliance.md) | Already specced, cross-actor, session-based |
| D6 | Risk module name | **`convex/creditRisk/`** (renamed from `screening`); UI/product term = "credit analysis" | "screening" over-claimed (sanctions/registration are compliance); disambiguates from compliance's AML *risk classification* |
| D7 | Data controller | **Mutav-BR is controller**; agency is collection point / co-controller; bureau is processor/separate controller | `regulatory.md:28`; ANPD ties controllership to who sets the purpose |
| D8 | Legal basis (operational) | **Art. 7, X "proteção do crédito"** (no consent) + legítimo-interesse backstop (LIA) | Credit-market standard; CPF is not sensitive data |
| D9 | Proprietary dataset basis | **Separate purpose** — legítimo-interesse + LIA, or **anonymization** — never the underwriting basis | Purpose-limitation (LGPD Art. 6 I); training ≠ underwriting |
| D10 | Anonymization | `subjectHash = HMAC(CPF)` is **pseudonymization, in-scope**; a training corpus needs **true anonymization** (drop join key, generalize quasi-identifiers) | LGPD Art. 12; the single biggest trap |
| D11 | Dataset timing | **Capture outcome labels from day one; build model/anonymization pipeline later** (counsel-gated) | A dataset "over time" requires early capture; model is later + needs volume + counsel |
| D12 | Coverage-decision home | Owned by the **contract-creation composition** (`contracts/`), referencing verification + credit analysis | Decision is underwriting, not a screening concern |

## Architecture

### Modules (each: one concern, subject-keyed, independently testable)

- **`compliance/` — verification.** Vendor providers behind `startVerification/getStatus/getRef/revoke`. Produces `verifications` keyed by `subjectHash`, freshness-windowed, reusable app-wide. Sensitive KYC payloads stay at the vendor; we store summary + `vendorRef`.
- **`creditRisk/` — credit analysis** (rename of `screening`, trimmed). Capability-typed providers (`bigdatacorp`, …) → `creditRiskSignals` (immutable) → `creditRiskAssessments` (score → tier; the "credit analysis"). Purpose-neutral; the underwriting framing is removed.
- **`products/` — catalog.** Admin-managed guarantee products: terms bundle + `minTier` eligibility + `requiresVerified` + global `enabled` switch.
- **`contracts/` — composition.** `runTenantUnderwriting(contract)`: verify ∥ credit-analyze (reuse fresh) → gate on verified → intersect `enabled` catalog by `minTier` → write one `coverageDecision`.

### Data model

**Operational (in LGPD scope — pseudonymized via `subjectHash`):**

- `verifications` (compliance): `subjectType, subjectHash, provider, status(pending|verified|failed), vendorRef, reasons[]?, verifiedAt, expiresAt, requestedByAgencyId?`
- `creditRiskSignals` (creditRisk): as built, **`purpose` promoted onto each signal**; `agencyId` retained as collection context (Mutav-controlled, not siloed).
- `creditRiskAssessments` (creditRisk): `agencyId, subjectType, subjectHash, score, tier, policyVersion, signalIds[], status(ok|unavailable), assessedAt` — **`purpose` removed** (now purely credit analysis).
- `products` (products): `slug, name, description, terms{rentMultiplier, exitCostMultiplier, feeCents, oneTimeActivationFeeCents, coverageCapCents}, minTier, requiresVerified, enabled, effectiveFrom/To?`
- `coverageDecisions` (contracts): `contractId, agencyId, subjectType, subjectHash, verificationId, creditRiskAssessmentId, outcome(offered|declined), eligibleProductIds[], recommendedProductId?, reasons[], policyVersion, decidedAt`

**Compliance substrate (new — required by the controller/dataset posture):**

- `processingBasisRecords`: `subjectHash, purpose, legalBasis(protecao_credito|legitimo_interesse|execucao_contrato|consentimento), basisDetail(LIA ref)?, termsVersion, collectedViaAgencyId, dataSharingAgreementRef?, timestamp, correlationId` — the auditable "we had a basis, here's purpose+scope+terms+when."
- **Purpose tags on signals** (above) — so "underwrite this guarantee" vs "train the model" are distinct, separately-based events, not silent drift.
- `tenantOutcomes` (Phase B capture-early): `subjectHash, contractRef, outcomeType(default|claim_paid|cured|completed_no_claim), observedAt, amountCents?, correlationId` — the proprietary dataset's **labels**. In-scope while keyed by `subjectHash`; carries its own `model_training` basis.
- **Anonymization boundary** → `trainingCorpus` (Phase B build-later): a one-way export that drops `subjectHash`/identifiers and generalizes quasi-identifiers; **out of LGPD scope only if anonymization holds** (survives erasure). Architecturally separate from the operational store.
- **Art. 20 reasons record**: criteria/main factors driving the tier + `policyVersion` + `humanInLoop` flag — supports right-to-review of automated credit decisions, balanced against trade-secret (Art. 20 §2). The existing `unavailable → manual review` path is the human-in-loop seam.

### Data flow (at "agency submits tenant, continue")

1. `runTenantUnderwriting` records a `processingBasisRecord` (purpose `tenant_underwriting`, basis `protecao_credito`).
2. Runs `verify(subject)` (compliance) ∥ `assessCredit(subject)` (creditRisk), reusing fresh results within their windows.
3. Gate: not `verified` → `coverageDecision{outcome: declined, reasons}`.
4. Else intersect `enabled` catalog by `tier ≥ minTier` → `eligibleProductIds` + `recommended` + reasons → one `coverageDecision` linked to the contract, with an Art. 20 reasons record.
5. Agency picks a product → its terms populate the contract's `rental` bundle.

### Error handling / fail policy

Signals-only at the provider layer (errors → signal, never fabricated score; `unavailable` assessment routes to manual review). Verification failure → decline with reasons. Provider/vendor down → degraded/manual, never silent approval.

## Phasing

- **Phase A — operational underwriting (buildable now).** verify → credit analysis → products → coverage decision, on the `proteção ao crédito` basis, **with compliance seams**: purpose tags on signals, `processingBasisRecords`, Art. 20 reasons. No model, no aggregation-for-training. Includes the `screening → creditRisk` rename + trim, the `compliance` verification module, the `products` catalog, and the `contracts` composition.
- **Phase B — proprietary dataset (capture-early, build-later, counsel-gated).** Begin writing `tenantOutcomes` labels from day one (cheap, time-sensitive). Defer the anonymization pipeline + `trainingCorpus` + proprietary scoring model until there is data volume **and** counsel has answered the dataset/aggregation questions below.

## Legal / compliance — conservative assumptions (proceed on these; counsel confirms)

- Mutav-BR is controller; agency is collection point / co-controller (data-sharing agreement + collection notice required).
- Underwriting processes on **Art. 7, X** (no consent); legítimo-interesse + LIA backstop.
- The proprietary dataset is a **separate purpose** — legítimo-interesse + LIA, or anonymized; **no third-party sharing** of scores/data (keeps Mutav a *consulente*, not a *gestor* under Lei 12.414).
- `HMAC(CPF)` is pseudonymization (in scope); only a truly anonymized `trainingCorpus` is out of scope.

### Open questions for counsel (gating Phase B)

1. Agency controllership structure (separate vs joint controller) + required collection-notice wording.
2. Does Art. 7 X reach a *fiança/garantia locatícia*, or must legítimo-interesse carry underwriting?
3. Gestor vs consulente line under Lei 12.414 for an internal-only dataset; where sharing crosses it.
4. Is model-training a "compatible finalidade," or a new purpose needing its own basis/disclosure?
5. Anonymization standard to clear Art. 12 reversibility for a credit-outcome corpus.
6. Retention ceiling (LGPD minimization) vs floor (CVM 5-yr) for `creditRiskSignals` + `tenantOutcomes` (ties to #114).
7. Art. 20 explainability depth (given ANPD NT 12/2025) + the human-review path for adverse tiers.
8. Exact cross-agency aggregation disclosure + per-agency data-sharing agreements.
9. Cross-border (US-hosted Convex) constraints on credit data beyond generic SCCs.

Full sourcing in the research thread; promote to `docs/architecture/regulatory.md` + an ADR when counsel confirms.

## Disposition of prior work (PR #188 / `2026-06-16-screening-*`)

PR #188 built `convex/screening/` (provider port, BigDataCorp/cpfcnpj/mock adapters, registry, idempotent signals, fan-out action, tenant-credit migration). It is **superseded in framing, not thrown away**: its provider/signal engine is the core of `creditRisk`. Phase A reshapes it (rename `screening→creditRisk`, drop the `purpose`/decision overload, add purpose tags + basis seam) rather than rebuilding. **Do not merge #188 as-is** — fold it into the Phase A slices.

## Non-goals (this spec)

- The proprietary scoring model itself and the anonymization pipeline (Phase B, counsel-gated).
- Investor KYC and agency-KYB consumers of `compliance/verification` (separate consumers; this spec only builds the tenant path + the reusable verification module).
- Tranche/product economics beyond the catalog shape.

## Decomposition (slices → separate plans)

1. **A1 — `screening → creditRisk` rename + trim** (reshape #188): rename domain/tables/api, drop `purpose` from assessments, promote `purpose` onto signals, add `processingBasisRecords` + a basis write in the credit path. Keeps tenant credit working.
2. **A2 — `products/` catalog**: table + admin CRUD + `enabled` switch + seed.
3. **A3 — `compliance/` verification module**: vendor port + `verifications` + a verify use case (provider TBD; can ship with a mock/stub provider + the port).
4. **A4 — `contracts/` composition + `coverageDecisions`**: `runTenantUnderwriting` composing A1+A3, intersecting A2's catalog, writing the decision + Art. 20 reasons; wire into the contract-creation flow.
   - **Open (resolve when A4 is planned):** does the decision key to a `contractId` or a pre-contract `proposalId`? Underwriting runs at "agency submits tenant, continue" — if that's *before* the contract row exists, the decision keys to a proposal/draft and links to the contract on creation. The spec writes `contractId` provisionally; confirm against the actual contract-creation flow.
5. **B1 — `tenantOutcomes` capture** (capture-early): table + write hooks on default/claim/contract-close.

Each slice is its own spec→plan→implementation cycle. A1 is the natural first (it unblocks the rename and keeps the existing tenant-credit path green).
