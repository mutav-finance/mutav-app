#!/usr/bin/env bash
# Auto-seeds the per-PR Convex preview deployment with fictional data so
# reviewers see a populated dashboard instead of an empty one. Runs after
# `convex deploy` finishes pushing functions (which is when seed:* exists
# on the deployment). The deployment URL is captured during the deploy's
# --cmd hook (where Convex injects NEXT_PUBLIC_CONVEX_URL) into
# .convex-preview-url, which this script reads.
#
# Hard-gated on VERCEL_ENV=preview:
#   - production builds: skipped (seed:fictionalContracts is dev-only and
#     wipes tables before inserting)
#   - development / local: skipped (you seed locally with `bunx convex run
#     seed:fictionalContracts` against your dev deployment)
#
# fictionalContracts is idempotent — it clears agencies/users/contracts/
# payments/etc. and re-inserts a deterministic 30-contract fixture. Every
# new commit on a PR re-seeds, so previews stay reproducible. Reviewer-
# added data gets wiped on the next push; that's the tradeoff.
#
# The verify-convex-deploy.sh script (run earlier in the chain) already
# enforces that VERCEL_ENV=production pairs with a prod CONVEX_DEPLOY_KEY,
# so a prod build can never reach this script with VERCEL_ENV=preview.

set -euo pipefail

ENV="${VERCEL_ENV:?VERCEL_ENV not set — seed-preview.sh is meant to run inside a Vercel build}"

if [ "$ENV" != "preview" ]; then
  echo "seed-preview: VERCEL_ENV=${ENV} — skipping (preview-only)"
  exit 0
fi

# NEXT_PUBLIC_CONVEX_URL is only injected by Convex CLI during the
# `--cmd` subprocess. By the time we run here (after `convex deploy`
# exits, functions pushed), it's gone — so the deploy's --cmd hook
# writes it to .convex-preview-url for us.
: "${CONVEX_DEPLOY_KEY:?CONVEX_DEPLOY_KEY not set — required to authenticate against the preview deployment}"

URL_FILE=".convex-preview-url"
if [ ! -s "$URL_FILE" ]; then
  echo "seed-preview: ${URL_FILE} missing or empty — vercel.json should populate it inside convex deploy --cmd" >&2
  exit 1
fi

CONVEX_URL="$(cat "$URL_FILE")"
HOST="${CONVEX_URL#https://}"
HOST="${HOST#http://}"
DEPLOY_NAME="${HOST%%.*}"

echo "seed-preview: VERCEL_ENV=preview, deployment=${DEPLOY_NAME} — running seed:fictionalContracts"
bunx convex run --deployment "${DEPLOY_NAME}" seed:fictionalContracts
echo "✓ seed-preview: preview deployment populated"
