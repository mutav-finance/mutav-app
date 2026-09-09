---
branch: refactor/guarantees-schema-domain
category: refactor
summary: "contracts → leases + guarantees + products: the rental relationship moves to `leases`, the guarantee row carries the 7-state machine, a from-state-gated close reason and an immutable `terms` snapshot copied from a seeded default product; `contractHistory` / `contractDelinquencyNotices` renamed, aggregates re-bound, privacy registry rekeyed, seed reshaped; a temporary `api.contracts.useCases.*` facade keeps the agency app rendering until PR4"
sync_actions:
  - kind: seed
    detail: "schema reshaped: contracts → leases + guarantees + products; run `bun run seed`"
---
