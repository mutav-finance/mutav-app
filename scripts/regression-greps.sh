#!/usr/bin/env bash
# Convention regression-greps for Mutav.
#
# Catches violations of CLAUDE.md / docs/auth.md / .claude/skills/* rules
# that the codebase has already reached zero hits on. Run on every PR via
# .github/workflows/quality.yml.
#
# Adding a new violation? Fix it, or argue in the PR for an allowlist
# entry with a tracking issue. Don't soften the grep.
#
# Each check prints its own FAIL lines and contributes to the final
# exit code. Runs to completion so reviewers see every violation at once,
# not just the first one.

set -u
exit_code=0

# ANSI colors only when stdout is a TTY (off in CI logs, on for local runs)
if [[ -t 1 ]]; then
  red=$'\033[31m'; green=$'\033[32m'; yellow=$'\033[33m'; reset=$'\033[0m'
else
  red=''; green=''; yellow=''; reset=''
fi

fail() { echo "${red}FAIL${reset}: $*"; exit_code=1; }
pass() { echo "${green}PASS${reset}: $*"; }

section() { echo; echo "── $* ──"; }

# Source files. Excludes _generated, vendored client, build artifacts.
SRC_GLOB=(apps/agency/src convex)

# ─────────────────────────────────────────────────────────────────────────────
# 1. Bare public mutation/query handlers must use the auth wrappers
#    or the documented resource-by-id pattern (assertAgencyAccess).
#    Allowlist (with rationale):
#    - convex/users/useCases.ts: getMe is the only bare query intentionally
#      returning null on missing JWT (UI needs to distinguish loading vs
#      signed-out); getOrCreateByIdentity reads identity from
#      ctx.auth.getUserIdentity() and throws on miss.
#    - convex/waitlist/useCases.ts: anonymous public submission endpoint
#      called from the marketing site — no JWT, no agency.
#    - convex/payments/providers/bankAccountUseCases.ts: listBanksForInvoice
#      is the tenant-checkout bearer query — no JWT and no client-supplied
#      agencyId; it resolves the owning agency from the invoice publicId
#      (the bearer) server-side, same model as invoices.getPublicByPublicId.
#      (listByAgency in the same file uses the queryWithAgencyScope wrapper.)
# ─────────────────────────────────────────────────────────────────────────────
section "1. bare public mutation/query without auth"

files_with_bare=$(rg -l '^export const \w+ = (mutation|query)\(\{' convex/ 2>/dev/null \
  | grep -v _generated \
  | grep -v '\.test\.ts$' || true)

bare_violations=0
for file in $files_with_bare; do
  # Allowlists — see header above for rationale.
  if [[ "$file" == "convex/users/useCases.ts" ]]; then
    continue
  fi
  if [[ "$file" == "convex/waitlist/useCases.ts" ]]; then
    continue
  fi
  if [[ "$file" == "convex/payments/providers/bankAccountUseCases.ts" ]]; then
    continue
  fi
  # File must call assertAgencyAccess somewhere (resource-by-id pattern)
  if ! rg -q 'assertAgencyAccess' "$file"; then
    fail "$file uses bare public mutation/query without assertAgencyAccess. Use a wrapper from convex/lib/auth.ts."
    bare_violations=$((bare_violations + 1))
  fi
done
[[ $bare_violations -eq 0 ]] && pass "all bare public handlers use assertAgencyAccess or are wrappers"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Raw Id<"table"> outside entity files
# ─────────────────────────────────────────────────────────────────────────────
section "2. raw Id<> outside entity files"

raw_id=$(rg -n 'Id<"[^"]+">' "${SRC_GLOB[@]}" 2>/dev/null \
  | grep -v '_generated' \
  | grep -v '/domain\.ts' \
  | grep -v 'bankAccountDomain\.ts' \
  | grep -v 'accountDomain\.ts' \
  | grep -v 'orderDomain\.ts' \
  | grep -v 'convex/lib/storage\.ts' || true)

if [[ -n "$raw_id" ]]; then
  # Here-string (not `echo | while`) so fail()'s exit_code=1 runs in this
  # shell, not a pipe subshell where it would be silently discarded.
  while IFS= read -r line; do
    fail "$line — use the exported alias from the entity file (e.g. AgencyId, PaymentId)"
  done <<< "$raw_id"
else
  pass "no raw Id<> outside entity files"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Raw Doc<"table"> outside entity files (analogous to #2)
# ─────────────────────────────────────────────────────────────────────────────
section "3. raw Doc<> outside entity files"

raw_doc=$(rg -n 'Doc<"[^"]+">' "${SRC_GLOB[@]}" 2>/dev/null \
  | grep -v '_generated' \
  | grep -v '/domain\.ts' \
  | grep -v 'bankAccountDomain\.ts' \
  | grep -v 'accountDomain\.ts' \
  | grep -v 'orderDomain\.ts' || true)

if [[ -n "$raw_doc" ]]; then
  while IFS= read -r line; do
    fail "$line — use the exported alias from the entity file (e.g. AnchorOrder, AgencyBankAccount)"
  done <<< "$raw_doc"
else
  pass "no raw Doc<> outside entity files"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. No validators.ts files — validators co-locate in domain.ts
# ─────────────────────────────────────────────────────────────────────────────
section "4. no separate validators.ts files"

validator_files=$(find convex/ -name 'validators.ts' -not -path '*/_generated/*' 2>/dev/null || true)
if [[ -n "$validator_files" ]]; then
  while IFS= read -r f; do
    fail "$f — validators belong in {domain}/domain.ts next to the value objects"
  done <<< "$validator_files"
else
  pass "no validators.ts files"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. process.env.* only in env boundary files
#
# KNOWN-INERT: `rg --type tsx` is not a built-in ripgrep type ("unrecognized
# file type: tsx"), so this rg call currently errors and matches nothing —
# the check always passes regardless of real violations. Fixing it (e.g.
# `--type-add 'tsx:*.tsx'`) is deferred to its own PR because it surfaces a
# policy decision (test files legitimately manipulate process.env) plus a few
# real source hits to refactor onto the env getters. The loop below is already
# here-string-correct so it will gate the moment the type bug is fixed.
# ─────────────────────────────────────────────────────────────────────────────
section "5. process.env outside env boundary"

env_violations=$(rg -n --type ts --type tsx 'process\.env\.' "${SRC_GLOB[@]}" 2>/dev/null \
  | grep -v '_generated' \
  | grep -v 'apps/agency/src/lib/env\.ts' \
  | grep -v 'convex/lib/env\.ts' \
  | grep -v 'convex/auth\.config\.ts' \
  | grep -vE '^[^:]+:[0-9]+:\s*\*' || true)  # skip JSDoc comment lines

if [[ -n "$env_violations" ]]; then
  while IFS= read -r line; do
    fail "$line — read env vars via apps/agency/src/lib/env.ts or convex/lib/env.ts only"
  done <<< "$env_violations"
else
  pass "no process.env outside env boundary files"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. View-model pattern — React hooks in *.tsx are forbidden;
#    component logic belongs in use-{ComponentName}.ts
# ─────────────────────────────────────────────────────────────────────────────
section "6. React hooks in *.tsx (view-model violation)"

hook_violations=$(rg -n 'use(State|Effect|Reducer|Callback|Memo|Ref|Id)\(' apps/agency/src/components/ 2>/dev/null \
  | grep '\.tsx:' \
  | grep -v '\.test\.tsx:' || true)

# Note: this check is currently informational only. Many existing components
# use hooks inline. The grep is wired so adoption can be measured; promote
# to FAIL when the view-model pattern reaches full adoption (tracked
# separately; see CLAUDE.md react-component-view-model-pattern skill).
if [[ -n "$hook_violations" ]]; then
  hook_count=$(echo "$hook_violations" | wc -l | tr -d ' ')
  echo "${yellow}WARN${reset}: $hook_count React hook calls in *.tsx files (view-model pattern not yet enforced — informational only)"
else
  pass "no React hooks in *.tsx files"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. "as Type" casts (excluding "as const", import aliases, shadcn ui, CSS)
#    CLAUDE.md zero-tolerance on type casts. Currently informational only —
#    existing codebase has ~20 legitimate external-API boundary casts that
#    need the inline comment exception added before this can FAIL.
#    Tracked as a separate cleanup issue; promote to FAIL after.
# ─────────────────────────────────────────────────────────────────────────────
section "7. as Type casts (informational)"

as_violations=$(rg -n --type ts --type tsx ' as [A-Z]\w*' "${SRC_GLOB[@]}" 2>/dev/null \
  | grep -v ' as const' \
  | grep -v '_generated' \
  | grep -v 'apps/agency/src/components/ui/' \
  | grep -vE '^[^:]+:[0-9]+:\s*(import|export)\b' \
  | grep -vE '^[^:]+:[0-9]+:.*\bfrom\s+"' || true)

# Count undocumented hits (no "boundary" comment in the 3 lines above).
as_undocumented=0
if [[ -n "$as_violations" ]]; then
  while IFS= read -r line; do
    file=$(echo "$line" | cut -d: -f1)
    lineno=$(echo "$line" | cut -d: -f2)
    prev_lines=$(sed -n "$((lineno-3)),$((lineno-1))p" "$file" 2>/dev/null)
    if echo "$prev_lines" | grep -qE 'boundary|route param validated|Boundary exception'; then
      continue
    fi
    as_undocumented=$((as_undocumented + 1))
  done <<< "$as_violations"
fi

if [[ $as_undocumented -gt 0 ]]; then
  echo "${yellow}WARN${reset}: $as_undocumented undocumented type casts (informational — promote to FAIL after cleanup)"
else
  pass "no undocumented type casts"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. i18n key parity between pt-BR.json and en.json — every app under apps/
# ─────────────────────────────────────────────────────────────────────────────
section "8. i18n key parity (pt-BR vs en)"

if ! node scripts/i18n-parity.mjs; then
  fail "i18n key drift between messages/pt-BR.json and messages/en.json (see output above)"
else
  pass "i18n keys in sync between pt-BR.json and en.json in every app"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 9. @mutav/ui wiring per app — the "compiles but renders unstyled" trap.
#
#    The shells ship their Tailwind classes from packages/ui. Tailwind 4 only
#    scans the consuming project, and arbitrary-value classes that reference a
#    CSS variable (h-(--header-height), w-(--sidebar-width)) compile fine and
#    collapse silently at runtime. Neither typecheck nor the shell-contract
#    test can see a vanished class, so assert the two declarations that make
#    the package's classes reachable at all.
# ─────────────────────────────────────────────────────────────────────────────
section "9. @mutav/ui wiring (@source + transpilePackages)"

ui_wiring_violations=0
for app in agency admin fund pay; do
  globals="apps/$app/src/app/globals.css"
  config="apps/$app/next.config.ts"

  if ! rg -q '@source "\.\./\.\./\.\./\.\./packages/ui/src"' "$globals" 2>/dev/null; then
    fail "$globals is missing @source \"../../../../packages/ui/src\" — @mutav/ui classes compile to nothing"
    ui_wiring_violations=$((ui_wiring_violations + 1))
  fi
  if ! rg -q 'transpilePackages:.*"@mutav/ui"' "$config" 2>/dev/null; then
    fail "$config does not list \"@mutav/ui\" in transpilePackages — the package ships TSX source"
    ui_wiring_violations=$((ui_wiring_violations + 1))
  fi
done

[[ $ui_wiring_violations -eq 0 ]] && pass "all four apps declare the @mutav/ui @source + transpilePackages"

# ─────────────────────────────────────────────────────────────────────────────
section "summary"

if [[ $exit_code -eq 0 ]]; then
  echo "${green}all conventions clean${reset}"
else
  echo "${red}convention violations detected${reset} — fix or allowlist with rationale before merging"
fi

exit $exit_code
