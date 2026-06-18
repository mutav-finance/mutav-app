# creditAnalysis

Vendor-neutral **credit analysis** (_análise de crédito_ — tenant default-risk).
Fans out to external credit-data providers, stores immutable signals, and derives
reproducible credit-analysis assessments: a numeric score → tier. It does NOT
make decisions, and it is **not** _análise cadastral_: identity/KYB verification,
eligibility, and AML/sanctions live in `compliance/` (answering BCB 519/COAF).
The coverage decision belongs to `contracts/` underwriting, which consumes this
module's assessment.

> Renamed from `screening` (slice A1, per `docs/architecture/underwriting.md`).
> Settled on `creditAnalysis` to match Brazilian _análise de crédito_; the old
> `screening`/`creditRisk` names are retired.

## Shape

- `domain.ts` — capability/subject types + validators, the `CreditAnalysisProvider`
  port, pure derivation (`deriveCreditAnalysis`, `windowKeyForDay`).
- `providers/{vendor}.ts` — adapters. Each declares `capabilities` and catches its
  own errors (returns `status:"error"`, never throws). Vendor mechanics + the
  capability→dataset map live inside the adapter.
- `registry.ts` — resolves providers per capability. **Never** silently falls back
  to mock; an unknown configured provider throws.
- `useCases.ts` — `recordSignal` (idempotent), `recordAssessment`, `getFreshAssessment`,
  and the `findFreshAssessment(ctx, …)` helper consumers call directly.
- `actions.ts` — `runCreditAnalysis` fan-out.

## Adding a provider

Add `providers/<vendor>.ts` implementing `CreditAnalysisProvider`, register it in
`registry.ts`. No consumer changes.

## Capabilities

- `credit_score` (Phase 1) — CPF/CNPJ → numeric score → tier. Consumed by
  `contracts/` for tenant underwriting. See #184 for score→product mapping.

Identity/registration (_cadastral_) and sanctions/PEP are **not** capabilities of
this module — they are KYB/KYC verification and belong to `compliance/`.

## Reproducibility

A `creditAnalysisAssessments` row records `policyVersion` + the exact `signalIds` it
was derived from, plus the flattened `score`/`tier` of the analysis. Signals are
append-only and deduped per `(agency, subject, capability, provider, day-window)`;
assessments are append-only snapshots read via the freshest-within-TTL query
(`by_agency_subject_time`).
