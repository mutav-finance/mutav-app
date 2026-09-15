---
branch: refactor/guarantee-aggregate-names
category: refactor
summary: "the three aggregate component instances are renamed from contractsByStatus / contractsByStatusPlatform / ativoInsuredCentsPlatform to guaranteesByState / guaranteesByStatePlatform / insuredCentsPlatform — a rename mounts fresh, empty instances, so counts read zero until they are rebuilt"
sync_actions:
  - kind: run
    detail: "rebuild the renamed aggregates after the deploy: `bunx convex run guarantees/backfill:backfillPlatformAggregates` (repeat until `done: true`), or simply `bun run seed` — the reseed writes through. Previews reseed on their own."
  - kind: manual
    detail: "the old instances `contractsByStatus`, `contractsByStatusPlatform`, `ativoInsuredCentsPlatform` are unmounted, not deleted — remove them from the Convex dashboard (Components) once the rebuild is confirmed"
---
