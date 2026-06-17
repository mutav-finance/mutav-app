# Invoice + Settlement refactor — session handoff (2026-06-16)

State capture for a fresh session to continue the `payments`→`invoices` + settlement-split refactor.

## TL;DR — where to start

The refactor is ~⅔ done. **4 PRs merged to `main`; 3 remain.** Next up: **PR 2** (generalize `convex/anchors/` → `payments/providers/` + fix the `listByAgency` boundary). Read these first, in order:
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
| **PR 2** | `anchors/` → `payments/providers/`, `anchorOrders`→`providerOrders`, **fix `listByAgency`** (bearer-gated `listBanksForInvoice`) | ⏳ **next** |
| PR 3 | Settlement `payments` table — WIDEN + migrate + dual-write | ⏳ |
| PR 4 | Drop `invoice.method` — NARROW | ⏳ |

`main` HEAD at handoff: `1329e96` (PR 1). Working tree: on `main`, clean. No active worktrees for this work (the rename worktrees were removed; `feat/bigdatacorp-integration` + `feat/screening-phase-1` are unrelated).

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
