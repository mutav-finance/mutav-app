# Changelog — reference doc

This is the reference doc for Mutav's changelog. If you only need the one-paragraph agent contract, read the `Changelog` section in [`CLAUDE.md`](../../CLAUDE.md).

## Scope

Start-small pilot. **The load-bearing feature is `sync_actions[]`** — a mechanical runbook for anyone (human or agent) pulling `main` who might otherwise miss a manual step like `bun run seed` or setting a new env var.

**Explicitly out of scope for now:**

- Body sections (`## What changed` / `## Notes for future agents`). Prose was aspirational; ship without and revisit if entries prove to be a durable "why" source.
- Release aggregation, tagged GitHub Releases, SemVer. No versioned-release ritual today.
- PR-blocking sensors. Discipline forcing functions are unproven for a 3-dev team; the pre-push hook validates schema shape only.

Add those back if the pilot shows a real need.

## Repository layout

```
changelog/
└── pending/                        # one entry per branch, cleared manually if desired
    └── YYYY-MM-DD-<slug>.md

scripts/changelog/
├── types.ts                        # 6-field Entry shape + SyncAction + Category
├── validate.ts                     # schema + isNonTrivialDiff + `--lint-pending` CLI
├── signals.ts                      # 6 detectors + git plumbing
├── draft.ts                        # mechanical writer (frontmatter only)
└── sync-notice.mjs                 # banner (post-merge) + JSON (SessionStart)

.claude/hooks/
└── changelog-sync-notice.js        # SessionStart injection

.husky/
├── pre-push                        # runs `bun run changelog:validate` (schema-shape guard)
└── post-merge                      # runs sync-notice.mjs banner (path-filtered)
```

## The entry — schema

Frontmatter only. Six fields, three required, three optional:

| Field          | Required | Type                                                 | Notes                                                                                 |
| -------------- | :------: | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `branch`       |    ✓     | `string`                                             | Keys the entry; the drafter re-uses the existing filename on re-runs.                 |
| `category`     |    ✓     | `feat`/`fix`/`refactor`/`perf`/`chore`/`docs`/`test` | Inferred by majority-vote across commit prefixes.                                     |
| `summary`      |    ✓     | `string`                                             | One-line synthesis. PR title (prefix-stripped) if a PR exists, else the first commit. |
| `pr`           |          | `number` \| `"unmerged"`                             | Populated once the PR opens.                                                          |
| `merged_at`    |          | ISO date                                             | Drives the sync-notice "seen-since" filter. Missing → falls back to file mtime.       |
| `sync_actions` |    ✓     | `SyncAction[]`                                       | The runbook. Emitted deterministically by the filesystem-signal detectors.            |

`SyncAction = { kind: "env" \| "install" \| "seed" \| "migrate" \| "run" \| "manual", detail: string }`.

### Example

```markdown
---
pr: 253
branch: feat/agentic-changelog-harness
category: refactor
summary: agent-facing changelog harness — sync-actions runbook + banner
sync_actions:
  - kind: install
    detail: "bun install"
  - kind: run
    detail: "bunx husky"
---
```

## Filesystem-signal detectors

`scripts/changelog/signals.ts` is the trust anchor for `sync_actions[]`. Given `git diff <base>...HEAD`, each detector fires deterministically. If a signal is present in the diff, the corresponding action is emitted.

| Detector  | Fires when the diff touches…                                                                 | Emits                                                     |
| --------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `env`     | `.env.example`, `convex/lib/env.ts`, or `apps/*/src/lib/env.ts`                              | `env` with new var names extracted from the added lines   |
| `install` | `package.json` or `bun.lock`                                                                 | `install`, `detail: "bun install"`                        |
| `seed`    | `convex/seed.ts`, `convex/seed.test.ts`, or a `convex/*/domain.ts` alongside a schema change | `seed`, `detail: "bun run seed"`                          |
| `migrate` | Any file added to `runAll` in `convex/migrations.ts`                                         | `migrate`, informational (auto-runs on `bunx convex dev`) |
| `run`     | New `scripts/*.ts` referenced from a `package.json` script, or `.husky/*` change             | `run`, `detail` = the command                             |
| `manual`  | Catchall — the drafter can emit this for Vercel dashboard env, Auth0 config, etc.            | `manual`, drafter-authored description                    |

Detectors are pure over a synthetic `FileDiff[]` — testable in isolation. `detectSignals()` builds that from `git diff` in one place; every test supplies literals.

## Author workflow

```bash
bun run changelog:draft                     # writes changelog/pending/YYYY-MM-DD-<slug>.md
bun run changelog:draft --pr=253            # overrides the PR lookup
bun run changelog:draft --base=origin/main  # overrides the merge-base
bun run changelog:draft --verbose           # also prints the rendered file
```

The drafter:

1. Reads current branch (rejects detached HEAD)
2. Reads commit subjects (`git log <base>..HEAD --pretty=format:%s -z`)
3. Optionally reads PR title (`gh pr view --json title,number`)
4. Runs `detectSignals()` for `sync_actions[]`
5. Infers `category` by majority vote across conventional-commit prefixes
6. Picks `summary`: PR title (prefix-stripped) if a PR exists, else the first commit subject
7. Writes the file, reusing the existing filename if an entry for this branch already exists

## Consumer workflow

**Draau on `git pull`:**

`.husky/post-merge` runs `node scripts/changelog/sync-notice.mjs` (banner mode), path-filtered so it only spawns node when the merge touched `changelog/pending/**`. Output:

```
📋 2 changelog entries since your last pull:
  ▸ env      Set NEW_ETHERFUSE_TOKEN in .env.local, then `bun run convex:env:sync`
  ▸ install  bun install
  ▸ seed     bun run seed
Full entries: changelog/pending/*.md
```

**Claude SessionStart:**

`.claude/hooks/changelog-sync-notice.js` runs `sync-notice.mjs --format=json --mark-seen`. Injects a compact context block into the agent's first turn:

```
## Pending changelog entries since last session
- 2026-07-18 · refactor · agent-facing changelog harness — sync-actions runbook + banner

## Sync actions Draau (and you) may need to run
- install: bun install
- run: bunx husky
```

## Validation

`bun run changelog:validate` iterates every `changelog/pending/*.md` and runs the schema check. Wired into `.husky/pre-push` so a broken entry fails the push. This is a schema-shape guard only — it does not require an entry per PR.

## What's not here (and would be next if entries prove valuable)

- **Body sections** — `## What changed` / `## Notes for future agents` for durable "why" context beyond git log. Add back if the runbook feature works and there's appetite for narrative capture.
- **PR-blocking sensor** — a PreToolUse hook that refuses `gh pr create` without a matching entry. Add if entries start getting skipped.
- **Release aggregation** — a `changelog:release` script that groups pending entries into a SemVer-tagged GitHub Release. Add if the team adopts a release cadence.
- **Skip marker as schema field** — today there's no escape hatch (there's no PR block either); if we re-add enforcement, a `skip: true` field with a required `reason` is cleaner than a filename-encoded side-channel.
