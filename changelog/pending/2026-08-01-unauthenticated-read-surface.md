---
branch: fix/unauthenticated-read-surface
category: fix
summary: "invoice bearer token (share link and checkout chrome carry it correctly), tenant-visible bank projection, server-derived credit score"
sync_actions:
  - kind: seed
    detail: "`bun run seed` — invoices gained an optional `accessToken`. The deploy needs no ordering: existing rows keep resolving to nothing in apps/pay and show no share link until the reseed mints their tokens."
---
