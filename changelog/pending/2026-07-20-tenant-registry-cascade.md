---
pr: 252
branch: feat/tenant-registry-cascade
category: feat
summary: "Tenant registry — full cascade (combined for testing) [#60, #62, #227]"
sync_actions:
  - kind: env
    detail: "Review env changes in convex/lib/env.ts, then `bun run convex:env:sync`"
  - kind: seed
    detail: "bun run seed"
---
