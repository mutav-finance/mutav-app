---
branch: fix/bearer-token-lifecycle
category: fix
summary: "invoice bearer token gains expiry, revocation, rotation and per-token/per-IP rate limiting; the Pix and anchor-test onramps now authorize on the token instead of the invoice id"
sync_actions:
  - kind: seed
    detail: "`bun run seed` — invoices gained `accessTokenExpiresAt` / `accessTokenRevokedAt`, and a missing expiry reads as expired. Existing rows stop resolving in apps/pay until the reseed mints dated tokens."
---
