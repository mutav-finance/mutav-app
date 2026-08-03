---
pr: unmerged
branch: fix/invoice-document-number
category: fix
summary: invoice document numbers stop embedding the agency's CNPJ/CPF last four digits and are unique by construction — per-agency prefix plus per-agency counter
sync_actions:
  - kind: migrate
    detail: "New `agencies.by_invoiceRef` index — `bunx convex deploy` (or `bun run dev`) to build it. No backfill: `invoiceRef` and `nextInvoiceSequence` are optional and are minted on an agency's first invoice."
---
