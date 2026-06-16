#!/usr/bin/env bash
# Runs all pending Convex data migrations after `convex deploy`, so every deploy
# backfills data in place — no wipe/reseed, and the migration self-applies on
# whichever deployment the build's CONVEX_DEPLOY_KEY targets (prod or preview).
# Chained in each app's vercel.json after the deploy step.
#
# A failed migration FAILS the build on purpose: the freshly deployed code may
# depend on the migrated data shape, so shipping a half-migrated deployment is
# worse than failing loudly.
#
# `migrations:runAll` is anchored by a no-op sentinel (convex/migrations.ts), so
# it is always a valid, idempotent runner — completed migrations are skipped, an
# empty migration set is a clean no-op.
set -euo pipefail

echo "run-migrations: applying pending Convex migrations…"
bunx convex run migrations:runAll
echo "✓ run-migrations: migrations up to date."
