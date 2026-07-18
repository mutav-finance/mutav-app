---
pr: unmerged
branch: feat/agentic-changelog-harness
category: feat
scopes: [changelog]
breaking: false
sync_actions:
  - kind: install
    detail: "bun install"
  - kind: run
    detail: "bunx husky"
touched_domains:
  - .claude
  - .husky
  - docs
  - root
  - scripts
issue_refs: []
---

## What changed

- refactor(changelog): simplify pass 2 — tighter hooks + one-shot parse
- feat(changelog): agent-facing changelog harness

## Notes for future agents

- sync-notice.mjs: compute `effectiveMs` once per entry, stat-first before
  parse so a full YAML parse is skipped for entries older than the
  seen-marker. Removes repeat Date.parse calls in filter + sort comparators.
- draft.ts: rename RegExp factories from SCREAMING_SNAKE (misleadingly
  constant-shaped) to `branchFrontmatterRe` / `slugFilenameRe`, extract a
  shared `escapeRegex`, inline `todayIsoDate()` at its single call site.
- release.ts: surface `git fetch` failure instead of silently trusting a
  stale `origin/main` ref, inline `today()` at its call site.
- changelog-required.js: combine `git rev-parse --show-toplevel` +
  `--abbrev-ref HEAD` into one subprocess (`getGitContext`), collapse
  `getDiffProbe` + inline `isNonTrivialDiff` recombination into a single
  `shouldRequireEntry(cwd) → { required, baseResolved }` boolean helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

Per-PR changelog entries under `changelog/pending/*.md` with a machine-readable
schema, filesystem-signal detectors that fill in `sync_actions[]` from the diff,
and sensors that block `gh pr create` when an entry is missing.

- scripts/changelog/{types,validate,signals,draft,release,sync-notice}: build,
  validate, aggregate + tag releases, banner rendering
- .claude/hooks/changelog-{required,draft,sync-notice}.js: PreToolUse gate on
  gh pr create/edit --body, UserPromptSubmit nudge on "open PR" prompts,
  SessionStart injection of unseen entries into the first turn
- .husky/pre-push: extend with changelog:validate; .husky/post-merge: new,
  prints sync-actions banner on git pull (path-filtered to pending changes)
- CLAUDE.md, docs/architecture/changelog.md: agent contract + reference
- tests: 62 vitest specs across validate/signals/draft + SYNC_ACTION_ORDER
  alignment guard across the three vocabulary copies (types.ts,
  sync-notice.mjs, the SessionStart hook)

Full design at docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
