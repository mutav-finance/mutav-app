---
branch: feat/331-cover-operations-ledger
category: feat
summary: "cover gets a ledger: a new `coverOperations` table (one row per guarantee per billing month, `recorded → executed`, optional shared `batchId`) replaces the free-form cover reference; `coverOperations.staffRecordCover` / `staffRecordCoverBatch` (all-or-nothing) supersede `delinquencies.staffMarkResolvedByCover`, `staffMarkCoverExecuted` confirms the off-chain payout with its payment reference, and admin `/defaults` gains row selection, a batch record-cover dialog and a payouts-awaiting-execution panel"
sync_actions:
  - kind: seed
    detail: "new `coverOperations` table and `resolution.coverOperationId` link; run `bun run seed` so the seeded covers get their ledger rows"
---
