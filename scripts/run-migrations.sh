#!/usr/bin/env bash
# Runs all pending Convex data migrations after `convex deploy`, so every deploy
# (prod AND preview) backfills data in place — no wipe/reseed. Chained in the
# agency app's vercel.json after the deploy step; convex is a single shared
# deployment, so running this once per build is enough.
#
# Targets the just-deployed deployment via `.convex-preview-url` — the same file
# seed-preview.sh uses, written by the `convex deploy --cmd` hook (where Convex
# injects NEXT_PUBLIC_CONVEX_URL). Unlike seed-preview.sh this is NOT gated on
# VERCEL_ENV: migrations must run in production too.
#
# A failed migration FAILS the build on purpose: the freshly deployed code may
# depend on the migrated data shape, so a half-migrated deployment is worse than
# failing loudly. `migrations:runAll` is anchored by a no-op sentinel
# (convex/migrations.ts), so it is always a valid, idempotent runner.
set -euo pipefail

: "${CONVEX_DEPLOY_KEY:?CONVEX_DEPLOY_KEY not set — required to run migrations against the deployment}"

URL_FILE=".convex-preview-url"
if [ ! -s "$URL_FILE" ]; then
  echo "run-migrations: ${URL_FILE} missing or empty — the convex deploy --cmd hook should have written it" >&2
  exit 1
fi

CONVEX_URL="$(cat "$URL_FILE")"
HOST="${CONVEX_URL#https://}"
HOST="${HOST#http://}"
DEPLOY_NAME="${HOST%%.*}"

echo "run-migrations: deployment=${DEPLOY_NAME} — running migrations:runAll"
bunx convex run --deployment "${DEPLOY_NAME}" migrations:runAll
echo "✓ run-migrations: migrations up to date."
