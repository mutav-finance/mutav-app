---
branch: feat/guarantees-machine
category: feat
summary: "adds the pure guarantee state machine under convex/guarantees/ — the seven-state transition table with assertTransition, the seven close reasons with CLOSE_REASON_ALLOWED_FROM and assertClose composing on top of it, and the temporary toLegacyStatus mapper that projects a guarantee state (plus close reason) back onto the four legacy contract statuses so the PR2 facade can keep the agency UI rendering until PR4"
sync_actions: []
---
