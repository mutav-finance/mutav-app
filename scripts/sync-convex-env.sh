#!/usr/bin/env bash
#
# Sync Convex *deployment* env vars from your local .env.local.
#
# Why this exists: a few vars must live on BOTH sides —
#   - .env.local          → read by Next.js (cookie sessions, browser bundle)
#   - the Convex deployment → read by convex/ functions at runtime, AND scanned
#                             by Convex's deploy-time analyzer (auth.config.ts)
# Forgetting the Convex side is the #1 first-setup wall: `convex dev` fails with
# "Environment variable AUTH0_DOMAIN is used in auth config file but not set"
# before your functions (or the seed) can run. Set the values once in
# .env.local, then run this to push them to the deployment.
#
# Usage:
#   bun run convex:env:sync                 # sync to the default dev deployment
#   bun run convex:env:sync -- --prod       # sync to prod (careful)
#
# Safe to re-run; only non-empty values are pushed.
set -euo pipefail

ENV_FILE=".env.local"
[ -f "$ENV_FILE" ] || { echo "✖ $ENV_FILE not found — copy .env.example first"; exit 1; }

# Deployment-side vars (the ones the analyzer / runtime need). Frontend-only
# secrets (AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL, NEXT_PUBLIC_*) stay
# in .env.local and are NOT pushed to the deployment.
VARS=(AUTH0_DOMAIN AUTH0_CLIENT_ID PII_ENCRYPTION_KEY PII_HMAC_KEY \
      ETHERFUSE_BASE_URL ETHERFUSE_API_KEY RESEND_API_KEY \
      MUTAV_STELLAR_SECRET_ENCRYPTION_KEY MUTAV_TREASURY_SECRET \
      STELLAR_MUTAV_SOURCE_ACCOUNT)

for var in "${VARS[@]}"; do
  # Read the value from .env.local without sourcing it (avoids executing the file).
  line="$(grep -E "^${var}=" "$ENV_FILE" | tail -1 || true)"
  val="${line#*=}"
  if [ -n "$val" ]; then
    bunx convex env set "$@" "$var" "$val" >/dev/null && echo "✓ synced $var"
  else
    echo "· skip $var (empty in $ENV_FILE)"
  fi
done

echo "Done. Missing values? Ask the team for the dev-tenant Auth0 client id, or"
echo "generate dev PII keys: openssl rand -base64 32 (set PII_* in .env.local, re-run)."
