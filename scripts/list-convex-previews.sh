#!/usr/bin/env bash
# Lists Convex deployments for the configured team, sorted by creation date.
# Read-only — calls the Convex Management API.
#
# Usage:
#   CONVEX_MANAGEMENT_TOKEN=<token> ./scripts/list-convex-previews.sh
#
# Get the token from: https://dashboard.convex.dev/team/settings/access-tokens
# Drop it in .env.local (already gitignored); this script will source it.
#
# Why this exists: the Convex CLI doesn't expose deployment listing across
# previews. We use this output to (a) inspect what's accumulating against
# the free-plan 40-deployment quota, and (b) confirm the preview naming
# convention before wiring up the cleanup-convex-preview GH workflow.

set -euo pipefail

# Source .env.local if present so the token doesn't need to be re-exported each run.
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

TOKEN="${CONVEX_MANAGEMENT_TOKEN:?CONVEX_MANAGEMENT_TOKEN not set — add it to .env.local}"
TEAM="${CONVEX_TEAM_SLUG:-jhoffmannburatto}"

# Resolve team slug → team id (the list endpoint takes the numeric id).
TEAM_ID=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.convex.dev/v1/teams" \
  | jq --arg slug "$TEAM" '.[] | select(.slug == $slug) | .id')

if [[ -z "$TEAM_ID" ]]; then
  echo "❌ Could not resolve team slug '$TEAM' — check CONVEX_TEAM_SLUG or token scope."
  exit 1
fi

curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.convex.dev/v1/teams/$TEAM_ID/list_deployments" \
  | jq -r '
    sort_by(.create_time) |
    (["NAME", "TYPE", "PROJECT", "CREATED", "PREVIEW_IDENTIFIER"] | @tsv),
    (.[] | [.name, .deployment_type, .project_id, .create_time, (.preview_identifier // "-")] | @tsv)
  ' \
  | column -t -s $'\t'

echo
echo "Total: $(curl -sf -H "Authorization: Bearer $TOKEN" "https://api.convex.dev/v1/teams/$TEAM_ID/list_deployments" | jq 'length') deployments (free-plan quota: 40)"
