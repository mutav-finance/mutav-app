# ADR 0002 — B2B2C data governance for tenant credit data

**Status:** Accepted (2026-06-17) — operational assumptions; Phase B (proprietary dataset) gated on counsel · **Phase:** tenant underwriting ([underwriting.md](../underwriting.md)) · **Tracking:** [#184](https://github.com/mutav-finance/mutav-app/issues/184) (tier→product), audit retention [#114](https://github.com/mutav-finance/mutav-app/issues/114)

## Context

Mutav underwrites rental guarantees in a **B2B2C** model: real-estate agencies collect a tenant's personal data (CPF, name, …) and submit it; Mutav verifies the tenant, runs a credit/default risk analysis, and decides which guarantee product to offer. Mutav also wants to **accumulate a proprietary dataset over time** (credit signals + repayment/default outcomes) to optimize its own scoring rather than depend solely on bureau scores.

This raises Brazilian data-compliance questions LGPD alone doesn't settle — they sit at the overlay of **LGPD + Lei do Cadastro Positivo (Lei 12.414/2011, LC 166/2019) + CDC + the emerging ANPD regulation of automated decisions (Art. 20)**. The repo had decided PII crypto ([ADR 0001](0001-pii-crypto-pattern.md)) and designated `Mutav-BR` as controller for tenant data ([regulatory.md](../regulatory.md):28), but nothing addressed controllership of the _agency_, the legal basis for credit underwriting, or the lawfulness of a proprietary credit dataset.

This is a working decision on **conservative assumptions**; the items in _Open questions for counsel_ must be confirmed before Phase B ships. This is not legal advice.

## Decision

1. **Controller = Mutav-BR.** ANPD ties controllership to who decides the _finalidade_; Mutav decides the underwriting purpose and means. The **agency is the collection point and a co-/separate controller** for its own leasing purpose; data flows agency→Mutav under a data-sharing basis + a collection notice. Bureaus are processors or separate controllers per contract. Because Mutav is controller (not each agency in a silo), **cross-agency aggregation into a Mutav-owned dataset is lawful in principle**, subject to disclosure + purpose (below).

2. **Legal basis for underwriting = Art. 7, X "proteção do crédito"** (no consent required), with **legítimo interesse (Art. 7, IX) + a documented LIA** as backstop. CPF/credit history are **not** sensitive data (Art. 11 does not gate). Every processing event is stamped with its purpose + basis in a `processingBasisRecords` row.

3. **The proprietary dataset is a distinct purpose.** Reusing identifiable underwriting data to train a proprietary score is **not** covered by the underwriting basis (purpose limitation, Art. 6 I). It requires either its own basis (legítimo interesse + LIA + disclosure) **or** anonymization.

4. **Pseudonymization ≠ anonymization.** The repo's `subjectHash = HMAC(CPF)` is _pseudonymization_ — reversible with the pepper, therefore **still personal data, still in LGPD scope, still subject to erasure**. A training corpus is out of scope (and survives erasure) **only** behind a true **anonymization boundary**: drop the join key/identifiers, generalize quasi-identifiers, ensure no reasonable re-identification.

5. **Capture-early, build-later.** Start writing outcome labels (`tenantOutcomes`) from day one (a "dataset over time" requires early capture). Defer the anonymization pipeline + `trainingCorpus` + proprietary model until there is data volume **and** counsel has answered the questions below.

6. **No third-party data sharing (Phase A/B default).** Keep the dataset internal-only. Sharing scores/data with third parties risks crossing from _consulente_ into _gestor de banco de dados_ under Lei 12.414, inheriting that regime — out of scope until deliberately revisited.

7. **Automated-decision transparency (Art. 20).** Persist an explainability "reasons" record (criteria/main factors + `policyVersion` + human-in-loop flag) so an adverse automated tier is reviewable, balanced against trade-secret (Art. 20 §2). The `unavailable → manual review` path is the human-in-loop seam; a review-on-request path for adverse tiers is required.

## Architectural consequences (what gets stored)

- `processingBasisRecords` — purpose · legalBasis · termsVersion · collecting-agency · data-sharing-agreement ref · timestamp.
- **Purpose tags promoted onto `creditRiskSignals`** — underwriting vs model-training are distinct, separately-based events.
- `tenantOutcomes` — default/claim/cure labels (in scope while keyed by `subjectHash`; own `model_training` basis). Phase B capture.
- **Anonymization boundary** → out-of-scope `trainingCorpus`, architecturally separate from the operational store. Phase B build.
- **Art. 20 reasons record** keyed by `policyVersion`.
- Erasure ([regulatory.md](../regulatory.md):29 pattern): operational tables honor Art. 18 (blank encrypted PII, drop hash lookups, keep financial tombstone); a truly-anonymized `trainingCorpus` survives erasure.

See [underwriting.md](../underwriting.md) for the full data model and module map.

## Open questions for counsel (gate Phase B)

1. Agency controllership structure (separate vs joint controller) + required collection-notice wording.
2. Does Art. 7 X reach a _fiança/garantia locatícia_, or must legítimo-interesse carry underwriting?
3. Gestor vs consulente line under Lei 12.414 for an internal-only dataset; where sharing crosses it.
4. Is model-training a "compatible finalidade," or a new purpose needing its own basis/disclosure?
5. Anonymization standard to clear Art. 12 reversibility for a credit-outcome corpus.
6. Retention ceiling (LGPD minimization) vs floor (CVM 5-yr) for `creditRiskSignals` + `tenantOutcomes` (ties to [#114](https://github.com/mutav-finance/mutav-app/issues/114)).
7. Art. 20 explainability depth (given ANPD NT 12/2025) + the human-review path for adverse tiers.
8. Exact cross-agency aggregation disclosure + per-agency data-sharing agreements.
9. Cross-border (US-hosted Convex) constraints on credit data beyond generic SCCs.

## Consequences

**Positive:** the dataset goal is designed-in lawfully from the start (early capture, purpose tags, basis records); the biggest trap (treating pseudonymized data as anonymized) is foreclosed; Phase A ships on a solid basis without waiting on every counsel answer.

**Negative / cost:** a compliance substrate (basis records, purpose tags, outcome labels, anonymization pipeline, reasons records) is non-trivial; Phase B is hard-gated on counsel; the anonymization boundary is a real engineering surface, not a flag.
