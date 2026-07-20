import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

/**
 * Migration policy (pre-production).
 *
 * While the app has no real data, we do NOT migrate in place — we **reseed**:
 * `bunx convex run seed:seedReset` wipes the demo tables and rebuilds the
 * dataset in the current schema shape (see `convex/seed.ts`). So schema changes
 * ship as wipe + reseed, not widen → backfill → narrow, and this runner stays a
 * safe no-op. `schemaValidation` is intentionally relaxed during this window so
 * a deploy tolerates whatever shape is at rest until the operator reseeds.
 *
 * **When the first real (non-seed) data lands**, flip the model: start writing
 * in-place migrations here (widen → migrate → narrow, two PRs — see
 * `.claude/notes/deferred-conventions.md`), append each `internal.migrations.<name>`
 * to `runAll` below, and re-enable strict `schemaValidation`. `run-migrations.sh`
 * already runs `migrations:runAll` after every `convex deploy`, so real
 * migrations take effect automatically from that point on.
 *
 * NOTE: the operational backfills (`contracts/backfill.ts` aggregate rebuild,
 * `waitlist` Resend audience sync, `reserve` snapshot clear) are NOT migrations —
 * they're on-demand tools and deliberately stay out of this runner.
 */
export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * No-op sentinel. The component's runner errors on an empty list, so this keeps
 * `runAll` valid and idempotent while there are no real migrations to run. It
 * scans `users` once per deployment, marks itself complete, then is skipped.
 */
export const noop = migrations.define({
  table: "users",
  migrateOne: () => {},
});

/**
 * Ordered runner, chained after `convex deploy` via `scripts/run-migrations.sh`.
 * Empty except for the no-op sentinel during the reseed-in-dev window — append
 * real migrations here once live data exists (see the policy note above).
 */
export const runAll = migrations.runner([internal.migrations.noop]);
