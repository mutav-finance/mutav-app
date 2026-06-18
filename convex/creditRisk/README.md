# screening

Vendor-neutral risk/verification **signal** layer — compliance.md's "Inputs to risk".
Fans out to external data providers, stores immutable signals, and derives
reproducible assessment snapshots. It does NOT make decisions and is NOT the KYC
verification workflow (that's `compliance/providers`) or the risk-classification
state machine (compliance's).

## Shape

- `domain.ts` — capability/subject/purpose types + validators, the `ScreeningProvider`
  port, pure aggregation policies (`deriveTenantUnderwriting`, `windowKeyForDay`).
- `providers/{vendor}.ts` — adapters. Each declares `capabilities` and catches its
  own errors (returns `status:"error"`, never throws). Vendor mechanics + the
  capability→dataset map live inside the adapter.
- `registry.ts` — resolves providers per capability. **Never** silently falls back
  to mock; an unknown configured provider throws.
- `useCases.ts` — `recordSignal` (idempotent), `recordAssessment`, `getFreshAssessment`,
  and the `findFreshAssessment(ctx, …)` helper consumers call directly.
- `actions.ts` — `runScreening` fan-out.

## Adding a provider

Add `providers/<vendor>.ts` implementing `ScreeningProvider`, register it in
`registry.ts`. No consumer changes.

## Capabilities

- `credit_score` (Phase 1) — CPF/CNPJ → numeric score. Consumed by `contracts/`
  for tenant underwriting (the `tenant_underwriting` assessment).
- `registration`, `sanctions_pep` — Phase 2 (agency KYB; see #184 for score→product).

## Reproducibility

A `screeningAssessments` row records `policyVersion` + the exact `signalIds` it was
derived from. Signals are append-only and deduped per `(agency, subject, capability,
provider, day-window)`; assessments are append-only snapshots read via the freshest-
within-TTL query.
