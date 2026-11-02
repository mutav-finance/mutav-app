---
pr: unmerged
branch: feat/staff-activation
category: feat
summary: phase-1 activation (issue #427) — a guarantee goes active when compliance approves the signed contract and the reserve capacity check passes; otherwise it waits in awaiting_capacity. Sending for signature runs the same preflight and holds cover × c; the activation fee is billed from active
sync_actions:
  - kind: env
    detail: "Optional: set RESEND_API_KEY in .env.local, then `bun run convex:env:sync` — the activation email is skipped without it"
  - kind: seed
    detail: "bun run seed — new reserveBalanceSnapshots, offerHolds (amountCents) and platformSettings (coverageRatioBps) tables, review status awaiting_capacity, guarantees.activationCheck, agencies and products gain offerHoldDays; the Aprovada book seeds one guarantee activated by its approval, one awaiting_capacity and a fresh reserve balance"
  - kind: manual
    detail: 'The seeded reserve balance is fresh for 30 minutes; after that sending and activation fail closed until the #428 reader runs or you call `bunx convex run reserve/balance:recordReserveBalance ''{"balanceCents": N, "takenAt": <unix ms>}''`'
---
