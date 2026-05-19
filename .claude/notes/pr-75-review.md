# PR #75 Review Plan — `feat(onboarding): polish and UX fixes`

**PR:** https://github.com/mutav-finance/mutav-app/pull/75
**Branch:** `feat/agency-onboarding` (author: `draaujpeg`)
**State at audit:** `mergeStateStatus: DIRTY`, `mergeable: CONFLICTING` — needs rebase before merge
**Scope:** +2895 / −82 across 32 files. New public onboarding flow, Auth0 wiring stubs, `agencies` schema migration, new `agencyDocuments` table.

This file is the working doc for the review. Two halves:

1. [Findings](#findings) — item-by-item, ordered by review pass, each tied to the prior PR it regresses (if any) and the exemplar to copy from.
2. [Rebase plan](#rebase-plan) — how to land the fix without re-opening the security gaps that PRs #70, #71, #85 just closed.

---

## Why the regression framing matters

Three security PRs landed in the 24h before #75 opened:

- **#70** (auth wrappers, exemplar) — established `queryWithAgencyScope` / `mutationWithAgencyScope` / `assertAgencyAccess`. Single-function Auth0 swap promise.
- **#71** (dead-query sweep) — deleted 7 unscoped public queries including `agencies.listMembersForAgency` and `agencies.getMembership`.
- **#85** (agencies + payments sweep) — closed "the pre-Auth0 gap where bare query handlers in `convex/{payments,agencies}/useCases.ts` accepted `agencyId` from client args with no membership check."
- **#76** (score migration) — reinforced the convention: client-side functions that touch agency data become `queryWithAgencyScope`.

PR #75 reopens those gaps inside the same file (`convex/agencies/useCases.ts`) hours after #85 merged, plus reintroduces two of the functions #71 deleted. The review framing should be "this PR undoes #85 in the same file" — not "this PR has bugs."

---

## Findings

### Pass 1 — Security wrappers (regresses #85, blocks merge)

| # | Handler | Current | Fix | Exemplar | Verify |
|---|---------|---------|-----|----------|--------|
| 1 | `agencies.saveBankingInfo` | bare `mutation`, `agencyId` from args | `mutationWithAgencyScope`, drop `agencyId` from handler args | `contracts.cancelProposal` (PR #70) | `rg -n "^export const (save\|generate\|submit\|list)\w+ = (mutation\|query)\(\{" convex/agencies/useCases.ts` returns 0 |
| 2 | `agencies.generateDocumentUploadUrl` | bare `mutation` | same | same | same grep |
| 3 | `agencies.saveDocument` | bare `mutation` + accepts client `storageId` | `mutationWithAgencyScope` **plus** server-side storageId tracking (new `agencyUploadIntents` table, or verify storageId was minted in this transaction window for this agency) | exemplar to author — no prior precedent | After fix: every `v.id("_storage")` arg appears inside a function that does an ownership check |
| 4 | `agencies.submitOnboarding` | bare `mutation` | `mutationWithAgencyScope` | `contracts.cancelProposal` | same grep as #1 |
| 5 | `agencies.listDocumentsForAgency` | bare `query`, `agencyId` from args | `queryWithAgencyScope` | `payments.listByAgency` (PR #85) | same grep as #1 |

### Pass 2 — Convention regressions (block merge)

| # | Finding | Regresses | Fix | Verify |
|---|---------|-----------|-----|--------|
| 6 | `convex/agencies/validators.ts` exists | `convex-document-types` skill — "Never create separate validators.ts files" | Inline `agencyDocumentKindValidator` literals in `schema.ts` (matches `agencyType`/`onboardingState`/`bankingInfo` already inlined in this PR); declare canonical validator in `agencies/domain.ts` | `fd validators.ts convex/` returns 0 |
| 7 | `Id<"agencies">` imported in `onboarding-wizard.tsx`, `wizard-step-documents.tsx` | `convex-document-types` rule | Replace with `AgencyId` from `@convex/agencies/domain` (already exported in this PR) | `rg 'Id<"agencies">' src/` returns 0 |
| 8 | `Id<"_storage">` used in `wizard-step-documents.tsx` | same rule | Export `StorageId` alias from `convex/lib/storage.ts` (new), or wrap upload flow so component receives a typed handle | `rg 'Id<"_storage">' src/` returns 0 |
| 9 | 4 mutations return `{success, error} as const` without `Result<TSuccess, TError>` annotation | `convex-functional-programming` skill | Import `Result` from `@/lib/result`, declare explicit return types | Each handler's return type contains `Result<` |
| 10 | 6 client components hold state/effects inline instead of `use{Component}` view model | `react-component-view-model-pattern` skill | At minimum extract `useOnboardingWizard` and `useWizardStepDocuments`. Doc the rest as deferred with tracking issue | `rg "use(State\|Effect\|Reducer\|Callback\|Memo\|Ref)\(" src/components/onboarding/*.tsx` only appears in `use*.ts` |

### Pass 3 — Quality / clarity (negotiable, cheap)

| # | Finding | Fix |
|---|---------|-----|
| 11 | `submitOnboarding` unicidade race | Add a `claimedDocuments` row both writers contend on, OR add a comment documenting the gap + manual-review safety net |
| 12 | `process.env.*` reads in `auth.config.ts` + 3 API route stubs | Route through `convex/lib/env.ts` / `src/lib/env.ts`. `auth.config.ts` may warrant a boundary exception — document inline |
| 13 | `tsconfig.json` removed `.next/types/**/*.ts` and `.next/dev/types/**/*.ts` | **Empirically a no-op.** Confirmed at `bun dev` startup: Next 16 auto-rewrites tsconfig on boot to re-add both lines (log: `include was updated to add '.next/types/**/*.ts'`). The PR's removal is reverted on every dev run, producing diff churn with zero functional effect. Drop the tsconfig change entirely — Next owns those lines. |
| 14 | `convex/anchors/actions.ts:1098` `agency.cnpj ?? ""` | Replace with explicit guard: `if (!agency.cnpj) throw new Error("KYB requires CNPJ — autonomo uses KYC")` |
| 15 | `bankingInfo.agency` field name | Rename to `bankingInfo.branch` — schema is brand new, no migration cost |
| 16 | No tests | At minimum: `convex-test` for `startOnboarding` resume vs new, `submitOnboarding` state-machine guards, unicidade race. Pure `wizardReducer` is vitest-able |
| 17 | `agencies.listMembersForAgency` + `agencies.getMembership` reinstated as `internalQuery` with `TODO(auth): public version` | Drop the TODO comments. When the dashboard needs them, add the wrapped public version then — don't pre-commit to redoing #71 |
| 18 | Auth0 callback pseudocode wrong (`afterCallback` doesn't drive post-callback redirect in SDK v3+) | Mark as "to verify against SDK" or remove the pseudocode |
| 19 | `isWizardErrorCode` duplicates the literal list | `const WIZARD_ERROR_CODES = [...] as const; type WizardErrorCode = typeof WIZARD_ERROR_CODES[number]` |
| 20 | **`auth.config.ts` breaks `bun dev` for every contributor without `AUTH0_ISSUER_BASE_URL` set.** Convex's deploy-time analyzer reads `process.env.AUTH0_ISSUER_BASE_URL` at module load and flags it as required, even though the code has a `?` runtime fallback for the missing case. Empirically confirmed: `bun dev` halts at `[cvx] ✖ Environment variable AUTH0_ISSUER_BASE_URL is used in auth config file but its value was not set.` | **Initial plan (lazy getter) doesn't work.** Empirically tested: Convex's analyzer executes `auth.config.ts` at deploy time and traces env reads through function calls (`getAuth0IssuerBaseUrl → process.env.X`). Stack trace from `bunx convex env remove`: `AuthConfigMissingEnvironmentVariable ... at getAuth0IssuerBaseUrl (convex/lib/env.ts:34:20) at <anonymous> (convex/auth.config.ts:27:15)`. **Actual fix**: (a) keep the lazy getter for hygiene (CLAUDE.md pattern), (b) document the deploy-time requirement in `auth.config.ts` comment + `.env.example` with explicit `bunx convex env set AUTH0_ISSUER_BASE_URL ""` instructions for dev. Contributors run that once after `npx convex init`. Not a code fix alone — Convex's design forces the env var to be set on every deployment. |
| 21 | (Moved finding #11 here for context — it became more material once #20 was observed.) Net: with both #11 and #20 fixed, `bun dev` works out-of-the-box on a fresh clone with no env-var setup. | See #13 (tsconfig is auto-rewritten so just drop the change) and #20 (lazy getter for the env var). |

### What looks good (preserve through rebase)

- ✓ `@/i18n/navigation` + server `redirect()` in `wizard/page.tsx` — clean stateless pattern
- ✓ `en.json` + `pt-BR.json` updated symmetrically, including `t.rich` for legal-consent paragraph
- ✓ CPF/CNPJ digits-only storage with format-stripping at boundary in `startOnboarding`
- ✓ `agencyDocuments` uses `by_agency_kind` composite index instead of `.filter()`
- ✓ `auth.config.ts` providers gated on env-var presence — dev still works without Auth0
- ✓ `getOrCreateByIdentity` covers legacy-email-link case (no duplicate user on first Auth0 login)
- ✓ Per-kind `fileInputRef` in documents step — addresses real race
- ✓ Documents step validates upload-URL response shape before trusting `storageId`
- ✓ `MEMBER_ROLE_ORDER` upgraded to `as const satisfies readonly MemberRole[]`
- ✓ `convex/lib/auth.ts` Auth0 swap is the single-function migration the original design promised

### Pre-merge regression greps

Run these on the rebased branch — every line should print zero hits (or only known boundary exceptions):

```bash
# 1. No bare public mutations/queries in domain files
rg -n "^export const \w+ = (mutation|query)\(\{" convex/ | rg -v "_generated|/lib/"

# 2. No raw Id<> outside entity files
rg -n 'Id<"[^"]+">' src/ convex/ | rg -v "_generated|/domain\.ts"

# 3. No validators.ts files
fd validators.ts convex/

# 4. process.env only in env boundary
rg -n "process\.env\." src/ convex/ | rg -v "src/lib/env\.ts|convex/lib/env\.ts|convex/auth\.config\.ts"

# 5. View-model pattern: hooks only in use*.ts, not *.tsx
rg -n "use(State|Effect|Reducer|Callback|Memo)\(" src/components/onboarding/ | rg "\.tsx:"
```

These five should be wired into CI as a `regression-greps` workflow after this PR lands so the next PR can't regress the pattern again. (Tracked separately — not blocking this PR.)

---

## Rebase plan

### Pre-flight

```bash
git fetch origin
git checkout feat/agency-onboarding
git status   # confirm clean working tree
```

### Conflict surface

Four files modified on both sides:

| File | Main side (since divergence) | Branch side (#75) | Conflict difficulty |
|------|------------------------------|-------------------|---------------------|
| `convex/agencies/useCases.ts` | #85 wrapped `getById`, `listAgenciesForUser`; #71 deleted `listMembersForAgency`, `getMembership` | Rewrites `getById` → `internalQuery`; reintroduces deleted funcs as `internalQuery`; adds onboarding mutation surface | **Hard** — semantic, not textual |
| `convex/anchors/actions.ts` | #85 likely updated `api.agencies.useCases.getById` callsite | #75 switches to `internal.agencies.useCases.getById` + adds `?? ""` fallback | Easy |
| `src/lib/contracts/wizard.ts` | Pre-existing main commit (not #76) | #75 deletes `isValidCPF`/`isValidCNPJ`, re-exports from `@/lib/brazil` | Verify after rebase — likely clean |
| `src/providers/workspace.tsx` | #85 changed `listAgenciesForUser` call to `{}`; #71 cleaned casts | #75 only adds `export` keyword to `DEV_USER_PUBLIC_ID` | Trivial |

### Resolution stance per file

**`convex/agencies/useCases.ts` — the hard one.** Rebase strategy:

1. Take main's version of the file as the base (it has #85's wrapper changes).
2. **Drop**: the re-introductions of `listMembersForAgency` and `getMembership` (PR #71 removed them; don't restore until a dashboard caller exists).
3. **Add on top** the new onboarding handlers from #75, but rewritten to use the wrappers from the start (per findings #1–#5):
   - `saveBankingInfo` → `mutationWithAgencyScope`
   - `generateDocumentUploadUrl` → `mutationWithAgencyScope`
   - `saveDocument` → `mutationWithAgencyScope` + storage-id ownership check (per finding #3)
   - `submitOnboarding` → `mutationWithAgencyScope`
   - `listDocumentsForAgency` → `queryWithAgencyScope`
   - `getOnboardingInProgress`, `getOnboardingStatus` → keep as `internalQuery` (no caller exists yet)
   - `getMyOnboardingStatus` → keep as-is (already `queryWithAuth`)
   - `startOnboarding` → keep as-is (already `mutationWithAuth`)
4. Keep `getById` as `internalQuery` — #85 had it as `queryWithAgencyScope` but its only consumer is `anchors/actions.ts:onboardAgencyEtherfuseKyb` which is `internalAction`. The internal conversion is correct; just align the callsite (next file).

**`convex/anchors/actions.ts`.** Take #75's `internal.agencies.useCases.getById` switch. Replace `agency.cnpj ?? ""` with an explicit guard (per finding #14):

```typescript
if (!agency.cnpj) {
  throw new Error("KYB requires CNPJ — autonomo agencies use KYC, not this path");
}
```

**`src/providers/workspace.tsx`.** Take main's body (post-#85 `{}` call shape, post-#71 cast cleanups). Add the `export` keyword to `DEV_USER_PUBLIC_ID`.

**`src/lib/contracts/wizard.ts`.** Verify the re-export delete from #75 still applies cleanly after rebase — if main's intervening change touched the same lines, take both: main's edits + #75's deletion of `isValidCPF`/`isValidCNPJ`.

### Commit strategy

Branch has 9 commits, 4 of which are `fix(onboarding): ...` review cleanups:

```
43e94fb fix(onboarding): status e rejected — Voltar aponta para /onboarding
fbb1b64 feat(onboarding): scaffolding de integração Auth0 + correções de segurança
4b4091e feat(onboarding): proteger leituras de PII e preparar funções de revisão KYC/KYB
3dc339a fix(onboarding): corrige 5 issues menores do code review
03453ec fix(onboarding): corrige 4 issues críticos do code review
a04db80 feat(onboarding): dados do responsável legal e aviso de conta bancária para imobiliária
0428331 fix(onboarding): corrigir todos os issues de code review (crítico → menor)
cdc4be3 feat(onboarding): polish, UX fixes e corrigir bug de registro duplicado
7795c3f feat(onboarding): wizard completo — perfil, documentos, bancário, revisão
```

Two options:

- **A — Interactive rebase + squash to ~3 commits.** Cleaner history; the four `fix` commits squash into their parent `feat` commits. The author already iterated multiple times, so the per-commit history doesn't carry forward useful debugging signal. Suggested groupings:
  - `feat(onboarding): wizard scaffolding + schema (perfil/documentos/bancário/revisão)` — 7795c3f + cdc4be3 + a04db80 + 0428331 + 03453ec + 3dc339a
  - `feat(onboarding): proteger leituras de PII com auth wrappers + funções KYC/KYB internas` — 4b4091e + fbb1b64
  - `fix(onboarding): redirect Voltar em status/rejected` — 43e94fb

- **B — Linear rebase, no squash.** Faster but leaves the noisy commit log. Only worth it if there's a reason to preserve per-step debugging (there isn't, given the rebase is rewriting the surface anyway).

Recommend **A**. The squashed commits also make `git log convex/agencies/useCases.ts` cleaner so future agents see #85's wrappers right above #75's additions, reinforcing the precedent.

### Execution

```bash
git fetch origin
git checkout feat/agency-onboarding

# Option A — interactive rebase + squash
git rebase -i origin/main
# In editor: squash per groupings above
# When conflicts hit:
#   convex/agencies/useCases.ts → resolve per stance above
#   convex/anchors/actions.ts → keep internal.* switch, replace ?? "" with guard
#   src/providers/workspace.tsx → take main + add export
#   src/lib/contracts/wizard.ts → verify clean
# Re-run regression greps from Findings section after each conflict resolution

# Push
git push --force-with-lease origin feat/agency-onboarding
```

`--force-with-lease` rather than `--force` so the push fails if someone else pushed to the branch in the meantime.

### Post-rebase checklist

Before re-requesting review:

- [ ] All 5 regression greps return 0 hits
- [ ] `bunx tsc --noEmit` clean
- [ ] `bunx convex codegen` clean
- [ ] `bun run lint` clean
- [ ] Manual: walk through `/onboarding` → `/onboarding/wizard?type=empresa` → submit; confirm wizard renders, mutations succeed against local Convex
- [ ] Manual: confirm logged-in user A can't call `saveBankingInfo({ agencyId: B's })` — should error with `ForbiddenError`
- [ ] `gh pr view 75 --json mergeable` returns `MERGEABLE` (not `CONFLICTING`)

### What this does NOT cover

- The CI regression-greps workflow itself (separate follow-up — not blocking #75)
- Backfill tests for `startOnboarding` / `submitOnboarding` (finding #16 — negotiable per author)
- View-model extraction for the remaining 4 components (finding #10 — partial fix accepted, tracking issue for the rest)
- The `bankingInfo.agency` → `bankingInfo.branch` rename (finding #15) — cheap during rebase since schema is brand new; if not done during rebase, becomes a real migration later

---

## Fix execution plan (approved 2026-05-18)

Approved decisions:

1. **Storage provenance (Phase 1.3)** — strict: new `pendingUploads` table with `agencyId`+`storageId`+`expiresAt`; `generateDocumentUploadUrl` inserts, `saveDocument` looks up and consumes
2. **`bankingInfo.agency` rename (Phase 2.6)** — yes, do it now while data is empty
3. **Phase 3 scope** — partial view-model extraction (`useOnboardingWizard` + `useWizardStepDocuments`) + tests (`startOnboarding`, `submitOnboarding`, `wizardReducer`). The 4 form-shaped steps stay as-is with a tracking issue

### Phase 0 — Pre-rebase standalone fixes (~30 min)

Three small fixes that aren't conflict-zone. Land them as separate commits on `feat/agency-onboarding`; they'll squash naturally during Phase 1.

| Step | Finding | Files | Verify |
|------|---------|-------|--------|
| 0.1 | #20 | `convex/lib/env.ts` adds `getAuth0IssuerBaseUrl()`/`getAuth0ClientId()`. `convex/auth.config.ts` calls them instead of reading `process.env` directly | `bun dev` works on a fresh deployment with no AUTH0 env vars set |
| 0.2 | #13 / #21 | Revert `tsconfig.json` to main's include lines (Next 16 owns those) | `git diff main tsconfig.json` empty |
| 0.3 | #6 | Delete `convex/agencies/validators.ts`. Inline `agencyDocumentKindValidator` literals in `convex/schema.ts`. Declare canonical validator in `convex/agencies/domain.ts`. Drop `_agencyDocumentKindValidator` re-export | `fd validators.ts convex/` returns 0 |

Phase 0 gate: `bunx tsc --noEmit` clean, cold `bun dev` start succeeds.

### Phase 1 — Rebase + security fix (~1–2 hours)

Per the [Rebase plan](#rebase-plan) above, with these additions applied during conflict resolution:

**In `convex/agencies/useCases.ts`:** swap 5 handlers to wrappers (findings #1–#5), drop reintroductions (finding #17), strip TODO(auth) comments. Implement `pendingUploads` storage provenance (finding #3, strict variant) — new table, two-handler change:

```typescript
// schema.ts
pendingUploads: defineTable({
  agencyId: v.id("agencies"),
  storageId: v.id("_storage"),
  expiresAt: v.number(),  // unix ms; 1h window
})
  .index("by_storage", ["storageId"])
  .index("by_expires", ["expiresAt"])

// useCases.ts: generateDocumentUploadUrl inserts a pendingUploads row
//              saveDocument looks up by storageId, verifies agencyId match, deletes the intent
```

**In `convex/anchors/actions.ts`:** explicit CNPJ guard instead of `?? ""` (finding #14).

**In `src/providers/workspace.tsx`:** take main's body + add `export`.

**In `src/lib/contracts/wizard.ts`:** keep re-export, verify cleanness.

Phase 1 gate: regression greps return 0, typecheck clean, `bunx convex run` of `saveBankingInfo` with a foreign agencyId throws `ForbiddenError`.

### Phase 2 — Convention sweep (~1–2 hours)

Single follow-up commit on the rebased branch. Six items, all small:

| Step | Finding | Effort |
|------|---------|--------|
| 2.1 | #7 — `AgencyId` alias in 2 components | 5 min |
| 2.2 | #8 — new `convex/lib/storage.ts` exporting `StorageId` | 10 min |
| ~~2.3~~ | ~~#9 — `Result<TSuccess, TError>` annotations on 5 mutations~~ | **Skipped.** PR #75 matches the codebase pattern (the exemplar `contracts.cancelProposal` from #70 also uses bare `{ success, error: { code } } as const` without `message` field or `Result<>` annotation). Applying the skill verbatim only to #75 makes it the odd domain out. Tracking as a separate cross-domain follow-up to tighten the Result pattern everywhere. |
| 2.4 | #19 — derive `WIZARD_ERROR_CODES` as const | 10 min |
| 2.5 | #18 — replace wrong Auth0 callback pseudocode with one-line TODO | 5 min |
| 2.6 | #15 — rename `bankingInfo.agency` → `bankingInfo.branch` across schema + consumers | 20 min |

Phase 2 gate: same as Phase 1 + visual smoke test of wizard end-to-end.

### Phase 3 — Refactor + tests (~3–5 hours, can split)

| Step | Scope | Effort |
|------|-------|--------|
| 3.1 | Partial view-model extraction: `useOnboardingWizard` + `useWizardStepDocuments`. Form-shaped steps tracked separately | 2 hr |
| 3.3 | `convex-test` for `startOnboarding`, `submitOnboarding`; vitest for `wizardReducer` | 1–2 hr |

Deferred to follow-up PRs:

- 3.2 (`submitOnboarding` unicidade race real fix) — add code comment now, fix later
- 3.4 (`process.env` in API route stubs) — touch when Auth0 SDK is actually wired
- View-model extraction for the 4 form-shaped wizard steps — tracking issue
- CI regression-greps workflow — separate PR

### Total budget

~6–8 hours end-to-end. Phase 0 (30 min) + Phase 1 (2 hr) + Phase 2 (2 hr) + Phase 3 partial (2–3 hr).
