# creditRisk

Vendor-neutral **credit-analysis** (default-risk) module. Fans out to external
credit-data providers, stores immutable signals, and derives reproducible
credit-risk assessments — the "credit analysis": a numeric score → tier. It does
NOT make decisions: it is NOT identity/KYB **verification** (that's
`compliance/providers`) and NOT the coverage decision (that's `contracts/`
underwriting, which consumes this module's assessment).

> Renamed from `screening` (slice A1, per
> `docs/architecture/underwriting.md`). The old name is retired.

## Shape

- `domain.ts` — capability/subject types + validators, the `CreditRiskProvider`
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

Add `providers/<vendor>.ts` implementing `CreditRiskProvider`, register it in
`registry.ts`. No consumer changes.

## Capabilities

- `credit_score` (Phase 1) — CPF/CNPJ → numeric score → tier. Consumed by
  `contracts/` for tenant underwriting.
- `registration`, `sanctions_pep` — Phase 2 (agency KYB; see #184 for score→product).

## Reproducibility

A `creditRiskAssessments` row records `policyVersion` + the exact `signalIds` it was
derived from, plus the flattened `score`/`tier` of the analysis. Signals are
append-only and deduped per `(agency, subject, capability, provider, day-window)`;
assessments are append-only snapshots read via the freshest-within-TTL query
(`by_agency_subject_time`).
