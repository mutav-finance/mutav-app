---
pr: unmerged
branch: fix/waitlist-email-out-of-action-args
category: fix
summary: waitlist delivery actions take a row id and resolve the address internally, so no signup email reaches the retained Convex argument log
sync_actions:
  - kind: manual
    detail: pre-fix scheduled-function records and function-log entries still hold plaintext waitlist addresses; they age out with Convex retention — ask security if a sooner purge is wanted
---
