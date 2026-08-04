---
pr: unmerged
branch: fix/tenant-cross-agency-overwrite
category: fix
summary: shared tenant registry rows are never overwritten and each agency reads back its own submission (LGPD-26, LGPD-34)
sync_actions:
  - kind: migrate
    detail: "New contractHistory index by_agency_contract — `bunx convex deploy` (or `bun run dev`) to build it"
---
