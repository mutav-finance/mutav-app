---
branch: fix/unauthenticated-read-surface
category: fix
summary: "invoice bearer token, tenant-visible bank projection, server-derived credit score"
sync_actions:
  - kind: seed
    detail: "`bun run seed` — invoices gained a required `accessToken`; existing rows have none and will not resolve in apps/pay"
---
