# Delinquencies domain — session handoff (2026-07-22)

State capture for a fresh session picking up where PR #256 leaves off.

## TL;DR — where you are

**The delinquencies data layer is DONE and merged (or waiting for merge).** Branch: `worktree-delinquencies-domain`, PR: **[mutav-app#256](https://github.com/mutav-finance/mutav-app/pull/256)**. 21 commits, 144/144 tests, all CI checks green.

Shipped: notice state machine → schema → 5 queries → 5 mutations → seed → 3 new audit-action literals → docs + reusable review workflows.

**What's next:** three follow-up PRs, all unblocked by this landing.

## Follow-up PRs (in order)

### 1. Agency `/delinquencies` UI wiring — ~60 min
- Replace `MOCK_ROWS` in `apps/agency/src/components/delinquencies/delinquency-page.tsx` with `preloadQuery(api.delinquencies.useCases.listByAgency, ...)` + `usePreloadedQuery`.
- Wire the existing filters (property/tenant/CPF/status/date range/amount range) to the query's args instead of client-side filtering.
- Row actions: "Cancelar" → `markCanceled` mutation; view/detail drawer → `getByPublicId`.
- **New:** open-notice form — no route today. Recommend a drawer triggered from `PageHeader actions`, not a new route.
- New i18n keys under the existing `delinquencies` namespace in `apps/agency/messages/{en,pt-BR}.json`.

### 2. Admin `/defaults` UI — ~90 min
- Currently `<PillarPlaceholder />` at `apps/admin/src/app/[locale]/(admin)/defaults/page.tsx`. Build in-place.
- Queue table backed by `listOpenAdminQueue` (staff role ≥ compliance gated by the query).
- Notice detail drawer/route with three action buttons:
  - **Verify (cover)** → `staffMarkResolvedByCover` — but `coverOperationPublicId` requires the cover domain (not built yet). Options: (a) stub with a text input for the ref, (b) block until the cover domain lands. Recommend (a) with a "Preview" tag.
  - **Dispute** → `staffMarkCanceledByDismissal({ disposition: { kind: 'staff_dispute' }})` — note this transitions to `resolved`, not `canceled` (documented in the mutation).
  - **Dismiss** → `staffMarkCanceledByDismissal({ disposition: { kind: 'staff_dismissed' }})`.
- New i18n keys under a new `defaults` namespace in `apps/admin/messages/{en,pt-BR}.json`.

### 3. Cross-branch composition — coordination
- The sibling `worktree-guarantee-lifecycle` branch has the guarantee state machine only (pure logic, no schema). When it lands its schema + transition mutation:
  - `staffMarkResolvedByCover` should trigger a `contracts.guaranteeState` transition (`in_arrears → cover_committed` etc.).
  - Add a follow-up commit on delinquencies-domain (or a combined branch) that calls the guarantee-transition mutation from `staffMarkResolvedByCover`.
- Meanwhile, `coverOperationPublicId` is `v.string()` with a `TODO(link):` marker in mutations.ts:staffMarkResolvedByCover args. Migrate to `v.id("coverOperations")` when the cover domain lands.

## Deferred (deliberately, with reason)

Every one of these was flagged by a review lens and considered — deferring is a documented choice, not an oversight.

- **Agency-side audit** — three `TODO(audit)` markers on `openNotice`/`markResolved`/`markCanceled` in `mutations.ts`. Design decision needed:
  - Option A: extend `mutationWithAgencyScope` with an `appendAgencyAudit` helper (mirroring `appendStaffAudit`).
  - Option B: ADR that agency writes rely on `openedByUserId` + `openedAt` columns only; no audit chain.
- **`openStats` aggregate migration** — carries `TODO(agg)` marker. Migrate to `@convex-dev/aggregate` before any agency crosses ~1000 open+recent notices. Not blocking today.
- **`SELF_TRANSITION` vs `TERMINAL_STATE` on idempotent retry** — machine returns `SELF_TRANSITION` when target===current for ANY state (including terminal). Caller-side fix (map both to "already at target") is cleaner than reordering the machine's error precedence.
- **`staffMarkCanceledByDismissal` name/behavior mismatch** on `staff_dispute` — the mutation returns `terminalStatus: 'resolved'` when kind is `staff_dispute`. Rename or split would ripple; documented in the return type.
- **Concurrent `openNotice` race** — Convex has no unique constraints; two racing calls with identical `(contract, rentDueDate)` both pass the duplicate check and both insert. Proper fix needs an OCC-retry path or a serialization lock. Low realistic probability at pilot volumes.
- **Test-helper duplication** — `makeFixture` (~65 lines) copy-pasted verbatim across `scenarios.test.ts` + `useCases.test.ts` + `mutations.test.ts`. Same for `insertNotice` and `grantStaffRole`. Real cleanup, ~200 lines of moves. Follow-up PR should promote to `convex/lib/testFixtures.ts`.
- **`scenarios.test.ts` has ~40 inline `ctx.db.insert("contractDelinquencyNotices", {...})` blocks** — should use a shared `makeNotice` helper. Same follow-up as above.
- **`build-domain-{queries,mutations}.js` share ~80% scaffolding** — worth extracting a `.claude/workflows/lib/build-domain.js` helper. Deep fix would be a Workflow-runtime contract upstream so args-normalization stops duplicating.
- **Schema optional envelopes → discriminated union** — `resolution` and `cancellation` are both `v.optional(...)` on `contractDelinquencyNotices` when the invariant is exactly-one-per-terminal-status. A discriminated union like `invoiceState` would dissolve the `openStats` envelope defensive log, the `shapeDelinquencyNoticeRow` `?.` chains, and the `staffMarkCanceledByDismissal` branch logic all at once. Requires a schema migration; out of pre-prod reseed-first policy today.

## Anatomy of what shipped

### Files by domain (all in `convex/delinquencies/` unless noted)

| File | LOC | Purpose |
|---|---:|---|
| `machine.ts` | 92 | Pure 3-state notice lifecycle (`open → { resolved \| canceled }`); `assertTransition` returning `Result<{from,to}, {code}>` |
| `domain.ts` | 117 | `DelinquencyNotice`, `DelinquencyNoticeId`, `NOTICE_RESOLUTION_KIND`, `NOTICE_CANCELLATION_REASON`, `NOTICE_EVIDENCE_SOURCE`, validators, predicates |
| `useCases.ts` | 380 | 5 queries: `listByAgency`, `getByPublicId`, `openStats`, `listOpenAdminQueue`, `getByPublicIdInternal` |
| `mutations.ts` | 475 | 5 mutations: `openNotice`, `markResolved`, `markCanceled`, `staffMarkResolvedByCover`, `staffMarkCanceledByDismissal` |
| `machine.test.ts` | 118 | 12 pure tests (3×3 matrix) |
| `domain.test.ts` | 61 | 6 pure tests (value-object shape) |
| `scenarios.test.ts` | 2653 | 52 db-backed lifecycle tests |
| `useCases.test.ts` | 570 | 23 query-surface tests |
| `mutations.test.ts` | 1094 | 44 write-surface tests |

### Schema (added in `convex/schema.ts`)

Table `contractDelinquencyNotices` with 4 indexes:
- `by_publicId` — `["publicId"]` — resource lookup
- `by_agency_status` — `["agencyId", "status"]` — agency queue / stats
- `by_contract_dueDate` — `["contractId", "rentDueDate"]` — `openNotice` duplicate check
- `by_status_openedAt` — `["status", "openedAt"]` — cross-agency FIFO admin queue

Notice publicId format: **`DN-<contractPublicId>-<YYYY-MM-DD>`** with `-2`, `-3` suffixes on collision (deterministic + greppable). Enforced YYYY-MM-DD via `RENT_DUE_DATE_PATTERN` regex at write time — callers passing ISO datetimes get `INVALID_RENT_DUE_DATE`.

### Auth wrapper choices (canonical, from `convex/lib/auth.ts`)

| Function | Wrapper | Why |
|---|---|---|
| `listByAgency`, `openStats` | `queryWithAgencyScope` | client passes `agencyId` |
| `getByPublicId` | bare `query` + `assertAgencyAccess` | resource-by-id; `agencyId` from row; returns `null` on Forbidden |
| `listOpenAdminQueue` | `queryWithMutavRole({ minRole: 'compliance' })` | cross-agency staff queue |
| `getByPublicIdInternal` | `internalQuery` | called by other Convex fns (future cover integration) |
| `openNotice` | `mutationWithAgencyScope` | client passes `agencyId` |
| `markResolved`, `markCanceled` | bare `mutation` + `assertAgencyAccess` | resource-by-id; write lets throw propagate |
| `staffMarkResolvedByCover`, `staffMarkCanceledByDismissal` | `mutationWithMutavRole({ minRole: 'compliance' })` | staff cross-agency, emits `ctx.appendStaffAudit(...)` |

**No new custom wrapper introduced.** The existing 5 cover every case.

### Audit-action literals added to `convex/audit/domain.ts`

- `DELINQUENCY_RESOLVED_BY_COVER` — emitted by `staffMarkResolvedByCover`
- `DELINQUENCY_DISMISSED` — emitted by `staffMarkCanceledByDismissal` for `staff_dismissed`
- `DELINQUENCY_DISPUTED` — emitted by `staffMarkCanceledByDismissal` for `staff_dispute`

## Reusable infra shipped alongside

### Root `vitest.config.ts` + scripts

Root config solves the `import.meta.glob is not a function` trap that hit every fresh worktree running `bunx vitest` at the root. New scripts:

- `bun run test:convex` — one-shot Convex suite from repo root
- `bun run test:convex:watch` — TDD loop
- `bun run test:file <path>` — single file, works with any path

### Saved workflows in `.claude/workflows/`

Three reusable multi-phase workflows for future domains:

- **`build-scenario-tests`** — produces `convex/<domain>/scenarios.test.ts`. Design → Implement → 3-way adversarial verify (scenario completeness, schema/index, test quality) → Address gaps.
- **`build-domain-queries`** — produces `convex/<domain>/useCases.ts` + `useCases.test.ts`. Same 5-phase shape; lenses = wrapper contract, index efficiency, return-shape stability.
- **`build-domain-mutations`** — produces `convex/<domain>/mutations.ts` + `mutations.test.ts`. Lenses = wrapper contract, machine composition (assertTransition-before-patch), audit + write safety.

Invocation shape:
```
Workflow({ name: 'build-domain-queries', args: { domain: 'guarantees', contextNotes: '...' } })
```

**Landmine:** the Workflow tool's script parser rejects `Date.now()`, `new Date()`, `Math.random()` literal tokens in **prompt strings** (not just runtime calls). Paraphrase with "current-time primitive" / "server-side timestamp" / "RNG call" in prompts. Documented in CLAUDE.md § Domain-surface workflows.

## Repo conventions codified during this branch

- **English-only code identifiers** (CLAUDE.md § Code style) — types, `as const` value objects, DB values, i18n **keys** must be English. American spelling (`canceled` not `cancelled`). PT-BR lives only in `messages/pt-BR.json` **values**. Pre-existing PT (`CONTRACT_STATUS = { ATIVO, ... }`) grandfathered.
- **Testing rubric** (CLAUDE.md § Testing) now names `scenarios.test.ts` as a canonical test-file kind alongside `useCases.test.ts` and `seed.test.ts`.
- **`Doc<'X'>`/`Id<'X'>` outside entity files is a CI hard fail** (existed before, but this branch tripped it — see the `7836a02` fix commit). Always import the alias from `convex/<domain>/domain.ts`.

## Gotchas to avoid tripping

1. **`bun run seed` runs against the current Convex deployment.** In a worktree, that's whatever `.env.local` points at (usually shared with the parent working tree). Reseeding from a worktree can silently affect Draau's local. Only reseed from the main checkout unless you know what you're doing.

2. **`bunx convex codegen`** without `CONVEX_DEPLOYMENT` set fails. Copy `.env.local` from the parent working tree into the worktree, or run `bunx convex dev --once` first.

3. **`bunx vitest` at the repo root without a config throws `import.meta.glob is not a function`.** Always use `bun run test:convex`.

4. **Turbo caches typecheck aggressively.** After a schema change, delete `.turbo/` locally to bust cache if you get stale error messages.

5. **The `code-quality` PreToolUse hook regex-matches `as <Type>` casts.** It fires on the word "as" appearing in English prose (e.g. "as ISO datetime" in a test name, "since as Date instances" in a comment). Rephrase — don't add `// hook-ok:` unless the finding is a genuine cast.

## Where to look

- **PR description** — [mutav-app#256](https://github.com/mutav-finance/mutav-app/pull/256) — full commit-by-commit breakdown.
- **Scenarios doc (protocol repo)** — [mutav#185](https://github.com/mutav-finance/mutav/pull/185) — the canonical scenario matrix + legal-defense checklist that drove the state machine + envelope shapes.
- **CLAUDE.md § Testing / Domain-surface workflows** — invocation shape for the three saved workflows.
- **Instawards SOW memory** — `~/.claude/projects/-Users-jubs-Projects-tga-protocol-mutav-app/memory/project_instawards_sow.md` — the 30-day sprint scope that motivated this data layer.
- **Broader roadmap** — [`docs/architecture/README.md`](../../docs/architecture/README.md) has the domain catalog; delinquencies is now a shipped domain there.
