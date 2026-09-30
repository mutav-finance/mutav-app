---
branch: feat/seed-delivery-video
category: feat
summary: "the demo seed now covers everything the InstaAwards delivery video shows: verified defaults across agencies, a pending cover batch awaiting payout next to an executed one, a dispute-reversal close that released its cover, an eviction, a staff dismissal and a staff dispute, a lease renewed with a second guarantee, and ~26 performing leases that hold the published default rate near 10%; the live book is dated back from the reseed so nothing looks months stale, the current month's invoices are never born overdue whatever day the reseed runs, and the seeded Pix key, boleto line and tenant CPFs (`000.000.1NN-XX`) are plainly fake"
sync_actions:
  - kind: seed
    detail: "reseed demo data: `bun run seed` — the demo book (notices, covers, invoices) is dated relative to the reseed, so reseed on or just before recording day"
---
