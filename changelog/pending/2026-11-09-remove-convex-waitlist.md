---
branch: chore/remove-convex-waitlist
category: chore
summary: remove the Convex waitlist domain; the website's waitlist now lives in Resend
sync_actions:
  - kind: manual
    detail: "Before deploying: Convex dashboard, prod and dev, Data, waitlist table, clear all rows (internal test signups only), so the push can drop the table"
  - kind: env
    detail: "npx convex env remove RESEND_IMOBILIARIA_AUDIENCE_ID && npx convex env remove RESEND_INVESTIDOR_AUDIENCE_ID (repeat with --prod)"
---
