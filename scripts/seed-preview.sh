#!/usr/bin/env bash
# Auto-seeds the per-PR Convex preview deployment with the demo dataset
# (fictional agencies + Auth0 test personas) so reviewers see a populated
# dashboard and can log in as any persona. Runs after `convex deploy`
# finishes pushing functions (which is when seed:* exists on the
# deployment). The deployment URL is captured during the deploy's --cmd
# hook (where Convex injects NEXT_PUBLIC_CONVEX_URL) into
# .convex-preview-url, which this script reads.
#
# Hard-gated on VERCEL_ENV=preview:
#   - production builds: skipped (seed:seedReset is dev-only and wipes
#     tables before inserting)
#   - development / local: skipped (you seed locally with `bunx convex run
#     seed:seedReset` against your dev deployment)
#
# seedReset is idempotent — it wipes agencies/users/contracts/payments
# and re-inserts a deterministic ~30-contract fixture plus the four Auth0
# personas. Every new commit on a PR re-seeds, so previews stay
# reproducible. Reviewer-added data gets wiped on the next push; that's
# the tradeoff.
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

echo "seed-preview: VERCEL_ENV=preview, deployment=${DEPLOY_NAME} — running seed:seedReset"
bunx convex run --deployment "${DEPLOY_NAME}" seed:seedReset
echo "✓ seed-preview: preview deployment populated"

# All config lives in Vercel Project Environment Variables (preview
# scope) and gets propagated to the per-PR convex deployment here.
# Nothing about Mutav is baked into this script anymore — keeping
# values out of the repo means a future regression that runs this
# script with VERCEL_ENV=production can't accidentally reuse a baked-in
# testnet value against a real account.
#
# Required Vercel env vars (preview scope):
#   MUTAV_TREASURY_SECRET                  S...   testnet treasury seed
#   STELLAR_MUTAV_SOURCE_ACCOUNT           G...   testnet treasury account
#   MUTAV_STELLAR_SECRET_ENCRYPTION_KEY    base64 AES-256 key for per-agency proxy secrets
#   ETHERFUSE_API_KEY                      api_sand:...  sandbox API key
#   ETHERFUSE_BASE_URL                     https://api.sand.etherfuse.com (or a different sandbox/mock URL)
#
# A missing var doesn't fail the build — the affected feature throws
# loudly at runtime instead (or, for ETHERFUSE_BASE_URL, falls back to
# the sandbox URL hardcoded in convex/lib/env.ts). Re-deploy after
# adding it in Vercel.

set_from_env() {
  local name="$1"
  local hint="$2"
  if [ -n "${!name:-}" ]; then
    bunx convex env set "$name" "${!name}" --deployment "${DEPLOY_NAME}" >/dev/null
    echo "✓ seed-preview: $name configured"
  else
    echo "⚠ seed-preview: $name not in build env — add to Vercel Project Settings (preview scope). $hint" >&2
  fi
}

set_from_env MUTAV_TREASURY_SECRET "Stellar sponsorship will fail at runtime without it."
set_from_env STELLAR_MUTAV_SOURCE_ACCOUNT "Falls back to a hardcoded dev value in convex/lib/env.ts when missing — set this in Vercel to override per-environment."
set_from_env MUTAV_STELLAR_SECRET_ENCRYPTION_KEY "Per-agency etherfuse provisioning will fail at runtime without it."
set_from_env ETHERFUSE_API_KEY "Etherfuse on-ramp actions will fail at runtime without it."
set_from_env ETHERFUSE_BASE_URL "Falls back to https://api.sand.etherfuse.com via convex/lib/env.ts default."
