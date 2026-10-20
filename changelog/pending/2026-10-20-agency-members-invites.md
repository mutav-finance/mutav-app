---
pr: unmerged
branch: feat/agency-members-invites
category: feat
summary: agency members, roles and email invites managed in convex (members page, invite acceptance on welcome)
sync_actions:
  - kind: env
    detail: "Optional: set RESEND_API_KEY in .env.local, then `bun run convex:env:sync` (invite emails skip without it)"
  - kind: seed
    detail: "bun run seed"
---
