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

# Apply the disposable testnet treasury keypair to the preview's Convex env
# so anchor on-ramp actions (SEP-10 signer) work out of the box. The keypair
# is published in the repo by design (src/lib/stellar/testnet-wallet.md —
# testnet-only, anyone watching the repo controls the account) so embedding
# the secret here is intentional, not a leak. Set is idempotent — re-running
# on every preview build is fine.
PREVIEW_TREASURY_SECRET="SBDW2AG65ZSTXYTVIAGJGU7VOKBBQNNVN4KHCL5XAT65USJKYCQ72FW6"
PREVIEW_TREASURY_ACCOUNT="GD7ZCGE3Z2KV7STAWXLTKZQP7IYZ2SSJ6VNOQ2CHK4YWRSLIYUECMNWV"

echo "seed-preview: setting MUTAV_TREASURY_SECRET + STELLAR_MUTAV_SOURCE_ACCOUNT on ${DEPLOY_NAME}"
bunx convex env set MUTAV_TREASURY_SECRET "$PREVIEW_TREASURY_SECRET" \
  --deployment "${DEPLOY_NAME}" >/dev/null
bunx convex env set STELLAR_MUTAV_SOURCE_ACCOUNT "$PREVIEW_TREASURY_ACCOUNT" \
  --deployment "${DEPLOY_NAME}" >/dev/null
echo "✓ seed-preview: anchor signer env vars configured"
