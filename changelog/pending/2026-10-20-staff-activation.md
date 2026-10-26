---
pr: unmerged
branch: feat/staff-activation
category: feat
summary: activation is the confirmed on-chain registration (ADR 0010) — sending for signature runs a reserve preflight and holds cover × c, signed drafts wait in pending_registration, staff record the register_guarantee tx and the activation fee is billed from active
sync_actions:
  - kind: env
    detail: "Optional: set RESEND_API_KEY in .env.local, then `bun run convex:env:sync` — the activation email is skipped without it"
  - kind: seed
    detail: "bun run seed — new offerHolds and platformSettings tables, review status pending_registration, guarantees.registration / registrationRefusal, agencies and products gain offerHoldDays; the Aprovada book now seeds two pending registrations (one refused by the reserve)"
  - kind: manual
    detail: "Sending for signature and recording a registration fail closed (RESERVE_READER_UNAVAILABLE) until the real ReserveReader adapter replaces convex/reserve/reader.ts"
---
