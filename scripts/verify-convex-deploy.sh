#!/usr/bin/env bash
# Fails the Vercel build if CONVEX_DEPLOY_KEY does not match VERCEL_ENV.
# Prevents the worst footgun in the Convex+Vercel setup: a prod deploy key
# accidentally pasted into the preview scope (or vice versa), which would
# cause a preview build to deploy schema changes / seed wipes to prod.
#
# Runs as the first step in `vercel.json`'s buildCommand. Exits 1 with a
# loud message on mismatch; success is silent except for the ✓ confirmation.
#
# Convex deploy-key format (as of 2026): "<kind>:<deployment-id>|<token>".
#   kind = "prod" for production keys, "preview" for preview keys.
# Vercel build env: VERCEL_ENV ∈ {"production","preview","development"}.

set -euo pipefail

KEY="${CONVEX_DEPLOY_KEY:?CONVEX_DEPLOY_KEY not set — required for Vercel build}"
ENV="${VERCEL_ENV:?VERCEL_ENV not set — this script is meant to run inside a Vercel build}"

KIND="${KEY%%:*}"

case "${ENV}:${KIND}" in
  production:prod)
    echo "✓ verify-convex-deploy: VERCEL_ENV=production × CONVEX_DEPLOY_KEY=prod:…"
    ;;
  preview:preview)
    echo "✓ verify-convex-deploy: VERCEL_ENV=preview × CONVEX_DEPLOY_KEY=preview:…"
    ;;
  development:dev|development:preview)
    # Local Vercel build (rare) — accept dev/preview keys, never prod.
    echo "✓ verify-convex-deploy: VERCEL_ENV=development × CONVEX_DEPLOY_KEY=${KIND}:…"
    ;;
  *)
    echo "❌ verify-convex-deploy: refusing to deploy — key/environment mismatch."
    echo "   VERCEL_ENV=${ENV}"
    echo "   CONVEX_DEPLOY_KEY starts with: ${KIND}:"
    echo "   Fix: rotate the key in Convex dashboard and re-add to the correct"
    echo "        Vercel scope (vercel env add CONVEX_DEPLOY_KEY ${ENV})."
    exit 1
    ;;
esac
