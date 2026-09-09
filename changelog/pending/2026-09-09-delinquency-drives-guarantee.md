---
branch: feat/delinquency-drives-guarantee
category: feat
summary: "delinquency notices drive the guarantee lifecycle in one transaction through a single guarded transition helper that also reserves and reverses cover capacity, records structured history, computes the default rate and feeds one unified per-state chart card"
sync_actions:
  - kind: seed
    detail: "seeded guarantees now carry structured transition history; run `bun run seed` for the state timeline to show a real path"
---
