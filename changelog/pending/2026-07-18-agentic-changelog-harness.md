---
pr: 253
branch: feat/agentic-changelog-harness
category: refactor
scopes: [changelog]
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
---

## What changed

agent-facing changelog harness

## Notes for future agents

The primary consumer is **agents** picking up work in a new session — `git log` alone can't reveal the _why_ behind recent changes. Per-PR entries with `touched_domains` + a mandatory `## Notes for future agents` section give a subagent starting on `apps/agency` cheap access to what changed in that area and why. `sync_actions` doubles as Draau's runbook when he pulls main and needs to know to `bun run seed` or add a new env var.

Two contracts to internalize before touching this again:

- **Drafter is deliberately dumb.** `scripts/changelog/draft.ts` writes frontmatter + a one-line `## What changed` mechanically. It never pools raw commit bodies into the entry — commits are on the PR, so re-embedding them just duplicates a story the reader already has. `## Notes for future agents` is populated by extracting a `## Notes for future agents` (or `## Notes` / `## Rationale` / `## Why`) section from the PR body. If no such section exists, the drafter emits a TBD prompt — do not paper over it with commit-body dumping.
- **SYNC_ACTION_ORDER is triplicated by design.** `types.ts`, `sync-notice.mjs`, and `.claude/hooks/changelog-sync-notice.js` each declare it (one TS, one ES-module, one CommonJS hook — the three can't share a module without a build step). The alignment test in `validate.test.ts` is the guard. Do not drop that test when refactoring; the drift produces silent ordering bugs across surfaces.
