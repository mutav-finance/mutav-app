---
branch: feat/pii-classification-registry
category: feat
summary: "every personal-data field in convex/schema.ts now carries a version-controlled classification (tier, data class, subject, legal norm), gated by a vitest check that walks the runtime schema and fails on an unclassified field, a T0 entry, or a table in neither the personal-data nor the out-of-scope list"
sync_actions: []
---
