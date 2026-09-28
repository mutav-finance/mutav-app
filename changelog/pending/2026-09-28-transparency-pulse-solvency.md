---
branch: feat/332-transparency-pulse-solvency
category: feat
summary: "the reserve read moves to the mutav-pulse testnet contracts (vault + policy + registry, simulation only) and the transparency page gains a coverage ratio, total guaranteed and verified-default exposure in BRL, remaining capacity (= free_capital) with a ceiling derived as stable assets / c, a per-position reserve breakdown with a Testnet badge and the contract ids as text; MAX_GUARANTEE_CAPACITY_CENTS is gone; the reserve and capacity panels move to @mutav/ui/transparency/* for reuse by admin /treasury; metric definitions in docs/transparency-metrics.md [#332]"
sync_actions:
  - kind: run
    detail: "populate the first pulse snapshot now instead of waiting up to 15 minutes for the cron: `bunx convex run reserve/actions:refreshReserveSnapshot`"
  - kind: manual
    detail: "MAX_GUARANTEE_CAPACITY_CENTS is no longer read — remove it from any Convex deployment that set it (`bunx convex env remove MAX_GUARANTEE_CAPACITY_CENTS`); a STELLAR_RESERVE_CONTRACT_ID pinned to the old reserve-vault-postpivot (CBDGKVRP…) must be unset or pointed at the pulse vault, and STELLAR_RESERVE_POLICY_CONTRACT_ID / STELLAR_RESERVE_REGISTRY_CONTRACT_ID are required on public"
---
