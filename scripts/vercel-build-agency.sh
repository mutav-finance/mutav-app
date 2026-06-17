#!/usr/bin/env bash
# Vercel build entrypoint for the agency app. Lives in a script (not inline in
# apps/agency/vercel.json) because the full chain exceeds Vercel's 256-char
# `buildCommand` limit. Order:
#   1. guard that CONVEX_DEPLOY_KEY matches VERCEL_ENV (no prod-key-in-preview)
#   2. deploy convex + build the Next app (the --cmd hook captures the
#      deployment URL into .convex-preview-url for the steps below)
#   3. run pending data migrations against the just-deployed deployment
#   4. seed the preview deployment (no-op outside VERCEL_ENV=preview)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

./scripts/verify-convex-deploy.sh
bunx convex deploy --cmd 'printf %s "$NEXT_PUBLIC_CONVEX_URL" > .convex-preview-url && cd apps/agency && bun run build'
./scripts/run-migrations.sh
./scripts/seed-preview.sh
