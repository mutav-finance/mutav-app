# ADR 0008 — Tenant registry: one row per tax ID, no embedded as-signed copy

**Status:** Accepted (2026-07-17; delivery plan restacked 2026-07-20), **shipped** · **Phase:** Pre-launch schema & contract data (Story 1.3) · **Issues/PRs:** [#227](https://github.com/mutav-finance/mutav-app/issues/227) (story), [#243](https://github.com/mutav-finance/mutav-app/pull/243) (registry cutover), [#60](https://github.com/mutav-finance/mutav-app/issues/60) (tenant as a discriminated union, `tenantCpf` dropped) · **Related:** [ADR 0001](0001-pii-crypto-pattern.md) (hash-sidecar pattern the `by_taxId` index converges on), [ADR 0002](0002-b2b2c-tenant-credit-data-governance.md) (B2B2C controller model this gating implements), [ADR 0007](0007-lease-guarantee-split.md) (`contracts` → `guarantees`; the history table named below was `contractHistory` when this was decided)

## Context

There was no tenant entity. A tenant existed only as an embedded object on each contract (`contracts.tenant`), with a denormalized `tenantCpf` and a `by_agency_tenant_cpf` index as the only identity mechanism. The same person on two contracts was two independent copies that drifted; there was no cross-contract view for one tax ID; contact updates touched every row; and every LGPD surface — PII encryption, erasure, export — had to sweep embedded copies per contract instead of one record per person.

## Decisions

### 1. One registry row per **tax ID**, globally unique

`tenants` holds one row per CPF (PF) or CNPJ (PJ), digits-only at rest, checksum-validated at the write boundary. `getOrCreateTenant` looks up `by_taxId` and inserts if absent; check-then-insert is race-safe under Convex OCC serialization. On re-encounter, email/phone are **last-write-wins** (a new contract refreshes contact data); name/birth-date conflicts are **not** silently overwritten — they are recorded to the audit log for staff review.

### 2. Cross-agency visibility is **relationship-gated**

An agency reads a tenant only when it has (or had) a contract with that tenant. The agency-facing lookup returns prefill data or `null`, and "unknown" is indistinguishable from "known but unrelated" — **no existence leak**. Mutav staff/risk read globally.

### 3. Fully normalized link — the product row stores `tenantId` only

The embedded `tenant` object and `tenantCpf` were dropped; reads join the registry. Approval state (`tenantApproval`) and the creation-time `score` stay on the product row, because approval belongs to a contract, not to a person.

### 4. Delivered inside the #243 restack, widen → migrate → narrow

The registry was folded into the in-flight #243 widen/narrow stack rather than reshaping the embedded object twice: PR A added the table with dual-write and a backfill (first-created row wins; conflicting values logged), PR B cut over and dropped the legacy fields, with the same deploy-gate discipline as other two-phase migrations.

## Accepted trade-off: no embedded as-signed snapshot

Full normalization gives up the frozen at-signature copy of the tenant's data on the contract row. The living `tenants` row can change after signature; the product row no longer remembers what it said at the time. This was accepted deliberately, with two mitigations:

- **Audit-trail capture.** The creation event in the append-only history table (`contractHistory`, now `guaranteeHistory`) carries the resolved registry fields as a `tenantSnapshot` payload. The registry is the _living_ record; the history is the _historical_ one.
- **Legal artifact from signing.** The true as-signed record is the signed document produced by the tenant-signature flow ([#57](https://github.com/mutav-finance/mutav-app/issues/57)), not a database column.

Reintroducing an embedded tenant copy on the product row reopens this decision — do not do it as a convenience.

## LGPD rationale

- **One DSR anchor.** Erasure cascades from one registry row (tombstone) instead of sweeping embedded copies; a subject-access export reads one record plus its contract links.
- **One PII encryption target.** The PII-at-rest migration shrinks to a single `tenants` table. The plaintext `by_taxId` index is acceptable pilot-stage; the swap to an HMAC `by_taxIdHash` per [ADR 0001](0001-pii-crypto-pattern.md) / [`security.md`](../security.md) is mechanical.
- **Relationship gating is the legal posture.** Agencies only process the PII they collected (they are the controller for their own tenants, per [ADR 0002](0002-b2b2c-tenant-credit-data-governance.md)); Mutav's cross-agency view rests on the guarantor's legitimate interest — flagged for counsel review.

## Consequences

- The tenant card, payments provider action, and every shaper read tenant data through `tenantId`; there is no second source to keep in sync.
- The agency lookup cannot be used to probe whether a tax ID is known to Mutav — this also closed the PJ-contact-CPF leak found in review.
- A registry-backed cross-agency risk signal is possible but deferred (stage 2, needs counsel). So are the `by_taxIdHash` swap and a tenant-portal identity.
