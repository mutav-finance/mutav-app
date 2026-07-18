---
pr: 253
branch: feat/agentic-changelog-harness
category: feat
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
