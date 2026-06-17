# Invoice + Settlement refactor — session handoff (2026-06-16)

State capture for a fresh session to continue the `payments`→`invoices` + settlement-split refactor.

## TL;DR — where to start

**The refactor is COMPLETE** as of PR 4 (this) — `invoice.method` is dropped; method derives from the succeeded settlement row. The bill (`invoices`) and settlement (`payments`) are fully split. Historical reference, in order:
1. **Plan (PR sequence + decisions):** `~/.claude/plans/swift-inventing-tide.md`
2. **Design spec (rationale, benchmarks, vocabulary map):** `docs/superpowers/specs/2026-06-16-invoice-settlement-vocabulary.md`
3. This file (status + gotchas).

## Status

| PR | What | State |
|----|------|-------|
| #185 | Phase 0 — lexicon ("Link de pagamento") | ✅ merged |
| #186 | Phase 1 — functional `payments`→`invoices` rename, Stripe statuses (`open`/`paid`/`void`, `overdue` derived), additive audit | ✅ merged |
| #187 | `@convex-dev/migrations` tooling + run-on-deploy | ✅ merged |
| #189 | PR 1 — agency UI cosmetic (route `/invoices`, `invoice-*` components, `invoiceList`/`invoiceDetails` i18n) | ✅ merged |
| #191 | PR 2 — `anchors/` → `payments/providers/` domain move + bearer-gated `listBanksForInvoice` (closed the `listByAgency` boundary) | ✅ merged |
| #192 | Make `regression-greps` checks 2–5 actually gate (subshell exit-code bug) | ✅ merged |
| #193 | PR 3a — `anchorOrders`→`providerOrders` table + symbol rename (pre-launch hard rename) | ✅ merged |
| #194 | PR 3b — settlement `payments` table + dual-write + seed + `invoice-method-card` read + PAYMENT_STATUS i18n | ✅ merged |
| #195 | Fix latent `run-migrations` prod deploy-key auth (`--prod`) — unblocked prod deploys | ✅ merged |
| **PR 4** | Drop `invoice.method` (NARROW) — method derives from the succeeded settlement row (`resolveInvoiceMethod`); 3 dual-writers' already-paid idempotency now dedupes on settlement `by_externalRef`; dead `setPaymentMethod` removed | 🔵 **this PR (final)** |

### Migration approach changed to wipe+reseed (2026-06-17)
Pre-launch, so PR 3a/3b use **wipe+reseed** rather than in-place data migrations (user's call): schema changes directly, no `runAll` backfills. Prod (`fastidious-swordfish-9`) + CI preview deployments are empty so the new schema applies cleanly; `_generated` table types auto-derive from `typeof schema` (no codegen). A context-specific override of the documented 2-PR migrate-in-place convention, not a general reversal.

> **⚠️ PENDING OPERATIONAL STEP (after PR 3b merges):** the persistent **dev deployment** (+ Draau's local) still run the pre-rename schema. Run a wipe+reseed (`clearAll`→`seedPreview`, or `convex dev` reseed) **from the main checkout** (never a worktree — that pushes to shared dev) to pick up `providerOrders` + the seeded `payments` settlement rows.

`feat/bigdatacorp-integration` + `feat/screening-phase-1` are unrelated worktrees.

## Phase-2 decisions (locked — see plan for detail)
- Invoice → `paid` on **first `succeeded` settlement** (no partial payments).
- `invoice.state` stays **authoritative** (patched by the settlement mutation), not derived.
- `method` + tx fields move to the settlement `payments` row; **`muxedId` stays on the invoice** (receiving address).
- `anchorOrders`→`providerOrders` (attempt/intent); a completed order **produces** a settlement row; `payments.providerOrderId?` optional.
- Refunds/void-with-settlement: **out of scope v1**.
- Idempotency: settlement insert dedupes on **`externalRef`** (txHash/anchorTxId/pix txId) via `by_externalRef`.

## Settlement `payments` table (target — PR 3)
```
payments: { agencyId, invoiceId, status, amountCents, paidAt?, externalRef?, providerOrderId?, method }
  status: pending|processing|succeeded|failed|canceled
  method: boleto{barcode} | pix{pixKey,txId} | stellar{destinationAddress,txHash}
  indexes: by_invoice, by_agency, by_externalRef
```
`src/lib/anchors/` (SEP protocol library) is **unchanged** — "anchor" is correct there.

## Deployment state
- **Dev** (`veracious-poodle-858`, jubs): on the `invoices` schema, **36 `INV-` invoices seeded**, migrations component installed.
- **Prod** (`fastidious-swordfish-9`): **empty / pre-launch** — narrowed schema deploys clean; no Phase-1 data migration needed.
- Migrations run on **every deploy** via `scripts/run-migrations.sh` (`migrations:runAll`, anchored by a `noop` sentinel) chained in `scripts/vercel-build-agency.sh`. Verified on a live preview deploy.

## Gotchas (cost time this session — don't repeat)
- **Run tests via `bunx turbo run test`**, NOT bare `vitest` — convex-test needs the apps' edge-runtime/glob config; bare vitest fails with `import.meta.glob is not a function`.
- **Vercel `buildCommand` ≤ 256 chars** — over-limit fails at config validation (`Builds . [0ms]`, no logs, all local checks pass). Delegate to a script (`scripts/vercel-build-agency.sh`).
- **Never run `convex codegen`/`convex dev` from a worktree** — it pushes to the shared dev deployment and breaks `main`'s checkout. The committed `_generated` is already correct after a rename.
- **Schema migrations: widen → migrate → narrow across two PRs** with `schemaValidation:false`, NOT wipe+reseed (preserves data; each dev's deployment self-heals on `convex dev`). See `.claude/notes/deferred-conventions.md` → "Convex data migrations".
- **Worktrees** under `.claude/worktrees/<branch>`; never work directly on `main` in the main checkout. `bun install` in each new worktree.

## Per-PR flow (from the plan)
worktree off `main` → `bun install` → green baseline → implement → `turbo typecheck` + `turbo test` → push → PR → watch CI (incl. Vercel deploy) → merge → remove worktree. Schema PRs: `convex run <migration> '{"dryRun":true}'` before relying.

## Known follow-on items
- The `listByAgency` boundary fix (PR 2) closes the only outstanding security gap from the benchmark review.
- Open issue #57 (tenant activation landing `/proposta/[publicId]`) should live in `apps/pay` by the same trust-boundary logic (not started, out of this refactor's scope).
