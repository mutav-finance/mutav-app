#!/usr/bin/env bash
#
# Generate and install the production key set before the first real agency.
# See docs/launch-runbook.md for where this sits in the launch order.
#
#   scripts/launch-secrets.sh generate            # write fresh keys to a 0600 file outside the repo
#   scripts/launch-secrets.sh apply <file> --prod # push them to the prod Convex deployment
#
# What it generates (32 random bytes, base64 — the format convex/lib/env.ts expects):
#   PII_ENCRYPTION_KEY, PII_HMAC_KEY, MUTAV_STELLAR_SECRET_ENCRYPTION_KEY
# Third-party credentials (Auth0, Resend, bureau, Etherfuse) are issued by those
# vendors; the runbook lists them. This script never prints a key value.
#
# `apply` skips any variable the deployment already has, unless --rotate is
# passed. Rotating PII_ENCRYPTION_KEY makes every encrypted field unreadable and
# rotating PII_HMAC_KEY breaks every CPF/CNPJ lookup hash: only rotate those
# before real data exists, or with a re-encryption migration ready.
set -euo pipefail

GENERATED_VARS=(PII_ENCRYPTION_KEY PII_HMAC_KEY MUTAV_STELLAR_SECRET_ENCRYPTION_KEY)
OUT_DIR="${MUTAV_SECRETS_DIR:-$HOME/.mutav-launch}"

usage() {
  sed -n '3,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

generate() {
  umask 077
  mkdir -p "$OUT_DIR"
  local file
  file="$OUT_DIR/prod-secrets-$(date +%Y%m%d-%H%M%S).env"
  [ -e "$file" ] && { echo "✖ $file already exists" >&2; exit 1; }
  for var in "${GENERATED_VARS[@]}"; do
    printf '%s=%s\n' "$var" "$(openssl rand -base64 32)" >>"$file"
  done
  echo "✓ wrote ${#GENERATED_VARS[@]} keys to $file (mode 600)"
  echo "  Store a copy in the team password manager NOW: a lost PII key cannot be recovered."
  echo "  Then: scripts/launch-secrets.sh apply \"$file\" --prod"
}

apply() {
  local file="${1:-}"
  shift || true
  [ -f "$file" ] || { echo "✖ secrets file not found: $file" >&2; exit 1; }

  local rotate=false
  local convex_flags=()
  for arg in "$@"; do
    case "$arg" in
      --rotate) rotate=true ;;
      *) convex_flags+=("$arg") ;;
    esac
  done

  # Names only: cut drops every value before it reaches this shell's variables.
  local existing
  existing="$(bunx convex env list "${convex_flags[@]}" | cut -d= -f1)"

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local name="${line%%=*}"
    local value="${line#*=}"
    if grep -qx "$name" <<<"$existing" && [ "$rotate" = false ]; then
      echo "· $name already set — skipped (pass --rotate to replace)"
      continue
    fi
    bunx convex env set "${convex_flags[@]}" "$name" "$value" >/dev/null
    echo "✓ $name set"
  done <"$file"

  echo "Next: bunx convex run ${convex_flags[*]} launch/useCases:readiness"
}

case "${1:-}" in
  generate) generate ;;
  apply) shift; apply "$@" ;;
  *) usage ;;
esac
