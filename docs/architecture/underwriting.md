# Tenant Underwriting Architecture — verify → credit analysis → offer products

**Status:** Design accepted (2026-06-17); Phase A buildable, Phase B counsel-gated.
**Decision record:** data-governance decisions in [ADR 0002](decisions/0002-b2b2c-tenant-credit-data-governance.md). Architecture decisions D1–D12 below.
**Tracking:** tier→product mapping [#184](https://github.com/mutav-finance/mutav-app/issues/184). Brainstorm origin: `docs/superpowers/specs/2026-06-17-tenant-underwriting-architecture-design.md` (transient).

## Purpose

When an agency submits a tenant and continues, Mutav must **verify the customer**, run a **credit/default risk analysis**, and **decide which guarantee product(s) it can safely offer** while keeping the protocol solvent. This doc is the canonical map of that pipeline and the domains that implement it.

## Model — B2B2C, composed capabilities

Mutav is **B2B2C**: agencies (B2B) collect a tenant's (B2C) data and submit it; **Mutav decides** whether/how to service the tenant. Mutav is therefore the **data controller** for tenant data (see [ADR 0002](decisions/0002-b2b2c-tenant-credit-data-governance.md) and [regulatory.md](regulatory.md) § Tenant credit data).

The pipeline is three **independent, reusable capability modules** composed by contract creation:

```
compliance/      VERIFICATION (KYC/identity)     → verifications              reusable: tenant · agency KYB · investor KYC
creditAnalysis/  CREDIT ANALYSIS (default risk)  → creditAnalysisAssessments  capability-typed bureau providers → score/tier
products/        CATALOG (guarantee products)    → products                   admin-managed; global `enabled` capacity switch
contracts/       COMPOSITION → coverageDecisions  (verify + creditAnalysis ∩ enabled catalog → eligible product set)
```

**Separation of concerns is the core idea:** verification (identity/KYC) is a reusable asset valuable beyond credit; credit analysis is a graded risk; the _coverage decision_ (which products) is underwriting — owned by the composition, not by either capability. None of the three modules knows about the others; the composition wires them.

## Architecture decisions (D1–D12)

| #   | Decision                  | Choice                                                                                                                                                                              |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Pipeline shape            | `verify → credit analysis → offer products` — three composable units + a composition                                                                                                |
| D2  | Decision output           | **Eligible product set** from a catalog (+ recommended + reasons)                                                                                                                   |
| D3  | Protocol-health gate      | **Hybrid** — per-tenant risk gates the set ∩ a coarse global `enabled` switch (reserve-coverage stress)                                                                             |
| D4  | Verify vs risk            | **Separate** concerns/artifacts; verification is a hard gate (fail → decline)                                                                                                       |
| D5  | Verification home         | **`convex/compliance/`** KYC vendor abstraction (`startVerification/getStatus/getRef/revoke`)                                                                                       |
| D6  | Risk module name          | **`convex/creditAnalysis/`** (renamed from `screening`); UI term = "credit analysis"; disambiguated from compliance's AML _risk classification_                                     |
| D7  | Data controller           | **Mutav-BR is controller**; agency is collection point / co-controller; bureau is processor/separate controller — [ADR 0002](decisions/0002-b2b2c-tenant-credit-data-governance.md) |
| D8  | Legal basis (operational) | **Art. 7, X "proteção do crédito"** (no consent) + legítimo-interesse backstop                                                                                                      |
| D9  | Proprietary-dataset basis | **Separate purpose** — legítimo-interesse + LIA, or anonymization — never the underwriting basis                                                                                    |
| D10 | Anonymization             | `subjectHash = HMAC(CPF)` is **pseudonymization (in scope)**; a training corpus needs **true anonymization**                                                                        |
| D11 | Dataset timing            | **Capture outcome labels day one; build model/anonymization pipeline later** (counsel-gated)                                                                                        |
| D12 | Coverage-decision home    | Owned by the **contract-creation composition** (`contracts/`), referencing a verification + a credit analysis                                                                       |

## Modules

- **`compliance/` — verification.** Vendor providers behind `startVerification/getStatus/getRef/revoke`. Produces `verifications` keyed by `subjectHash`, freshness-windowed, reusable app-wide. Sensitive KYC payloads stay at the vendor; store summary + `vendorRef`.
- **`creditAnalysis/` — credit analysis** (renamed from `screening`). Capability-typed providers (`bigdatacorp`, …) → `creditAnalysisSignals` (immutable) → `creditAnalysisAssessments` (score → tier; the "credit analysis"). Purpose-neutral, subject-keyed, reusable across contracts within an agency.
- **`products/` — catalog.** Admin-managed guarantee products: terms bundle + `minTier` eligibility + `requiresVerified` + global `enabled` switch.
- **`contracts/` — composition.** `runTenantUnderwriting`: verify ∥ credit-analyze (reuse fresh) → gate on verified → intersect `enabled` catalog by `minTier` → write one `coverageDecision` (+ Art. 20 reasons).

## Data model

**Operational (in LGPD scope — pseudonymized via `subjectHash`):**

| Table                       | Domain         | Shape (essential)                                                                                                                                                                                           |
| --------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifications`             | compliance     | `subjectType, subjectHash, provider, status(pending\|verified\|failed), vendorRef, reasons[]?, verifiedAt, expiresAt, requestedByAgencyId?`                                                                 |
| `creditAnalysisSignals`     | creditAnalysis | append-only; `agencyId, subjectType, subjectHash, capability, provider, status, normalized{score,scale}?, error?, vendorRef?, correlationId, windowKey, pulledAt`                                           |
| `creditAnalysisAssessments` | creditAnalysis | `agencyId, subjectType, subjectHash, policyVersion, signalIds[], status(ok\|unavailable), score?, tier?, assessedAt`                                                                                        |
| `products`                  | products       | `slug, name, terms{rentMultiplier, exitCostMultiplier, feeCents, oneTimeActivationFeeCents, coverageCapCents}, minTier, requiresVerified, enabled, effectiveFrom/To?`                                       |
| `coverageDecisions`         | contracts      | `contractRef, agencyId, subjectType, subjectHash, verificationId, creditAnalysisAssessmentId, outcome(offered\|declined), eligibleProductIds[], recommendedProductId?, reasons[], policyVersion, decidedAt` |

**Compliance substrate (new — required by the controller/dataset posture; see [ADR 0002](decisions/0002-b2b2c-tenant-credit-data-governance.md)):**

- `processingBasisRecords` — per-event basis: `subjectHash, purpose, legalBasis, basisDetail?, termsVersion, collectedViaAgencyId, dataSharingAgreementRef?, timestamp, correlationId`.
- **Purpose tags on signals** — so "underwrite this guarantee" vs "train the model" are distinct, separately-based events.
- `tenantOutcomes` (Phase B, capture-early) — `subjectHash, contractRef, outcomeType(default\|claim_paid\|cured\|completed_no_claim), observedAt, amountCents?` — the proprietary dataset's **labels**.
- **Anonymization boundary** → out-of-scope `trainingCorpus` (Phase B, build-later) — drops `subjectHash`/identifiers, generalizes quasi-identifiers; out of LGPD scope only if anonymization holds (survives erasure).
- **Art. 20 reasons record** — criteria/main factors + `policyVersion` + `humanInLoop` flag, for right-to-review of automated credit decisions (balanced against trade-secret).

## Data flow (at "agency submits tenant, continue")

1. `runTenantUnderwriting` records a `processingBasisRecord` (purpose `tenant_underwriting`, basis `protecao_credito`).
2. Runs `verify(subject)` (compliance) ∥ `assessCredit(subject)` (creditAnalysis), reusing fresh results within their windows.
3. Gate: not `verified` → `coverageDecision{outcome: declined, reasons}`.
4. Else intersect `enabled` catalog by `tier ≥ minTier` → `eligibleProductIds` + `recommended` + reasons → one `coverageDecision` linked to the contract, with an Art. 20 reasons record.
5. Agency picks a product → its terms populate the contract's `rental` bundle.

**Fail policy:** providers return signals, never throw a fabricated score; an all-error pull → `unavailable` assessment → manual review. Verification failure → decline with reasons. Vendor down → degraded/manual, never silent approval.

## Phasing

- **Phase A — operational underwriting (buildable now).** verify → credit analysis → products → coverage decision on the `proteção ao crédito` basis, with compliance seams (purpose tags, `processingBasisRecords`, Art. 20 reasons). Slices: A1 `screening→creditAnalysis` rename+trim · A2 `products` catalog · A3 `compliance/` verification · A4 `contracts/` composition + `coverageDecisions`.
- **Phase B — proprietary dataset (capture-early, build-later, counsel-gated).** Write `tenantOutcomes` from day one; defer the anonymization pipeline + `trainingCorpus` + proprietary scoring model until data volume + counsel sign-off. See [ADR 0002](decisions/0002-b2b2c-tenant-credit-data-governance.md) § Open questions for counsel.

## Status / disposition

- `creditAnalysis` provider+signal engine is built, renamed, and trimmed (slice A1, PR #188; originally `convex/screening/`).
- `compliance/verification`, `products`, the `contracts` composition, and the compliance substrate are not yet built.

## Related reading

[compliance.md](compliance.md) (KYC vendor abstraction, risk classification, capability matrix) · [regulatory.md](regulatory.md) (LGPD, controller model) · [security.md](security.md) (PII crypto) · [ADR 0001](decisions/0001-pii-crypto-pattern.md) (two-key envelope) · [ADR 0002](decisions/0002-b2b2c-tenant-credit-data-governance.md) (B2B2C data governance).
