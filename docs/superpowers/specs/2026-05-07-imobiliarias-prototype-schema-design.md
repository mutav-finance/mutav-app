---
milestone: Imobiliárias prototype — contract management + monthly billing
date: 2026-05-07
status: draft
scope: schema only
---

# Schema design — Imobiliárias prototype

## Context

The first SGR milestone is a prototype for real estate agencies (imobiliárias) to manage rental contracts and pay SGR a monthly fee per active contract via boleto. The contract details page already exists; this milestone extends the data model to support multi-tenancy and recurring B2B billing.

This spec covers **only the schema**. The follow-up specs are:

- Contract list view
- Contract creation flow
- Payment generation flow
- Boleto / PSP integration (separate concern from generation logic)
- Auth (replaces issue #1's Privy framing — this project uses simpler auth since there are no per-tenant wallets or per-user payments)

## Decisions

### Multi-tenancy

The schema models multiple agencies from day one. Every `contract`, `contractHistory` row, and `payment` carries an `agencyId`. A `users` table is deferred to the auth spec.

Rationale: adding `agencyId` to a populated `contracts` table later is a painful migration touching every record; one extra column now is cheap. The schema *shape* is hard to retrofit; user identities are not.

### Naming

The entity is `agencies` / `Agency` / `AgencyId` — English, domain-precise. (Imobiliária = agência imobiliária; "agency" carries the legal-agency meaning that fits.) The codebase keeps Portuguese for *values* (statuses, property kinds) but English for table and type names.

### Billing aggregation

Per-agency monthly aggregation: one `payment` record per agency per month, listing all that month's contract-related charges as `lineItems`. Both recurring fees and one-time activation fees fold into the same monthly payment when their billing event lands in that month.

Rationale: agencies managing 20+ contracts hate getting 20 boletos a month. Aggregation matches the realistic operational pattern. Two-fee-types-as-line-items keeps the recurring-billing job simple — one job, one record per agency per month.

### Money representation

All monetary values are integer cents (`*Cents: v.number()`), per CLAUDE.md → Domain conventions (Brazil) → Money. Existing `*BRL: v.number()` fields in `contracts` migrate to `*Cents` in the same change as the `agencyId` addition — one schema migration is cheaper than two.

### Boleto / PSP integration

Out of scope for this milestone. The `payments` table has nullable `barcode` and `paidAt` fields ready to be filled when PSP integration lands as its own follow-up spec (decisions on Asaas vs Iugu vs Banco do Brasil API happen there).

For the prototype, payments are tracked logically — `pending → paid → overdue → canceled` status transitions happen via internal mutations or seed data, not real PSP webhooks.

### Other

- **Product types** ("Flex"): stays implicit. Multipliers (`exitCostMultiplier`, `rentMultiplier`) remain as per-contract fields. No `products` table until a second product type is real.
- **Line items**: embedded array on the `payments` document, not a separate table. Fits Convex's 1MB document limit at expected scale (≤ 100 active contracts per agency in prototype). Simpler reads.
- **Discriminated unions**: applied where statuses gain status-specific data (per the `convex-document-types` skill). For now, `payments.status` is flat — promote to a metadata bag pattern when status-variant fields appear (e.g. `failureReason` on a `failed` status).

## Tables

### `agencies` (new)

```ts
defineTable({
  name: v.string(),
  cnpj: v.string(),               // 14 digits, no formatting
  createdAt: v.string(),          // ISO date
}).index("by_cnpj", ["cnpj"]);
```

Minimum needed for the prototype. Per-agency negotiated commission rates would warrant additional fields or a dedicated table — out of scope here.

### `contracts` (modified)

Top-level changes:

- Add `agencyId: v.id("agencies")` (top-level field)
- Migrate money fields → cents:
  - `availableGuaranteeBRL` → `availableGuaranteeCents`
  - `rental.rentBRL` → `rental.rentCents`
  - `rental.condoBRL` → `rental.condoCents`
  - `rental.otherFeesBRL` → `rental.otherFeesCents`
  - `rental.totalRentBRL` → `rental.totalRentCents`
  - `rental.feeBRL` → `rental.feeCents`
  - `rental.oneTimeActivationFeeBRL` → `rental.oneTimeActivationFeeCents`
- Indexes:
  - Keep: `by_publicId`, `by_status`
  - Add: `by_agency_status` (composite, `["agencyId", "status"]`) for the list view filtering by agency + status

The rich nested shape (`rental` / `property` / `optional` / `documents` / `tenant`) stays. Tenant data remains as fields on the contract — never users.

### `contractHistory` (modified)

- Add `agencyId: v.id("agencies")` for RLS scoping when auth lands
- Index unchanged for now: `by_contract` (`["contractPublicId", "at"]`). Add a composite (`["agencyId", "contractPublicId", "at"]`) when query patterns demand cross-agency filtering.

### `payments` (new)

```ts
defineTable({
  agencyId: v.id("agencies"),
  publicId: v.string(),                       // e.g. "PAY-2026-05-AGY1"
  periodMonth: v.string(),                    // "2026-05"
  issuedAt: v.string(),                       // ISO date
  dueDate: v.string(),                        // ISO date
  totalCents: v.number(),                     // sum of lineItems.amountCents
  status: v.union(
    v.literal("pending"),
    v.literal("paid"),
    v.literal("overdue"),
    v.literal("canceled"),
  ),
  lineItems: v.array(
    v.object({
      contractId: v.id("contracts"),
      contractPublicId: v.string(),           // denormalized for display on the boleto
      kind: v.union(
        v.literal("recurring"),               // monthly fee
        v.literal("activation"),              // one-time setup, folded into the same payment
      ),
      amountCents: v.number(),
      description: v.string(),                // human-readable, displayed on the boleto
    }),
  ),
  // PSP fields — null until PSP integration lands; see future spec
  barcode: v.union(v.string(), v.null()),
  paidAt: v.union(v.string(), v.null()),
})
  .index("by_agency_period", ["agencyId", "periodMonth"])
  .index("by_status", ["status"])
  .index("by_publicId", ["publicId"]);
```

## File organization

Per the migration trigger in CLAUDE.md (a flat file gaining a second function gets promoted), this change moves `convex/contracts.ts` and `convex/seed.ts` into the domain-folder layout.

```
convex/
├── _generated/
├── schema.ts                       # all tables; validators local
├── seed.ts                         # rewritten for the new schema
├── agencies/
│   ├── domain.ts                   # Agency, AgencyId, validators
│   └── useCases.ts                 # listAgencies, getAgency
├── contracts/
│   ├── domain.ts                   # Contract types + value objects + validators
│   └── useCases.ts                 # existing queries + listByAgency (new)
├── payments/
│   ├── domain.ts                   # Payment, PaymentId, line item types + validators
│   └── useCases.ts                 # listByAgency, getById
└── lib/                            # cross-domain (no entries yet)
```

The existing `convex/contracts.ts` queries move into `contracts/useCases.ts` unchanged in behavior. Money field references update to the new `*Cents` names.

Type aliases exported from each domain file (per the `convex-document-types` skill rule):

- `Agency`, `AgencyId` from `agencies/domain.ts`
- `Contract`, `ContractId`, `ContractStatus`, `PropertyKind`, `DocumentKey`, `DocumentStatus`, `TenantApprovalStatus` from `contracts/domain.ts`
- `Payment`, `PaymentId`, `PaymentStatus`, `PaymentLineItem`, `PaymentLineItemKind` from `payments/domain.ts`

Validators co-located with their value objects in the same files (no `validators.ts`).

## Seed data updates

`convex/seed.ts` rewrites to match the new schema:

- Insert two agencies: e.g. "Imobiliária Paulista" (`agencies` row) and "Imobiliária Atlântica". Multi-tenancy is visible from a fresh seed.
- The existing fictional contract `1000001` gets `agencyId` pointing to one agency.
- Add a second fictional contract under the other agency for list-view diversity.
- Money values divide by 100 from the existing seed values (e.g. `rentBRL: 3_200` → `rentCents: 320_000`).
- Insert one `payments` record per agency for the most recent closed month, demonstrating both `recurring` and `activation` line item kinds where applicable.

## Migration strategy

This is one schema change, not a multi-step widen-migrate-narrow.

- No production records yet (prototype-stage).
- All current data comes from the deterministic `seed.ts`, which is rewritten in the same change.

If production records appear before this lands, the strategy in `.claude/notes/deferred-conventions.md` (BRL→cents migration: widen, backfill, narrow with `@convex-dev/migrations`) escalates and applies.

## Out of scope

- Users / auth — its own spec; replaces issue #1's Privy framing
- Real boleto / PSP integration — its own spec; affects only `payments.barcode` / `paidAt` lifecycle, not schema shape
- Per-agency negotiated commission rates — would warrant a `products` or `agencyPricing` table
- Refunds, partial payments, credit notes — not in B2B monthly billing v1
- Reports / dashboards beyond list views

## Open questions for follow-up specs

These don't block the schema but need answers before the related sub-projects ship:

1. **`feeCents` semantics** — is it a monthly recurring amount, annual, or lifetime? The current seed value `5_120` paired with rent `3_200` is ambiguous (1.6× rent, or `5120/12 ≈ 427` if monthly-of-annual). Resolved when we design the payment generation flow.
2. **Activation fee billing trigger** — does it fold into the same monthly payment as the contract's activation date, or always the next month's? Resolved in the payment generation spec.
3. **Period overlap on contract status changes** — if a contract terminates mid-month, does that month's payment include it pro-rated, fully, or not at all? Resolved in the payment generation spec.

## Acceptance criteria (schema only)

- `convex/schema.ts` declares all four tables with the shapes above.
- `bunx convex dev` runs without errors.
- `convex/seed.ts` populates two agencies, ≥ 2 contracts, and ≥ 2 payments without errors when run via `bunx convex run seed:fictionalContract` (or whatever the entry point becomes).
- TypeScript types are derivable: `Agency`, `AgencyId`, `Contract`, `ContractId`, `Payment`, `PaymentId`, `PaymentLineItem`.
- Existing contract details page renders the seeded contract with the new schema (after `*Cents` field renames + `agencyId` addition).
- `bun run typecheck` passes.

## References

- CLAUDE.md → Architecture → Convex backend organization
- CLAUDE.md → Domain conventions (Brazil) → Money
- `.claude/skills/convex-document-types/SKILL.md` — schema discriminated union patterns, value objects, index-vs-filter
- `.claude/skills/convex-functional-programming/SKILL.md` — Result pattern for use cases
- `.claude/notes/deferred-conventions.md` — pending BRL→cents migration (this spec executes it for `contracts`)
