---
branch: feat/delinquency-drives-guarantee
category: feat
summary: "guarantee lifecycle write surface: `convex/guarantees/transitions.ts` owns the one guarded status change (assertTransition/assertClose -> patch -> aggregate rewrite -> `guaranteeHistory` row carrying both the human message and a structured `transition` twin -> `guarantee.transitioned` audit -> `leases.openGuaranteeId` upkeep) plus capacity policy C reserve/release (clamp to `min(available, amount)`, exact reversal, `available + reserved = ceiling` never drifts); `convex/guarantees/mutations.ts` adds `activate`, `closeEndOfLease`, `close(reason)`, `enterEviction` and `reprice`, and `cancelDraft` now composes the same helper; delinquency notices drive those transitions in the same transaction; new `guarantees.getStateTimelineByPeriod` replays `guaranteeHistory.transition` into a count per lifecycle state per period, transparency's `defaultRate` is computed as `(default_verified + cover_committed) / in-force`, and the seed emits the transition path behind every seeded guarantee; the agency dashboard and `/transparency` drop the separate state-breakdown card and the coarse activity chart for one unified card — stacked bands per lifecycle state over the period, with each state's current count in the legend"
sync_actions:
  - kind: seed
    detail: "seeded guarantees now carry structured transition history; run `bun run seed` for the state timeline to show a real path"
---
