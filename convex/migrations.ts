import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * No-op sentinel kept at the head of `runAll`. The component's runner errors on
 * an empty list, so this guarantees `runAll` is always a valid, safe no-op —
 * letting the deploy-time migration step ship before any real migration exists.
 * It scans `users` once per deployment, marks itself complete, then is skipped
 * on every subsequent deploy.
 */
export const noop = migrations.define({
  table: "users",
  migrateOne: () => {},
});

/**
 * Ordered runner of all data migrations. Chained after `convex deploy` in every
 * app's `vercel.json` (`scripts/run-migrations.sh`), so each deploy backfills
 * data in place — no wipe/reseed, and every developer's own dev deployment
 * self-heals on `convex dev`. Completed migrations are skipped on re-run.
 *
 * Migration convention (widen → migrate → narrow, two PRs — see
 * `.claude/notes/deferred-conventions.md`): in the WIDEN PR set
 * `schemaValidation: false` (or add the new field as optional), define the
 * migration with `migrations.define({ table, migrateOne })`, and append its
 * `internal.migrations.<name>` here. In the NARROW PR re-enable strict
 * validation and drop the transitional fields.
 */
export const runAll = migrations.runner([internal.migrations.noop]);
