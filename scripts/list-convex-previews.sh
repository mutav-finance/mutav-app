#!/usr/bin/env bash
# Lists Convex deployments for the team, grouped by project.
# Read-only — calls the Convex Management API.
#
# Usage:
#   CONVEX_MANAGEMENT_TOKEN=<token> ./scripts/list-convex-previews.sh
#
# Get the token from: https://dashboard.convex.dev/team/settings (Access Tokens).
# Drop it in .env.local (already gitignored); this script sources it.
#
# Why this exists: the Convex CLI doesn't expose deployment listing across
# previews. We use this output to inspect what's accumulating against the
# free-plan 40-deployment quota.

set -euo pipefail

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

TOKEN="${CONVEX_MANAGEMENT_TOKEN:?CONVEX_MANAGEMENT_TOKEN not set — add it to .env.local}"

# Discover team ID from the token itself (avoids hardcoding).
TEAM_ID=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.convex.dev/v1/token_details" \
  | jq -r '.teamId')

if [[ -z "$TEAM_ID" || "$TEAM_ID" == "null" ]]; then
  echo "❌ Could not resolve team ID from token — check CONVEX_MANAGEMENT_TOKEN scope."
  exit 1
fi

# Pull projects (for ID → name lookup) and deployments in parallel-ish.
PROJECTS_MAP=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.convex.dev/v1/teams/$TEAM_ID/list_projects" \
  | jq 'map({(.id|tostring): .name}) | add')

curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.convex.dev/v1/teams/$TEAM_ID/list_deployments" \
  | jq --argjson names "$PROJECTS_MAP" -r '
      .items
      | group_by(.projectId)
      | sort_by(-(.[0].createTime))
      | .[]
      | (
          "── \($names[(.[0].projectId|tostring)] // "?") (id \(.[0].projectId)) ─ \(length) deployment(s)",
          (.[] | "    \(.deploymentType)\t\(.name)\t\(if .previewIdentifier then "[" + .previewIdentifier + "]" else "" end)"),
          ""
        )
    ' | column -t -s $'\t'

TOTAL=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.convex.dev/v1/teams/$TEAM_ID/list_deployments" \
  | jq '.items | length')

echo "Total: $TOTAL deployments (free-plan quota: 40)"
