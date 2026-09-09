---
branch: feat/delinquency-drives-guarantee
category: feat
summary: "guarantee lifecycle write surface: `convex/guarantees/transitions.ts` owns the one guarded status change (assertTransition/assertClose -> patch -> aggregate rewrite -> `guaranteeHistory` row carrying both the human message and a structured `transition` twin -> `guarantee.transitioned` audit -> `leases.openGuaranteeId` upkeep) plus capacity policy C reserve/release (clamp to `min(available, amount)`, exact reversal, `available + reserved = ceiling` never drifts); `convex/guarantees/mutations.ts` adds `activate`, `closeEndOfLease`, `close(reason)`, `enterEviction` and `reprice`, and `cancelDraft` now composes the same helper"
sync_actions: []
---
