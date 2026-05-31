# Monorepo Migration — PR 1: Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Turborepo + Bun-workspaces scaffolding at the root of `mutav-app/` so that subsequent migration PRs can move code into `apps/*` and `packages/*` without any further infrastructure work. The existing Next.js app stays at the root unchanged — this PR adds *only* workspace plumbing.

**Architecture:** Turborepo 2.x as the task runner, Bun workspaces (`apps/*`, `packages/*`) as the package layout, a shared `tsconfig.base.json` for future per-app extension, and CODEOWNERS lines pre-committed for every persona-app and package boundary the spec calls out. Nothing in this PR moves code, so the verification model is "existing build/test/lint/typecheck must pass unchanged before and after every task."

**Tech Stack:** Bun 1.3.1 (already pinned), Turborepo 2.x (new), TypeScript 5.x (existing), GitHub CODEOWNERS.

**Spec:** [`docs/superpowers/specs/2026-05-31-monorepo-migration-design.md`](../specs/2026-05-31-monorepo-migration-design.md) § Section 2 — "PR 1 — Workspace foundation".

---

## File structure

PR 1 creates 5 new files and modifies 1 existing file. No source code moves.

| Path | Status | Responsibility |
|---|---|---|
| `package.json` | **Modify** | Add `workspaces` field (`apps/*`, `packages/*`) + add `turbo` to `devDependencies`. Existing scripts and deps untouched. |
| `turbo.json` | **Create** | Declare the Turborepo task pipeline (`build`, `dev`, `lint`, `test`, `typecheck`, `format:check`). |
| `tsconfig.base.json` | **Create** | Shared strict TS settings for future `apps/*` and `packages/*` consumers. Root `tsconfig.json` does **not** extend it yet — that's PR 2's responsibility. |
| `apps/.gitkeep` | **Create** | Empty file so the directory tracks in git despite being empty. |
| `packages/.gitkeep` | **Create** | Same. |
| `.github/CODEOWNERS` | **Create** | Per-app + per-package + per-domain ownership rules per spec § Section 6. |

`bun.lock` will also change (regenerates when `turbo` is added). That's expected and committed.

## Verification strategy

PR 1 is a **no-regression** PR: it adds infrastructure without changing behavior. The verification model is the same for every task in this plan:

1. **Capture baseline** (Task 1) — run all check commands on `origin/main` and record results.
2. **Make change** — implement the task.
3. **Re-run all checks** — every check that passed on `main` must still pass.
4. **Commit** — only after all checks pass.

No new test code is written in this PR because there is no behavior to test. The existing test suite (vitest) plus `next build` plus `tsc --noEmit` plus `eslint` plus `prettier --check` are the regression gate.

## Pre-flight

- [ ] **Pre-flight 1: Branch off origin/main**

This plan and the spec live on `docs/monorepo-migration-plan`. The implementation work for PR 1 lands on a separate branch off `origin/main` so the spec/plan and the implementation are reviewable as two independent PRs.

```bash
cd /Users/jubs/Projects/tga-protocol/mutav-app
git fetch origin main
git checkout -b feat/monorepo-pr1-workspace-foundation origin/main
```

Expected: clean checkout, `git status` reports "On branch feat/monorepo-pr1-workspace-foundation. Your branch is up to date with 'origin/main'."

- [ ] **Pre-flight 2: Read spec § Section 2 PR 1**

Open `docs/superpowers/specs/2026-05-31-monorepo-migration-design.md` and re-read the "PR 1 — Workspace foundation" subsection before starting. This plan implements exactly that scope; if the spec disagrees with this plan, stop and reconcile.

---

## Task 1: Capture baseline

**Files:** none (read-only verification).

**Why:** Every later task needs to confirm "no regression." That assertion requires a known-good starting state to compare against.

- [ ] **Step 1: Install dependencies (clean)**

```bash
cd /Users/jubs/Projects/tga-protocol/mutav-app
bun install
```

Expected: completes without errors; `bun.lock` may or may not change (uncommitted change discouraged — if it changes, investigate before continuing).

- [ ] **Step 2: Run typecheck and capture result**

```bash
bun run typecheck 2>&1 | tee /tmp/baseline-typecheck.txt
echo "Exit: $?"
```

Expected: exit code `0`. Record the output to `/tmp/baseline-typecheck.txt` so later tasks can diff against it.

- [ ] **Step 3: Run lint and capture result**

```bash
bun run lint 2>&1 | tee /tmp/baseline-lint.txt
echo "Exit: $?"
```

Expected: exit code `0`. Record output.

- [ ] **Step 4: Run tests and capture result**

```bash
bun run test 2>&1 | tee /tmp/baseline-test.txt
echo "Exit: $?"
```

Expected: exit code `0`. Record the final "Test Files passed" / "Tests passed" counts.

- [ ] **Step 5: Run format check and capture result**

```bash
bun run format:check 2>&1 | tee /tmp/baseline-format.txt
echo "Exit: $?"
```

Expected: exit code `0`. Record output.

- [ ] **Step 6: Run Next.js build and capture result**

```bash
bun run build 2>&1 | tee /tmp/baseline-build.txt
echo "Exit: $?"
```

Expected: exit code `0`; "Compiled successfully" in output.

- [ ] **Step 7: Snapshot the baseline summary**

Write a short summary to `/tmp/baseline-summary.txt`:

```bash
cat > /tmp/baseline-summary.txt <<'EOF'
mutav-app PR1 baseline (origin/main)
- typecheck: PASS
- lint:      PASS
- test:      PASS (N test files, M tests)
- format:    PASS
- build:     PASS
EOF
```

Replace `N` and `M` with the actual counts from Step 4. This file is the reference point for every later "no regression" check.

**Task 1 commit:** none. This task only captures baseline data into `/tmp/`; nothing is written to the repo.

---

## Task 2: Add Turborepo

**Files:**
- Modify: `package.json` (add `turbo` to `devDependencies`)
- Create: `turbo.json`
- Modify: `bun.lock` (regenerated by `bun install`)

**Why:** Turborepo is the task runner that orchestrates per-workspace builds. Adding it now (before any workspace packages exist) lets PR 2 onward use `turbo run <task>` to invoke per-app scripts.

- [ ] **Step 1: Install Turborepo as a dev dependency**

```bash
bun add -D -E turbo@^2.5.0
```

`-D` = devDependency. `-E` = exact version (no `^` prefix in the manifest). Expected: `package.json` `devDependencies` now contains `"turbo": "2.5.x"`; `bun.lock` updates.

> If the install fails or pulls a major version > 2, stop. This plan targets Turborepo 2.x. Do not silently upgrade to 3.x.

- [ ] **Step 2: Verify turbo CLI is reachable**

```bash
bunx turbo --version
```

Expected: prints `2.5.x` (or whatever exact 2.x version was pinned in Step 1).

- [ ] **Step 3: Create `turbo.json`**

File: `turbo.json` (repo root). Exact content:

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "ui": "stream",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "format:check": {
      "outputs": []
    }
  }
}
```

Notes for the implementer:
- `ui: "stream"` is preferred over `tui` for CI compatibility.
- `dependsOn: ["^build"]` means "wait for the `build` task of every internal dependency to finish first." It's a no-op now (no internal deps), but PR 2+ will rely on it.
- `dev` is `cache: false, persistent: true` because dev servers run forever.
- `outputs: []` on `test` and `format:check` because they don't produce build artifacts to cache.

- [ ] **Step 4: Run `bunx turbo run typecheck` and verify it dispatches**

```bash
bunx turbo run typecheck
```

Expected: turbo reports finding 1 task in 1 package (the root) and dispatches to the existing `bun run typecheck` script. Exit code `0`. (If turbo complains "no workspaces" — that's expected to be fixed in Task 3, but `typecheck` should still run on the root.)

> If turbo complains it can't find a `typecheck` task in any workspace, it's looking for a package — Task 3 fixes that. For now, run `bun run typecheck` directly to confirm baseline still holds:

```bash
bun run typecheck
```

Expected: same `PASS` as baseline.

- [ ] **Step 5: Confirm baseline still holds**

```bash
bun run lint && bun run test && bun run build && echo OK
```

Expected: prints `OK`. No regression.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock turbo.json
git commit -m "$(cat <<'EOF'
chore(workspace): add Turborepo task runner

Adds turbo@^2.5.0 as a devDependency and a root turbo.json
declaring the task pipeline (build, dev, lint, test, typecheck,
format:check). No source code moves; existing scripts unchanged.

First step of the monorepo migration plan (PR 1 of 8).

Refs mutav-finance/mutav-app#139
EOF
)"
```

Expected: husky pre-commit hook runs prettier on `package.json` and `turbo.json`; commit succeeds.

---

## Task 3: Declare Bun workspace globs

**Files:**
- Modify: `package.json` (add `workspaces` field)
- Modify: `bun.lock` (regenerated)

**Why:** Without `workspaces`, Bun treats the root as a single package and ignores `apps/*` / `packages/*` even when those directories exist. Declaring the globs now (before they contain anything) is a no-op for Bun and unlocks PR 2.

- [ ] **Step 1: Add `workspaces` to `package.json`**

Edit `package.json`. After the `"engines"` field (around line 8), insert:

```json
  "workspaces": ["apps/*", "packages/*"],
```

The full block in context (existing lines kept, new line marked `// + `):

```jsonc
{
  "name": "mutav-app",
  "version": "0.1.0",
  "private": true,
  "packageManager": "bun@1.3.1",
  "engines": {
    "bun": ">=1.3.0"
  },
  // + "workspaces": ["apps/*", "packages/*"],
  "scripts": { ... }
}
```

(The `// + ` line is a comment for the reader. Replace it with the actual JSON line: `"workspaces": ["apps/*", "packages/*"],`.)

- [ ] **Step 2: Re-run `bun install`**

```bash
bun install
```

Expected: completes without errors. `bun.lock` may regenerate (empty workspace globs are valid; lockfile records the workspace shape).

> If Bun complains about the empty globs, stop and investigate. The expected behavior in Bun 1.3.x is to silently accept empty workspace patterns.

- [ ] **Step 3: Confirm baseline still holds**

```bash
bun run typecheck && bun run lint && bun run test && bun run format:check && bun run build && echo OK
```

Expected: prints `OK`. Compare each individual check's output against `/tmp/baseline-*.txt` if anything looks off.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "$(cat <<'EOF'
chore(workspace): declare apps/* and packages/* workspace globs

Adds a workspaces field to the root package.json so Bun treats
apps/* and packages/* as workspace members. Both directories are
empty for now; PR 2 onward populates them.

Refs mutav-finance/mutav-app#139
EOF
)"
```

Expected: commit succeeds.

---

## Task 4: Add `tsconfig.base.json`

**Files:**
- Create: `tsconfig.base.json`

**Why:** Future `apps/*` and `packages/*` tsconfigs will extend this base so strict compiler options stay consistent across the monorepo. The existing root `tsconfig.json` is **not** modified in this PR — that's PR 2's job (when the existing app moves to `apps/agency/`).

- [ ] **Step 1: Create `tsconfig.base.json`**

File: `tsconfig.base.json` (repo root). Exact content:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Mutav base",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": false,
    "allowJs": false,
    "jsx": "preserve",
    "incremental": true
  },
  "exclude": ["node_modules"]
}
```

Notes:
- `noUncheckedIndexedAccess` matches the project's "TypeScript strict" rule from CLAUDE.md.
- No `paths` field here — each consuming tsconfig (per-app) declares its own `paths`.
- No `include` field — base configs don't include files; consumers do.

- [ ] **Step 2: Validate the base config is parseable**

```bash
bunx tsc --project tsconfig.base.json --noEmit --listFiles 2>&1 | head -5
```

Expected: tsc parses the config (may complain about "no files to compile" — that's fine; the base doesn't include any files). What matters is no parse error.

Actually, since there's no `include`, tsc may exit with `error TS18003: No inputs were found`. That's an acceptable outcome for a base-only config and confirms the file is syntactically valid. To confirm the file just parses without running compilation:

```bash
node -e "JSON.parse(require('fs').readFileSync('tsconfig.base.json', 'utf8')); console.log('OK')"
```

Expected: prints `OK`.

- [ ] **Step 3: Confirm root tsconfig.json is untouched**

```bash
git diff tsconfig.json
```

Expected: empty diff (the root tsconfig is not modified in this PR).

- [ ] **Step 4: Confirm baseline still holds**

```bash
bun run typecheck && echo OK
```

Expected: prints `OK` (the existing tsconfig.json doesn't reference the new base, so typecheck behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add tsconfig.base.json
git commit -m "$(cat <<'EOF'
chore(workspace): add tsconfig.base.json for future apps/* and packages/*

Shared strict TS settings. Root tsconfig.json is NOT modified in
this PR; PR 2 wires it to extend the base when the existing app
moves to apps/agency/.

Refs mutav-finance/mutav-app#139
EOF
)"
```

---

## Task 5: Create empty `apps/` and `packages/` directories

**Files:**
- Create: `apps/.gitkeep`
- Create: `packages/.gitkeep`

**Why:** Git does not track empty directories. The `.gitkeep` convention forces both directories to appear in the repo so subsequent PRs can `git mv` into them without first having to create the parent.

- [ ] **Step 1: Create both directories with .gitkeep**

```bash
mkdir -p apps packages
touch apps/.gitkeep packages/.gitkeep
```

Expected: both files exist (`ls apps/ packages/` shows `.gitkeep` in each).

- [ ] **Step 2: Confirm the empty workspaces don't break Bun**

```bash
bun install
```

Expected: completes without errors. The workspace globs now resolve to two existing-but-empty directories — Bun should treat this as "no workspace members" without complaint.

- [ ] **Step 3: Confirm baseline still holds**

```bash
bun run typecheck && bun run lint && bun run test && bun run build && echo OK
```

Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add apps/.gitkeep packages/.gitkeep
git commit -m "$(cat <<'EOF'
chore(workspace): scaffold empty apps/ and packages/ directories

Adds .gitkeep files so the workspace directories track in git.
PR 2 fills apps/agency/; PR 6 fills packages/.

Refs mutav-finance/mutav-app#139
EOF
)"
```

---

## Task 6: Add `.github/CODEOWNERS`

**Files:**
- Create: `.github/CODEOWNERS`

**Why:** The spec commits to per-app + per-package CODEOWNERS landing in PR 1 so that subsequent PRs (which actually populate the directories) immediately have ownership rules. Team handles are placeholders per the spec; replacing them is tracked as a Section 10 follow-up.

- [ ] **Step 1: Create `.github/CODEOWNERS`**

File: `.github/CODEOWNERS`. Exact content:

```
# Mutav monorepo — CODEOWNERS
#
# Per the spec at docs/superpowers/specs/2026-05-31-monorepo-migration-design.md
# § Section 6, every app and every package has its own ownership rule.
# Team handles are placeholders — see spec § Section 10 follow-up.

# Persona apps
/apps/agency/         @mutav-finance/agency-team
/apps/pay/            @mutav-finance/agency-team
/apps/fund/           @mutav-finance/fund-team
/apps/admin/          @mutav-finance/admin-team

# Mutav API (Convex backend) — single shared deployment
/convex/              @mutav-finance/api-team

# Shared packages
/packages/ui/         @mutav-finance/design-system
/packages/*           @mutav-finance/api-team

# CI and infra
/.github/             @mutav-finance/api-team
/CODEOWNERS           @mutav-finance/api-team
/turbo.json           @mutav-finance/api-team
/tsconfig.base.json   @mutav-finance/api-team
/package.json         @mutav-finance/api-team
/bun.lock             @mutav-finance/api-team

# Architecture docs
/docs/                @mutav-finance/api-team
```

Notes for the implementer:
- The team slugs (`@mutav-finance/agency-team`, etc.) **do not exist yet** in the GitHub organization. GitHub will warn about unrecognized handles but will not fail. Creating the real teams is a Section 10 follow-up in the spec.
- The most-specific rule wins in CODEOWNERS, so `/packages/ui/` is matched first before falling through to `/packages/*`.
- `/CODEOWNERS` at the bottom guards the file itself.

- [ ] **Step 2: Validate CODEOWNERS syntax**

GitHub provides no local linter, but a basic check is "no malformed lines."

```bash
grep -E '^[^#]' .github/CODEOWNERS | grep -vE '^\s*$' | awk '{if (NF < 2) print "BAD LINE:", $0}'
```

Expected: no output (every non-comment, non-blank line has at least 2 fields: path + owner).

- [ ] **Step 3: Confirm baseline still holds**

```bash
bun run typecheck && bun run lint && bun run test && bun run build && echo OK
```

Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add .github/CODEOWNERS
git commit -m "$(cat <<'EOF'
chore(workspace): add CODEOWNERS with per-app and per-package rules

Per spec § Section 6. Team handles are placeholders; replacing them
with real GitHub team slugs is tracked as a Section 10 follow-up.

Refs mutav-finance/mutav-app#139
EOF
)"
```

---

## Task 7: Final regression sweep

**Files:** none (read-only verification).

**Why:** Confirm the *cumulative* effect of Tasks 2–6 introduces no regression. Each task's individual check confirms its own change; this task confirms the whole stack still holds together.

- [ ] **Step 1: Clean install from scratch**

```bash
rm -rf node_modules
bun install
```

Expected: completes without errors; `bun.lock` does not change (a clean install against a committed lockfile should be reproducible).

- [ ] **Step 2: Re-run all baseline checks**

```bash
bun run typecheck 2>&1 | tee /tmp/final-typecheck.txt
bun run lint 2>&1 | tee /tmp/final-lint.txt
bun run test 2>&1 | tee /tmp/final-test.txt
bun run format:check 2>&1 | tee /tmp/final-format.txt
bun run build 2>&1 | tee /tmp/final-build.txt
```

Expected: every command exits `0`.

- [ ] **Step 3: Diff against baseline**

```bash
diff /tmp/baseline-typecheck.txt /tmp/final-typecheck.txt || echo "typecheck differs"
diff /tmp/baseline-lint.txt /tmp/final-lint.txt           || echo "lint differs"
diff /tmp/baseline-test.txt /tmp/final-test.txt           || echo "test differs"
diff /tmp/baseline-format.txt /tmp/final-format.txt       || echo "format differs"
diff /tmp/baseline-build.txt /tmp/final-build.txt         || echo "build differs"
```

Expected: differences are limited to timing output (e.g. "Done in 4.3s" vs "Done in 4.7s"). No functional differences (no new errors, no new warnings, same test counts).

> If any difference is functional (a check that previously passed now fails, a test that previously ran now doesn't), **stop and debug**. Do not open the PR until the regression is understood and either fixed or explained.

- [ ] **Step 4: Verify the turbo CLI sees the workspace**

```bash
bunx turbo run typecheck --dry-run=json | head -20
```

Expected: JSON output that lists the root package as a task target. Turbo recognizes the workspace shape even though `apps/*` and `packages/*` are empty.

- [ ] **Step 5: Verify git tree is clean**

```bash
git status
```

Expected: "nothing to commit, working tree clean." All changes from Tasks 2–6 are committed.

**Task 7 commit:** none. This task only verifies; nothing is written.

---

## Task 8: Open PR

**Files:** none (operational).

**Why:** Land the workspace foundation so PR 2 has a base to branch from.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/monorepo-pr1-workspace-foundation
```

Expected: branch published to GitHub; remote tracking set.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --head feat/monorepo-pr1-workspace-foundation --title "feat(workspace): PR 1 — Turborepo + Bun workspaces foundation (mutav-app#139)" --body "$(cat <<'EOF'
## Summary

First of 8 PRs in the monorepo migration ([spec](docs/superpowers/specs/2026-05-31-monorepo-migration-design.md), [plan](docs/superpowers/plans/2026-05-31-monorepo-migration-pr1-workspace-foundation.md)).

Adds workspace plumbing only — **no source code is moved or modified**. The existing Next.js app stays at the repo root. Subsequent PRs use this scaffolding to migrate code into `apps/*` and extract shared `packages/*`.

### Changes

- `turbo.json` — Turborepo 2.x task pipeline (`build`, `dev`, `lint`, `test`, `typecheck`, `format:check`)
- `package.json` — `workspaces: ["apps/*", "packages/*"]` + `turbo` devDep
- `tsconfig.base.json` — shared strict TS settings for future per-app extension (not yet referenced)
- `apps/.gitkeep`, `packages/.gitkeep` — empty workspace dirs
- `.github/CODEOWNERS` — per-app + per-package + per-domain rules (team handles are placeholders per spec § Section 10)

### Verification

This PR is a no-regression PR. All existing checks pass identically to `main`:

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run test`
- [x] `bun run format:check`
- [x] `bun run build`

Baseline-vs-final diffs are limited to timing output (see Task 7 in the plan).

### Out of scope

Anything from spec § Section 6 that isn't pure workspace scaffolding:

- Moving the existing Next.js app to `apps/agency/` — PR 2
- Per-app Vercel projects, `turbo-ignore` deploy gating — PR 8
- Real GitHub team slugs in CODEOWNERS — spec § Section 10 follow-up

Refs #139.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens; GitHub returns the URL. CI starts (commitlint, lint-staged, etc.) and should pass on first run since the diff is config-only.

- [ ] **Step 3: Verify CI passes**

```bash
gh pr checks
```

Expected: all required checks pass. If anything fails, debug in a follow-up commit on the same branch; do not merge until green.

- [ ] **Step 4: Stop**

Do **not** merge in this session. The PR awaits human review per the standard repo workflow. PR 2's plan will be written after PR 1 merges to `main`.

---

## Final PR checklist

Before opening the PR (or as part of the PR description):

- [ ] All 5 new files created, 1 file modified, `bun.lock` regenerated
- [ ] All 7 commits land on `feat/monorepo-pr1-workspace-foundation` in the order Tasks 2–6 prescribe (Task 1 = baseline, no commit; Task 7 = verify, no commit)
- [ ] `bun.lock` reflects only the addition of `turbo` and its transitive deps (and the workspace field if Bun records that there)
- [ ] No source file under `src/`, `convex/`, `messages/`, `public/`, etc. has been touched
- [ ] No script in `package.json` has been changed (only `devDependencies` and `workspaces` added)
- [ ] CODEOWNERS team handles are intentionally placeholders — Section 10 follow-up noted in PR description

---

## What's next

PR 2 (writing-plans session, not this plan): move the existing Next.js app at the repo root into `apps/agency/` verbatim. That plan will need to handle:

- Relocating `src/`, `next.config.ts`, `messages/`, `public/`, `vercel.json`, etc.
- Updating `apps/agency/tsconfig.json` to extend the new `tsconfig.base.json`
- Keeping `convex/` at the repo root and ensuring `@/convex/_generated/api` still resolves
- Re-rooting the Vercel project at `apps/agency`
- Husky / lint-staged path updates (the pre-commit hook is currently anchored at root)

That plan is its own multi-task design effort and will be written after this PR merges.
