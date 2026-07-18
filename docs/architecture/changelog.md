# Changelog — full spec

This is the reference doc for Mutav's agent-facing changelog. If you only need the one-paragraph agent contract, read the `Changelog` section in [`CLAUDE.md`](../../CLAUDE.md) and come back here when you hit an edge case.

The system is:

- **Agent-authored, agent-consumed.** A drafter script inspects the diff and writes the entry. No human review step gates it.
- **In-repo pending, GitHub Release archived.** Entries live under `changelog/pending/` until `bun run changelog:release` promotes them into a SemVer-tagged GitHub Release and deletes the pending files.
- **Enforced by sensors.** Three Claude hooks plus two husky hooks block PRs missing an entry and surface pending sync actions to whoever pulls `main`.

## Overview

When a PR merges to `main`, other developers on the team (notably Draau, who runs his own local Convex deployment) sometimes need to take manual action to stay in sync — set a new env var, re-run the seed, install packages, run a one-off script, or acknowledge a schema-shape change. The Convex migration component auto-heals schema migrations at deploy time; env, seed, and manual steps do not. Slack + verbal handoff is lossy.

The second, equally important pain: **agentic development runs on stale context**. A Claude subagent picking up work tomorrow has no compact record of what changed since the last release, why it changed, and what non-obvious constraints landed. `git log` is too coarse; PR bodies live on GitHub and are not loaded into context; commit messages capture "what" not "why".

The changelog is a two-tier fix:

1. **Sync actions** — a mechanical runbook for anyone (human or agent) pulling `main`, emitted deterministically by filesystem-signal detectors.
2. **Notes for future agents** — the "why" and the hidden constraints, written into the entry at draft time so a subagent three months out can rehydrate context without paging through PRs.

The single-repo-version model (no per-package versioning, no growing `CHANGELOG.md`) is deliberate: SemVer belongs on the release tag, and history belongs on GitHub Releases.

## Repository layout

```
changelog/
└── pending/                             # in-repo, agent-authored, cleared on release
    ├── 2026-07-18-tenant-registry-cleanup.md
    └── 2026-07-18-wizard-field-primitives.md

scripts/changelog/
├── types.ts                             # shared TS types (Entry, SyncAction, Category)
├── validate.ts                          # schema check — shared by hooks + husky
├── signals.ts                           # filesystem-signal detectors → SyncAction[]
├── draft.ts                             # generate/update entry from diff + commits + PR body
├── release.ts                           # aggregate pending → tag → gh release → clear
└── sync-notice.mjs                      # banner rendering — SessionStart hook + post-merge

.claude/hooks/
├── changelog-required.js                # PreToolUse — blocks `gh pr create` w/o entry
├── changelog-draft.js                   # UserPromptSubmit — nudges the agent to draft
└── changelog-sync-notice.js             # SessionStart — banner of unseen sync actions

.husky/
├── pre-push                             # existing — extended to run changelog:validate
└── post-merge                           # NEW — runs sync-notice.mjs on git pull / merge
```

The `changelog/` directory has no `archive/` — the tag and `gh release view <tag>` are authoritative history. If you find yourself wanting to `git log changelog/archive/`, open a follow-up instead (see [Follow-ups](#follow-ups) in the design spec).

## The PR entry

Each PR lands exactly one file at `changelog/pending/YYYY-MM-DD-<kebab-slug>.md`. The slug derives from the branch name (`feat/tenant-registry-cascade` → `tenant-registry-cascade`), so parallel branches never touch the same file and merge conflicts on `pending/` are structurally avoided.

### Frontmatter schema

| Field             | Type                                                       | Required        | Notes                                                                                                  |
| ----------------- | ---------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `pr`              | `number \| "unmerged"`                                     | yes             | PR number once opened; `"unmerged"` for local drafts before `gh pr create`.                            |
| `branch`          | `string`                                                   | yes             | Full branch name. The changelog-required hook matches on this to find the entry for a branch.          |
| `merged_at`       | ISO date `YYYY-MM-DD`                                      | no              | Empty until the PR merges; the release script backfills it if absent.                                  |
| `category`        | `feat \| fix \| refactor \| perf \| chore \| docs \| test` | yes             | Closed vocabulary. Mirrors the conventional-commit prefix used across the repo.                        |
| `scopes`          | `string[]`                                                 | yes             | Domain paths, e.g. `convex/contracts`, `apps/agency`. Used for release-note grouping.                  |
| `breaking`        | `boolean`                                                  | yes             | Forces a `major` bump on the next release if `true`.                                                   |
| `sync_actions`    | `SyncAction[]`                                             | yes (may be []) | Ordered runbook. `kind` is a closed vocabulary (`env \| install \| seed \| migrate \| run \| manual`). |
| `touched_domains` | `string[]`                                                 | yes             | Every `convex/*`, `packages/*`, `apps/*` path the diff touched. Consumer agents filter on this.        |
| `issue_refs`      | `string[]`                                                 | no              | Cross-repo issue refs, e.g. `mutav-app#225`, `mutav-stellar#57`.                                       |

All fields import from `scripts/changelog/types.ts`. Do not redefine them locally — the validator, drafter, release script, and hooks all read the same `Entry` type.

### Body sections

Two h2 sections, in this exact order:

- `## What changed` — one paragraph, WHY the change was made and the observable effect. No marketing prose. No "this PR does…" — write it as if the reader is walking into the repo cold.
- `## Notes for future agents` — non-obvious constraints, hidden invariants, or "we tried X and it didn't work because Y." This is the field that pays back the most in agent context three months from now. Leave it empty (or write "None.") only if you truly cannot think of anything a future subagent would need.

### Example

```markdown
---
pr: 264
branch: feat/tenant-registry-cascade
merged_at: 2026-07-18
category: refactor
scopes: [convex/contracts, packages/ui]
breaking: false
sync_actions:
  - kind: env
    detail: "Set NEW_ETHERFUSE_TOKEN in .env.local, then `bun run convex:env:sync`"
  - kind: seed
    detail: "bun run seed"
touched_domains:
  - convex/contracts
  - packages/ui/wizard
issue_refs: [mutav-app#225]
---

## What changed

Collapsed the tenant-registry lookup so agency-scoped queries no longer materialize a
second copy of the tenant document. Reads drop from 2 → 1 for every contracts list;
writes are unchanged.

## Notes for future agents

The tenant snapshot used to live on `contracts.tenant` and on `tenants` — the two were
kept in sync by hand and drifted twice. The new source of truth is `tenants`, with a
denormalized cache on the contract only for list projections. Do NOT reintroduce a
`contracts.tenant` write path without first checking the invariant in
`convex/contracts/domain.ts::assertTenantSnapshotFresh`.
```

**One entry per branch.** The drafter overwrites the entry on re-run rather than accumulating multiple files. If you rebase and re-run, you get the same file back with the same slug and current signals.

**`sync_actions.kind` is a closed vocabulary.** Detectors emit these mechanically; no free-form kinds. If a change needs human-only action (Vercel dashboard env, Auth0 config, etc.), it uses `kind: manual` with a drafter-authored description.

**`touched_domains` mirrors CLAUDE.md's Convex-domain + monorepo-layout conventions** so consumer agents can filter by their current work area.

**No versioning field per entry.** SemVer belongs on the release tag.

## Filesystem-signal detectors

`scripts/changelog/signals.ts` is the trust anchor for `sync_actions`. Given a diff of `main...HEAD`, each detector fires deterministically. If a signal is present in the diff, the corresponding action is emitted; the drafter never has to guess.

| Detector  | Fires when the diff touches…                                                                               | Emits                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `env`     | `.env.example`, `convex/lib/env.ts`, or `apps/*/src/lib/env.ts`                                            | `kind: env` with new var names extracted from the added lines        |
| `install` | `package.json` or `bun.lock`                                                                               | `kind: install`, `detail: "bun install"`                             |
| `seed`    | `convex/seed.ts`, `convex/seed.test.ts`, or a Convex `domain.ts` in the same PR as schema changes          | `kind: seed`, `detail: "bun run seed"`                               |
| `migrate` | Any file added to `runAll` in `convex/migrations.ts`                                                       | `kind: migrate`, informational only (auto-runs on `bunx convex dev`) |
| `run`     | New `scripts/*.ts` script referenced from a `package.json` script                                          | `kind: run`, `detail` = the command                                  |
| `manual`  | Catchall the drafter emits when a change requires human-only action (Vercel dashboard, Auth0 config, etc.) | `kind: manual`, drafter-authored description                         |

The signature is `detectSignals({ baseRef?, cwd? }): Promise<SyncAction[]>`. The default `baseRef` is `main`. `draft.ts` combines the returned actions with LLM-authored `## What changed` and `## Notes for future agents` sections. Detectors return `SyncAction[]` in the order matching `SYNC_ACTION_ORDER` from `types.ts` so the sync banner reads predictably (env before install before seed before migrate before run before manual).

## Author workflow

The drafter is `scripts/changelog/draft.ts`, invoked as:

- `bun run changelog:draft` — user- or agent-triggered directly. Infers branch from `git rev-parse --abbrev-ref HEAD`.
- `bun run changelog:draft --pr=264` — infers branch from the PR instead of the working tree.
- Automatically nudged by `changelog-draft.js` when the agent's prompt mentions opening a PR (advisory, never blocks).

**Inputs it reads:**

1. `git rev-parse --abbrev-ref HEAD` — current branch (unless `--pr=` overrides).
2. `git diff --stat main...HEAD` and `git log main..HEAD --pretty=%s%n%b` — change surface + commit messages.
3. `gh pr view --json title,body,number,url` — if a PR exists for the branch.
4. `detectSignals()` from `signals.ts` for `sync_actions`.

**Outputs:**

- Writes `changelog/pending/<date>-<slug>.md` (overwrites if present for the same branch, so re-runs are idempotent).
- Prints the resulting file to stdout for the caller to inspect.
- Returns `Result<Entry, ValidationError>` internally — the CLI wrapper prints a human-readable error and exits non-zero on failure.

**Category + scopes inference.** Both come from the conventional-commit prefixes already used across the repo (`feat(migrations):`, `refactor(agency):`, `perf(agency):`). The drafter reads the log, takes the highest-severity prefix (`feat` > `fix` > `refactor` > `perf` > `chore` > `docs` > `test`), and pulls scopes from every prefix in the log.

**Non-trivial diff heuristic.** `validate.ts::isNonTrivialDiff` reads a `git diff --stat` string and returns `false` when the entire diff is docs-only, whitespace-only, or `.claude/notes/*`-only. The hooks call this before enforcing entry presence, mirroring the escape valve in `code-quality.js`.

## Consumer workflow

### Agents scanning `pending/`

Before starting non-trivial work in a domain, an agent should scan `changelog/pending/*.md` for entries whose `touched_domains` or `scopes` intersect the target files. These entries carry the "why" behind recent changes that `git log` alone can't reveal — they exist specifically to prevent operating on stale assumptions. The scanning is manual today (a `bun run changelog:context <domain>` command is a tracked follow-up).

### Humans reading the banner

Draau (and every non-Claude workflow) sees changelog activity via the `.husky/post-merge` banner on `git pull` / `git merge`:

```
[changelog] 4 entries since your last pull:
  - env      Set NEW_ETHERFUSE_TOKEN in .env.local, then bun run convex:env:sync
  - seed     bun run seed  (schema-shape change in convex/contracts)
  - install  bun install
  - manual   Enable "Send All Events" toggle in Auth0 dashboard
Full entries: changelog/pending/*.md
```

Claude sessions get the same banner as prepended session context via `changelog-sync-notice.js` on `SessionStart`. Both call into `sync-notice.mjs` so the rendering stays consistent.

## Sensor reference

Five sensors total. Three Claude hooks (JSON-stdin protocol, `.claude/hooks/*.js`) and two husky hooks.

All Claude hooks follow the same protocol as `no-brand-edit.js` and `code-quality.js`: read stdin, `JSON.parse`, inspect `tool_name` / `tool_input.command` / `tool_input.file_path`. Exit `0` to allow, exit `2` with a stderr message to block. Silent exit `0` on parse failure. Registered in `.claude/settings.json` under `hooks.PreToolUse` / `hooks.UserPromptSubmit` / `hooks.SessionStart`.

### `changelog-required.js` — PreToolUse on `Bash`

Fires when `tool_input.command` matches `gh pr create` or `gh pr edit --body`.

Behavior:

1. Reads `git rev-parse --abbrev-ref HEAD`.
2. Reads `changelog/pending/*.md`, matches by `branch:` frontmatter.
3. If a match exists, allow (exit 0).
4. If no match exists and `isNonTrivialDiff(git diff --stat main...HEAD)` returns `true`, block with exit `2` and a stderr message pointing the caller at `bun run changelog:draft`.
5. If the diff is trivial (docs-only, whitespace-only, `.claude/notes/*`-only), allow.

Escape hatch: create `changelog/pending/.skip-<branch-slug>` deliberately for a genuinely no-op PR. See [Skipping the check](#skipping-the-check).

### `changelog-draft.js` — UserPromptSubmit

Advisory, never blocks. Detects prompts containing "open a PR", "open PR", "gh pr create", "push and open", "make PR". If no changelog entry matches the current branch, prepends context reminding the agent to run `bun run changelog:draft` before `gh pr create`.

### `changelog-sync-notice.js` — SessionStart

Reads `changelog/pending/*.md` newer than `.claude/notes/.changelog-seen` (a local, gitignored marker). If any have `sync_actions`, prepends a compact banner into the session grouped by `kind` (using `SYNC_ACTION_ORDER` for ordering). Updates the marker automatically.

### `.husky/pre-push` — universal enforcement

Extends the existing pre-push (which already blocks direct pushes to `main`) with a `bun run changelog:validate` call. This is the **primary** gate — it fires for every workflow, Claude or not. The `changelog-required.js` PreToolUse hook exists to fail faster in agent sessions before `gh pr create` even runs.

`bun run changelog:validate` behavior:

1. Read current branch.
2. If diff is trivial → exit 0.
3. If the branch has a `.skip-<branch-slug>` marker → exit 0.
4. If no entry file matches the branch → exit non-zero with a message.
5. Otherwise, run `validate()` from `scripts/changelog/validate.ts` on the entry file and exit non-zero on `ValidationError`.

### `.husky/post-merge` — Draau's runbook

Runs `node scripts/changelog/sync-notice.mjs` on every `git pull` / `git merge` that changes `changelog/pending/*.md`. Prints the banner shown in [Humans reading the banner](#humans-reading-the-banner). Same underlying function as `changelog-sync-notice.js`, so behavior stays consistent between shell users and Claude sessions.

## Release workflow

Manual command, human-decided cadence. SemVer bump is explicit:

```
bun run changelog:release --bump=<patch|minor|major>
```

Sequence (implemented in `scripts/changelog/release.ts`):

1. Read `changelog/pending/*.md`, `validate()` each one; refuse to release if any entry fails.
2. Group entries by `category`, build a Keep-a-Changelog-style markdown note (Added / Changed / Fixed / etc.).
3. If any entry has `breaking: true` and `--bump` is not `major`, refuse and prompt.
4. Bump `package.json` version at the workspace root.
5. Commit the pending-directory deletion + version bump in one commit: `chore(release): v0.X.Y`.
6. Tag `v0.X.Y`; push commit + tag.
7. `gh release create v0.X.Y --title "v0.X.Y" --notes-file <generated>`.
8. Delete `changelog/pending/*.md` files (in the release commit; GitHub Release retains them).

Dry-run mode: `bun run changelog:release --dry-run` composes the notes without writing anything. CI runs the dry-run on every PR touching `changelog/pending/` to catch aggregation errors early.

The GitHub Release is authoritative history. There is intentionally no in-repo `CHANGELOG.md` and no `changelog/archive/`. If you need to know what shipped in `v0.4.2`, use `gh release view v0.4.2`.

## Skipping the check

For a genuinely no-op PR — a whitespace-only fix, a `.claude/notes/*` update, a README typo — the sensors already skip the check via the non-trivial-diff heuristic in `isNonTrivialDiff`. You should not need to touch anything.

When the heuristic misfires (e.g. a bulk file move that is semantically a no-op), create a marker file to opt out:

```
changelog/pending/.skip-<branch-slug>
```

Where `<branch-slug>` is the same slug the drafter uses (e.g. `feat/tenant-registry-cascade` → `tenant-registry-cascade`). Both the `changelog-required.js` hook and `bun run changelog:validate` treat the marker as an explicit opt-out and allow the PR through.

Rules:

- Create it **deliberately**. Do not auto-generate `.skip-*` markers from scripts.
- One marker per branch; the file name encodes the branch.
- The marker is committed on the branch (so reviewers can see the opt-out) but is deleted by the release script alongside the rest of `pending/`.
- If you find yourself reaching for a marker more than once a month, that is a signal to tighten `isNonTrivialDiff` instead.

## FAQ

### What if I rebase?

Re-run `bun run changelog:draft`. The drafter is idempotent per branch: same slug, same file. It re-reads the current diff, re-runs `detectSignals()`, and overwrites the entry. If you rebased onto a moved `main`, the drafter will pick up the correct new signals automatically. If your rewritten history changes the conventional-commit prefixes, the inferred `category` / `scopes` update to match.

### What if my branch merges main (or someone else's changelog entry lands under me)?

Two files, no conflict. Merge conflicts on `changelog/pending/` are structurally avoided because every branch owns exactly one file, named by its own slug. If you pull `main` and it brings in `changelog/pending/2026-07-18-something-else.md`, that entry is simply another pending file — you do not touch it and it does not touch yours. Your own entry keeps its slug. The next `sync-notice` banner (either from `post-merge` or the next `SessionStart`) will surface the new sync actions from the merged-in entries.

### How do I mark a follow-up commit as "no new sync-actions"?

You do not need to. `sync_actions` is regenerated from the diff on every drafter run — if your follow-up commit does not touch any signal file (`.env.example`, `package.json`, `convex/seed.ts`, etc.), the detectors emit nothing new and the entry stays the same after re-drafting.

If you are adding a `manual` action that the detectors cannot see (Vercel dashboard change, Auth0 config), edit the entry file directly, add the action under `sync_actions`, and re-run `bun run changelog:validate` to confirm the schema still passes. The drafter will not clobber your hand-edits on the next run unless you pass `--force`.

### What if the same branch has multiple PRs?

Do not do that. One branch, one PR, one entry. If you truly need to split, cut a new branch and let the drafter emit a fresh entry with the new slug.

### Where does the version number live?

In the workspace-root `package.json` `version` field. There is no per-package version. Bumps happen only via `bun run changelog:release --bump=<patch|minor|major>`.

### What if `changelog:release` fails partway through?

The commit + tag are a single step. If `gh release create` fails (network, auth), the commit and tag are already in place; re-run just that step manually with the generated notes file. If the version bump fails, no commit has landed yet — fix and retry.
