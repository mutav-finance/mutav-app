# Tenant Registry — design & migration plan

**Date:** 2026-07-17 · **Status:** approved decisions, pending execution · **Story:** 1.3 (#227, schema & contract data)

## Problem

There is no tenant entity. A tenant exists only as an embedded object on each contract
(`contracts.tenant`), with a denormalized `tenantCpf` + `by_agency_tenant_cpf` index as the only
identity mechanism. Consequences:

- The same person on two contracts = two independent copies that drift.
- No cross-contract view ("all contracts for this tax ID"); no cross-agency risk signal for the
  guarantor.
- LGPD surfaces (#95 PII migration, #97 erasure) must sweep embedded copies per contract instead of
  one record per person.
- Contact updates touch every contract row.

## Decisions (2026-07-17)

| Question | Decision |
| --- | --- |
| Uniqueness | One registry row per **tax ID** (CPF for PF, CNPJ for PJ), digits-only, globally unique |
| Cross-agency visibility | **Relationship-gated**: an agency reads tenant data only when it has (or had) a contract with that tenant. No prefill and **no existence leak** for unknown-to-this-agency tax IDs. Mutav staff/risk reads globally. |
| Contract ↔ tenant | **Fully normalized**: contracts store `tenantId` only; the embedded `tenant` object and `tenantCpf` are dropped. Reads join the registry. |
| Sequencing | **Folded into the in-flight #243 restack** — the widen/narrow phases introduce the registry instead of reshaping the embedded object twice. |

### Accepted trade-off: no embedded as-signed snapshot

Full normalization loses the frozen at-signature copy. Mitigations: (a) `contractHistory` entry at
creation captures the resolved tenant fields as event payload (append-only, already exists);
(b) the tenant-signature flow (#57) will produce the true legal artifact (signed document via
e-signature provider). The registry is the *living* record; the audit trail is the historical one.

## Target schema

```ts
// convex/schema.ts
tenants: defineTable(
  v.union(
    v.object({
      entityType: v.literal("pf"),
      taxId: v.string(),            // CPF, 11 digits, checksum-validated at write
      fullName: v.string(),
      birthDate: v.string(),
      email: v.string(),
      phone: v.string(),
    }),
    v.object({
      entityType: v.literal("pj"),
      taxId: v.string(),            // CNPJ, 14 digits, checksum-validated at write
      fullName: v.string(),         // company name (app-wide field, no legalName invention)
      contactCpf: v.optional(v.string()),
      email: v.string(),
      phone: v.string(),
    }),
  ),
).index("by_taxId", ["taxId"]),
```

`contracts` delta:

- **Drop:** `tenant` (embedded object), `tenantCpf`, index `by_agency_tenant_cpf`.
- **Add:** `tenantId: v.id("tenants")`; `tenantApproval: { status: tenantApprovalStatus, termApprovedAt: string | null }`
  (per-contract relationship state — approval belongs to a contract, not to the person);
  `score: v.optional(v.number())` stays contract-level (creation-time underwriting snapshot; the
  living score is the creditAnalysis domain's, keyed by document; relates to #83 pricing snapshots).
- **Indexes:** `by_tenant: ["tenantId"]`, `by_agency_tenant: ["agencyId", "tenantId"]`.

## Domain rules (`convex/tenants/`)

- `domain.ts`: `Tenant`/`TenantId` aliases, `PfTenant`/`PjTenant` via `Extract<>`, entity-type value
  objects (move `TENANT_ENTITY_TYPE` here from contracts), server-side CPF/CNPJ **checksum
  validation** (closing the review gap — length + checksum at the write boundary, digits-only at rest).
- `useCases.ts`: `getOrCreateTenant` (internal): look up `by_taxId`; insert if absent. Check-then-insert
  is race-safe under Convex OCC serialization (same argument as the delinquency single-open guard).
  Contact-field policy on re-encounter: **last-write-wins** for email/phone (a new contract refreshes
  contact data); name/birthDate conflicts are *not* silently overwritten — recorded to the audit log
  for staff review (pilot-simple, no merge UI).
- `lookupTenantByTaxId` (agency-facing, relationship-gated): resolve `by_taxId` → check
  `by_agency_tenant` for ≥1 contract → return prefill data or `null`. Unknown and
  known-but-unrelated are indistinguishable to the caller.

## LGPD alignment (why this helps #82)

- **One DSR anchor** — #97 erasure cascades from the registry row (tombstone) instead of sweeping
  embedded copies; #98 export reads one record + its contract links.
- **One PII encryption target** — #95's `contracts.tenant` migration shrinks to a `tenants` table
  migration. The `by_taxId` index should anticipate the security.md hash-sidecar pattern
  (`by_taxIdHash` with HMAC) when #94/#95 land; plaintext-digits index is acceptable pilot-stage and
  the swap is mechanical.
- Relationship gating is the legal posture: agencies only process PII they collected; Mutav's
  cross-agency view rests on the guarantor's legitimate interest (flag for counsel review alongside
  the recharacterization item).

## Restacked delivery plan (supersedes the two-PR widen/narrow split of #243)

The stack (each step deployable, widen→migrate→narrow respected):

1. **PR A — registry (widen).** Add `tenants` table + domain + `getOrCreateTenant` +
   checksum validation. Contracts gain **optional** `tenantId` + optional `tenantApproval`.
   `create()` dual-writes: resolves the registry **and** still writes the legacy embedded
   `tenant`/`tenantCpf`. Backfill migration walks contracts → `getOrCreateTenant` from embedded data
   (dedup: first-created row wins; later conflicting name/birthDate values logged) → patch
   `tenantId`. Old index and all legacy readers untouched. Integration tests seed legacy-shaped rows.
2. **PR B — cutover (narrow) — reshapes #243.** Drop `contracts.tenant` + `tenantCpf` +
   `by_agency_tenant_cpf`; require `tenantId`; add `by_tenant`/`by_agency_tenant`.
   Readers join the registry (`shapeContract*` fetch tenant doc; tenant card, payments provider
   action read via `tenantId`). `lookupTenantByCpf` → relationship-gated `lookupTenantByTaxId`
   (fixes the PJ-contact-CPF leak found in review — gating subsumes it). Tiny migration clears
   orphaned embedded fields. Deploy gate: PR A migrated everywhere first (same discipline as #188).
3. **#244 — rebased.** `validateWizard` survives unchanged; `ValidatedWizardData.tenant` feeds
   `getOrCreateTenant` inside `create()`. `INSERT_FAILED` fix applied (post-write failures throw).
4. **#245 — rebased.** UI-only; unaffected beyond the rebase + sanctioned re-export removal.
5. **#246 — independent.** Commit 1 (single-open + cap + paid-consumes-coverage) already landed on
   its branch; commit 2 (authority split) in progress. Only contact point: delinquency summaries
   join tenant name via `contract.tenantId` after PR B.

Follow-ups (not in this stack): registry-backed cross-agency risk signal (stage-2, needs counsel),
`by_taxIdHash` swap with #94/#95, tenant portal identity, #57 signature snapshot.

## Seed & tests

`convex/seed.ts` creates registry rows and links contracts (both variants); persona flows unchanged.
Test coverage: uniqueness under concurrent `getOrCreateTenant`, checksum rejection, relationship
gating (unrelated agency gets `null`, related gets data, staff path sees all), backfill dedup +
conflict logging, join-based shapers.
