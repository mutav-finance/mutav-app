---
pr: unmerged
branch: feat/staff-activation
category: feat
summary: staff-only guarantee activation gated on a signed review and an approved signed contract, plus activation fee billed once on the next invoice and no R$0 invoices
sync_actions:
  - kind: env
    detail: "Optional: set RESEND_API_KEY in .env.local, then `bun run convex:env:sync` — the activation email is skipped without it"
  - kind: seed
    detail: "bun run seed — guarantees gained the activationFee marker and the by_agency_activationFeeStatus index; this branch also carries the guaranteeDocuments table from #375"
---
