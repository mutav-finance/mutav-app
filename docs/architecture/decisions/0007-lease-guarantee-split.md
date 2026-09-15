# ADR 0007 — Lease/guarantee split: the rental relationship is not the product

**Status:** Accepted (2026-09-08), **shipped** · **Phase:** Pre-launch guarantee-lifecycle refactor · **PRs:** [#316](https://github.com/mutav-finance/mutav-app/pull/316), [#317](https://github.com/mutav-finance/mutav-app/pull/317), [#318](https://github.com/mutav-finance/mutav-app/pull/318), [#319](https://github.com/mutav-finance/mutav-app/pull/319), [#320](https://github.com/mutav-finance/mutav-app/pull/320), [#321](https://github.com/mutav-finance/mutav-app/pull/321) · **Related:** [ADR 0004](0004-pilot-cover-default-coverage-draw.md) (the `cover_default` draw this lifecycle feeds), [ADR 0006](0006-invoice-settlement-split.md) (the same rename-plus-extraction shape, one domain over), [`underwriting.md`](../underwriting.md) (the `products` catalog this adopts)

## Context

The `contracts` table was three things in one row. It held **lease attributes** (property, rent bundle, payer, renewal date), **guarantee attributes** (plan, fee, coverage ceiling, tenant score, documents), and **pricing parameters** that were not data at all — they were constants in `pricing.ts`, applied at read time. Its `status` was four Portuguese strings (`pendente` / `ativo` / `encerrado` / `cancelado`) with no guard between them, and `updateStatus`, the one mutation that could move it, had zero callers.

That shape blocked the thing Mutav actually sells. A guarantee has a life: it is drafted, it starts covering, the tenant falls behind, staff confirm the default, the fund commits cover, the tenant is evicted or cures, and eventually it ends for a reason someone will be asked about later. None of that fits four adjectives. Meanwhile the lease outlives the guarantee — an agency renews with the same tenant on the same property and wants a second guarantee, which under one row meant either mutating history or duplicating the property.

[PR #315](https://github.com/mutav-finance/mutav-app/pull/315) (the Instawards SOW audit) made it a delivery problem: Deliverable 1 is "Guarantee & Default Lifecycle Backend" and there was no guarded lifecycle to deliver.

The split ships as a **rename plus two extractions**: `contracts` becomes `guarantees` and keeps what Mutav sells; the rental relationship moves out to `leases`; the pricing parameters move out to `products` and are copied back onto each guarantee as an immutable `terms` snapshot.

## Decisions

### 1. The `contracts` row **is** the guarantee — rename, no compatibility shim

`contracts` → `guarantees`, table and domain folder. The old name survives in exactly two places, both deliberate (decision 8).

- **Why not keep `contracts` and add a `guarantees` table beside it:** the row already _was_ the guarantee — same publicId, same agency scope, same lifecycle. A second table would have meant a 1:1 join maintained forever to avoid one rename.
- **Consequence:** "contract" is no longer a domain word in this repo. `AGENTS.md` § Terminology says so; on `mutav-stellar` it still means a Soroban contract and always did.
- A thin `api.contracts.useCases.*` facade existed for exactly two PRs (#317 → #319) so the agency app kept compiling mid-refactor. It never reached `main` and is deleted.

### 2. The lease is its own row; **1 lease → n guarantees over time, at most one open**

`leases` holds property, `rent{rentCents, condoCents, otherFeesCents, totalRentCents}`, `payer`, `tenantId` and `openGuaranteeId`. `guarantees.leaseId` points back. Not n:n.

- **Why not n:n:** the join table buys the ability to cover two leases with one guarantee, which no product does, and it costs the single-pointer invariant below — the one rule that makes "is this lease covered right now?" a field read instead of a query.
- **The one-open-guarantee rule is enforced at the mutation, not in the schema.** `guarantees.create` reads the lease, refuses when `openGuaranteeId` is non-null (`assertLeaseAcceptsGuarantee`), inserts, and patches the pointer — all in one transaction. Convex's OCC on the lease row is what serializes two racing creates; the second one retries, re-reads a non-null pointer, and is refused.
- Closing a guarantee nulls the pointer inside `applyGuaranteeTransition`, so the lease can take a new one immediately.

### 3. `guarantees.status` stays **authoritative**, not derived — and every move goes through the machine

The seven states (`drafted · active · in_arrears · default_verified · cover_committed · in_eviction · closed`) are a stored column on the guarantee, patched only by `applyGuaranteeTransition`, which calls `assertTransition` **before** the patch. It is _not_ computed on read from notices, invoices, or capacity.

- **Why:** a derived state makes every list query fan out to the notice table and makes the guarantee's own history unreadable — the same argument ADR 0006 made for `invoice.state`. It also makes the state untestable in isolation, and the machine is the deliverable.
- **`in_arrears` is a real stored state, not a computed "has an open notice" flag.** The dashboard counts it, the aggregate keys on it, and the transparency default rate divides by it.
- **`closed` carries a from-state-gated reason.** `assertClose` rejects `canceled_pre_activation` from anything but `drafted`, `eviction` from anything but `in_eviction`, and `dispute_reversal` from anything but `default_verified` / `cover_committed`. A close reason that could be written from any state would be a free-text field with extra steps.
- **Consequence:** `applyGuaranteeTransition` is the single writer of `status`. It is the place to look when a guarantee's state is wrong, and the only place a new transition may be added.

### 4. Pricing is a `products` row; each guarantee stores an **immutable `terms` snapshot**

A `products` row carries the parameters (`tierRate{bom,regular,ruim}`, `coverageCeilingMultiplier`, `exitCostMultiplier`, `activationFeeCents`, `commissionRate`, `prestamistaPremiumCents`, `prestamistaCommissionRate`) plus an `eligibility` bundle and an effective window. `priceGuarantee` copies the resolved figures into `guarantees.terms` at pricing time. **A sold guarantee never reads the live product row again.**

- **`terms` snapshots the commission rates too.** This is the part the plan did not anticipate: `splitCommission(terms)` reads only the snapshot, because commission on a sold guarantee is owed at the rate it was sold under. Without the two rate fields in `terms`, editing a product's `commissionRate` would silently restate every past broker payout. `DEFAULT_PRICING_TABLE` is no longer a runtime default anywhere — it is the seed constant for the one default product and nothing else.
- **`setupInstallments` was dropped** from `terms`, from `products.terms`, from `DEFAULT_PRICING_TABLE` and from the privacy registry. Billing never honored it — `generateMonthlyInvoices` writes one `activation` line in the activation month regardless — and it appeared in neither today's pricing constants nor [`underwriting.md`](../underwriting.md). Re-add it only together with installment billing, not before.
- **Why snapshot rather than version the product:** a version pointer makes the read a join and makes "what did this guarantee actually cost?" a question about two rows. The snapshot answers it from the row in hand. This is what [#83](https://github.com/mutav-finance/mutav-app/issues/83) (versioned rate cards) asked for.
- One product is seeded (`mutav-fianca`) with today's constants, so no number moved in this refactor. Changing the numbers is [#300](https://github.com/mutav-finance/mutav-app/issues/300) — a formula edit in `pricing.ts` plus a parameter edit on the default product, deliberately kept separate so the rename could not be blamed for a pricing change.

### 5. Notices drive guarantee transitions **in the same transaction**, never through the scheduler

`guaranteeDelinquencyNotices` stays the per-event record and gains a `verified` status. Each notice mutation composes its own `assertTransition` with the guarantee's, in one transaction, via `convex/guarantees/transitions.ts`. `delinquencies/` imports `guarantees/`; `guarantees/` never imports `delinquencies/`.

- **Why not `ctx.scheduler`:** the atomicity of the two machine guards _is_ the feature. A scheduled follow-up can fail after the notice is already verified, leaving a confirmed default with a guarantee still reading `active` — and the reconciliation for that is a second machine nobody wants to own.
- The compositions that shipped: `openNotice` takes `active → in_arrears`; `markResolved(tenant_cured)` returns `→ active` **only when no other open or verified notice remains** on the guarantee; `staffVerifyDefault` takes `in_arrears → default_verified`; `staffMarkResolvedByCover` reserves capacity and takes `→ cover_committed`.
- **Authority is narrower than the machine.** The machine would accept `default_verified → active`, but an agency disposition may only return from `in_arrears` — walking back a staff-confirmed default is a compliance judgement, not a data-entry correction. A staff dismissal may also return from `default_verified`, because it is the same office undoing its own verification. Neither may return from `cover_committed`: cover has moved cents.

### 6. Coverage capacity is **policy C, reserve side only** — clamp, store the applied figure, reverse exactly

`guarantees.capacity` is `{ceilingCents, availableCents, reservedCents}` with the invariant `available + reserved = ceiling`. Committing cover moves cents from `available` to `reserved` on the guarantee's own ceiling.

- **The draw is clamped, and the applied figure is stored on the notice, not the face amount.** A notice worth more than the remaining coverage reserves the remainder and no more; `resolution.appliedCoverCents` records what was actually taken. This is the decision that makes a reversal exact — releasing the notice's face amount would invent coverage that was never reserved. `releaseCoverCapacity` refuses to release more than is currently reserved rather than flooring at zero, because the excess would have to come from somewhere and there is nowhere honest for it to come from.
- **A drifted capacity is refused, not repaired.** `isValidCapacity` runs on the row before any capacity write and on any capacity a caller supplies; a row where `available + reserved ≠ ceiling` returns `CAPACITY_INVARIANT_BROKEN` and the transaction does not start. Repairing it silently would either invent or destroy coverage, and both are worse than a loud refusal on a row that should not exist.
- **Release/burn is written but not wired.** `releaseCoverCapacity` exists and is tested; nothing calls it. Today a `close(dispute_reversal)` from `cover_committed` leaves the reserved cents held. The release half lands with the receivable ledger (below), and the function is written now so the two stay symmetric rather than being reconstructed later from memory.

### 7. Idempotency: the **notice** is the unit; a guarantee transition has no dedupe key

There is deliberately no idempotency key on a guarantee transition. Replay protection is structural: `assertTransition` refuses a self-transition outright, so re-applying `active → in_arrears` on a row already in `in_arrears` fails as `SELF_TRANSITION` rather than double-counting. The cover draw dedupes one level up — the notice's own machine makes `resolved` and `canceled` terminal, so a second `staffMarkResolvedByCover` on the same notice is refused before it can reserve capacity twice.

- **Why not a `(guaranteeId, period)` key on the transition:** the states are not periodic. ADR 0004's `(guaranteeId, coveragePeriod)` key is the right shape for the on-chain **draw**, which is periodic and external; the off-chain state move is a single guarded edge and a key would only restate what the machine already refuses.
- **Consequence:** any future path that moves a guarantee without going through `applyGuaranteeTransition` loses this property. There is no second line of defence.

### 8. `contractApplications` keeps its name; so do the `contract.*` audit wire values and the aggregate components

Three things that look like leftovers and are not:

- **`contractApplications`** is the Lei 12.414 bureau-consult relationship record. `creditAnalysisSignals.applicationId` FK-references it, and **neither table is in `DEMO_TABLES`** — both hold retained, real data. A Convex rename is a new table plus a copy; it would orphan every retained signal for a cosmetic gain.
- **`contract.created` / `contract.canceled` / `contract.status_updated`** are frozen wire values in the hash-chained audit log. Renaming a wire value breaks the chain. `guarantee.*` and `lease.*` keys were added beside them, the old ones frozen under the existing pattern.
- **Aggregate component names** (`contractsByStatus`, `contractsByStatusPlatform`, `ativoInsuredCentsPlatform`) are re-bound to `guarantees` / `GuaranteeState` but keep their names — a component rename is a data migration in the component's own tables, and it buys nothing this refactor needs. Tracked as a follow-up.
- **Insured exposure is summed by iterating `INSURED_STATES`, never by a single `bounds`.** The aggregate sorts on the status string, and the five in-force states are not lexically contiguous (`active < closed < cover_committed < default_verified < drafted < in_arrears < in_eviction`) — a range sum would silently include `closed` and `drafted`.

### 9. The receivable ledger and carência are **out of scope for v1**

There is no receivable machine (spec § 9h), no carência window (§ 10k), and no capacity burn. This is a deliberate scope cut: cover is reserved against the guarantee's ceiling and stops there. Modelling the money that comes _back_ before there is a settled model of the money going _out_ is speculative.

- **Consequence:** `capacity` has no `consumed` leg today, and `reserved` is a high-water mark rather than a running balance. A guarantee whose dispute is reversed keeps the reservation until the ledger lands.
- **Revisit if:** the pilot takes a real default through to recovery, or the SOW's transparency figures need "how much did we get back". Both make the ledger load-bearing rather than nice to have.

## Table shapes

```
leases: { agencyId, publicId, tenantId, propertyKind, property{cep,streetAndNumber,neighborhood,cityUF,complement},
          tag, description, rent{rentCents,condoCents,otherFeesCents,totalRentCents}, payer, openGuaranteeId }
  indexes: by_publicId, by_agency, by_tenant, by_agency_tenant

guarantees: { agencyId, leaseId, publicId, productId, status, closure?{reason,closedAt,note?}, activatedAt,
              nextRenewalDate, underwriting{score,tier,assessmentId?}, tenantApproval{status,termApprovedAt},
              terms{productSlug,plan,rentCents,feeCents,taxaFeeCents,prestamistaFeeCents,
                    oneTimeActivationFeeCents,commissionRate,prestamistaCommissionRate,
                    coverageCeilingMultiplier,exitCostMultiplier,coverageCeilingCents,exitCostCapCents,appliedAt},
              capacity{ceilingCents,availableCents,reservedCents}, documents[] }
  status: drafted | active | in_arrears | default_verified | cover_committed | in_eviction | closed
  indexes: by_publicId, by_status, by_agency_status, by_agency_status_nextRenewalDate, by_lease, by_product

products: { slug, name, enabled, isDefault, effectiveFrom, effectiveTo?,
            terms{tierRate{bom,regular,ruim},coverageCeilingMultiplier,exitCostMultiplier,activationFeeCents,
                  commissionRate,prestamistaPremiumCents,prestamistaCommissionRate},
            eligibility{agencyIds,regionUFs,minTier,propertyKinds} }
  indexes: by_slug, by_enabled_isDefault
```

Renamed alongside: `contractHistory → guaranteeHistory` (gains a structured `transition{from,to,closeReason?}` twin beside the human `message`), `contractDelinquencyNotices → guaranteeDelinquencyNotices` (gains `verified`, `verification?`, `resolution.appliedCoverCents?`), `invoices.lineItems[].{guaranteeId, guaranteePublicId}`.

## Migration approach — wipe + reseed, not migrate-in-place

Four schema-shape changes (rename, lease split, status enum, products) shipped as **one** hard reseed in [#317](https://github.com/mutav-finance/mutav-app/pull/317) rather than four sequential ones. Sequential would have meant four reseeds and four rewrites of the same sixty-odd seed literals.

This follows the standing pre-production rule — CLAUDE.md § "Schema changes & migrations — reseed-first" and ADR 0006 § Migration approach. `schemaValidation: false` stays for the window; `convex/migrations.ts` stays a no-op runner.

The seed reshape is the substantive half: `SeedContractSpec` became `SeedLeaseSpec`, and one `insertSeedLeaseAndGuarantee` inserts the lease, resolves the seeded default product, and prices through `priceGuarantee` — so the seeded figures reconcile with the pricing code instead of being independently hardcoded (the old seed used 40× / R$200 against a table that said 30× / R$150). `DEMO_TABLES` gained `leases`, `guarantees`, `guaranteeHistory`, `guaranteeDelinquencyNotices` and `products`, wiped in FK-safe order. It did **not** gain `contractApplications`, `waitlist`, `mutavAuditLog*`, `mutavStaff`, `reserveSnapshots` or `creditAnalysis*` — `convex/seed.test.ts` is the regression guard.

Orphaned `contracts` / `contractHistory` / `contractDelinquencyNotices` / `delinquencies` tables survive on already-deployed environments with stale rows. They are invisible to code (`schemaValidation: false` tolerates them) and are cleared from the Convex dashboard, not by a migration.

## Consequences

- **The guarantee domain owns the product, not the property.** Anything about where the tenant lives or what they pay the landlord belongs on `leases` — reviewers should push back on new lease-shaped columns creeping onto `guarantees`. The one deliberate duplication is `terms.rentCents`, which is rent _at pricing time_ and must not track `leases.rent`.
- **`applyGuaranteeTransition` is a chokepoint by design.** It patches, rewrites the aggregate, writes history, appends the audit entry and maintains the lease pointer, in that fixed order. A caller that patches `status` directly skips all five.
- **A capacity write is an aggregate write.** `ativoInsuredCentsPlatform` sums `capacity.availableCents`, so the two are not separable — `writeCapacity` does both or neither.
- **Reversal-shaped bug reports are a known gap**, not a defect, until the revisit trigger in decision 9 fires.
- **Admin product CRUD does not exist.** The catalog is seeded; `isValidProductTerms` is written and unused, waiting for the write path. Until it lands, changing a price means a code change.
