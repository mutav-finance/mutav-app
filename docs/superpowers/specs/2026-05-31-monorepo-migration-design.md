# Monorepo Migration — Turborepo + persona apps + shared Mutav API

**Status:** Approved design, ready for implementation plan
**Owners:** Workspace migration (#139); reconciliation reference (`mutav-stellar#57`); KMS-Action runbook (`mutav-stellar#41`)
**Last decision date:** 2026-05-31

## Purpose

Define how `mutav-app/` becomes a Turborepo monorepo with one persona app per audience plus the shared **Mutav API** (Convex backend), reconciling the `mutav-stellar#57` proposal against the catalogs already in [`docs/architecture/README.md`](../../architecture/README.md). The output of this spec is the contract the implementation plan will follow; it commits to scope, sequence, and trust posture, and explicitly defers anything that needs its own design effort.

## Mental model

| Concept | Realized as |
|---|---|
| Persona app | One Next.js app under `apps/<name>/`, deployed to its own subdomain, with its own Vercel project |
| Mutav API | A single shared Convex deployment at the repo root (`convex/`) consumed by every app |
| Shared UI / config / types | `packages/*` — populated only when a second app actually consumes the code (YAGNI) |
| Persona identity | Per-app, per-origin — Auth0 (agency / admin connections, administratively distinct) or wallet (fund) or none (tenant pay) |
| Trust boundary | An app's origin. Cookies are `Host-Only` so a session never crosses subdomains |

The persona apps are origin-isolated by design. Cookie scope, CSP, and per-app deploys all derive from that.

## Scope

This spec covers:

1. The Turborepo target shape (apps, packages, Convex placement)
2. The staged-PR migration sequence (8 PRs)
3. Convex domain reconciliation against `mutav-stellar#57`
4. `mutav-fund` fold-in checkpoints and the archive trigger
5. Env / secrets / cookie posture commitments
6. CI/CD and CODEOWNERS structure
7. Auth0 posture for the staff connection
8. Explicit out-of-scope list

It does **not** cover wallet-kit selection, marketing/docs apps, the admin shell A1–A6 surface, HW-wallet flow, KMS integration, or the 6 Convex Action implementations. Those are downstream and each gets its own spec.

## Section 1 — Target end-state shape

After all 8 migration PRs land:

```
mutav-app/                          # Turborepo root
├── apps/
│   ├── agency/                     # current Next.js, (app) only
│   │   └── src/app/[locale]/(app)/...
│   ├── pay/                        # extracted from (public) — origin-isolated for tenant trust + cookie scope
│   │   └── src/app/[locale]/pay/[publicId]/...
│   ├── fund/                       # hosts (investor) routes; wallet-as-identity
│   │   └── src/app/[locale]/(investor)/...
│   └── admin/                      # empty shell on its own origin from day 1
│       └── src/app/[locale]/(admin)/...
├── convex/                         # ONE shared Mutav API (load-bearing: audit log requires single writer)
├── packages/                       # empty after PR 1; populated on demand
├── messages/                       # i18n strings (per-app override allowed; see Section 5)
├── .github/CODEOWNERS              # per-app + per-package rules
├── turbo.json
└── package.json                    # workspaces: apps/*, packages/*
```

### Origin / trust / auth posture

| App | Origin | Auth | Cookie posture |
|---|---|---|---|
| `apps/agency/` | `app.mutav.finance` | Auth0 (agency connection) + agency membership | `Host-Only, SameSite=Strict, Secure, HttpOnly` |
| `apps/pay/` | `pay.mutav.finance` | None (`publicId` bearer in URL) | No session cookie; only short-lived `__Host-` CSRF token if forms appear |
| `apps/fund/` | `fund.mutav.finance` | Wallet-as-identity (per chain) | No Auth0 cookie; wallet session in `localStorage` scoped to origin |
| `apps/admin/` | `admin.mutav.finance` | Auth0 (separate `mutavStaff` connection, mandatory MFA) | `Host-Only, SameSite=Strict, Secure, HttpOnly`; shorter session lifetime |

### Load-bearing constraints

These are the architectural rules the implementation plan must preserve:

- **Convex is single.** The hash-chained audit log + Merkle anchor (per [`reliability.md` § Audit log integrity](../../architecture/reliability.md)) requires a single writer. Per-app backends are explicitly rejected. If Convex has an incident, all four apps degrade together — that is the acknowledged trade-off.
- **All cookies are `Host-Only`** (no `Domain=.mutav.finance`). A staff cookie on `admin.mutav.finance` cannot be sent to `agency`, `fund`, or `pay`. This forecloses cookie-scoping attacks and forces explicit cross-origin auth handoff if it's ever needed.
- **`mutavStaff` Auth0 connection is administratively distinct** from the agency-staff connection, with mandatory MFA enforced at the Auth0 rule level. Escalation path documented (Section 7): separate Auth0 tenant if BACEN/CVM diligence requires it.
- **`apps/pay/` carries no Auth0 SDK code.** The dependency stays scoped to apps that actually use it. Defends against phishing UI and limits the blast radius of a future Auth0 vulnerability.

### Subdomain mapping

| App | Hostname (committed) |
|---|---|
| `apps/agency/` | `app.mutav.finance` (current; preserved) |
| `apps/pay/` | `pay.mutav.finance` (new) |
| `apps/fund/` | `fund.mutav.finance` (new) |
| `apps/admin/` | `admin.mutav.finance` (new) |

DNS registrar / CNAME work is downstream of this spec and tracked in the implementation plan.

## Section 2 — Migration sequence

Eight PRs, in order. Each PR leaves `main` deployable and independently revertable. The first 7 PRs are code moves and scaffolding; PR 8 is CI plumbing.

### PR 1 — Workspace foundation

- Add `turbo.json`, root `package.json` workspaces config (`apps/*`, `packages/*`), root `tsconfig.base.json`.
- Create empty `apps/` and `packages/` directories.
- Add `.github/CODEOWNERS` with the per-app structure (Section 6).
- Existing Next.js code stays at the repo root.

**Net diff:** workspace plumbing only. No code moved.

### PR 2 — `apps/agency/` from the existing app

- Move `src/`, `next.config.ts`, `messages/`, `public/`, `vercel.json`, `eslint.config.mjs`, `postcss.config.mjs`, `tsconfig.json`, `components.json`, `vitest.config.ts`, etc. into `apps/agency/`.
- `convex/` stays at the repo root.
- Update `apps/agency/tsconfig.json` to extend the root `tsconfig.base.json` and to reference the root-level `convex/` via a path alias so `@/convex/_generated/api` keeps resolving.
- Re-root the Vercel project at `apps/agency` (Vercel project settings change, no DNS change).
- Tenant pay routes (`(public)/pay/*`) come along inside `apps/agency/` for now — extracted in PR 3.

**Net diff:** ~all source files relocated. Cognitive load low because changes are mechanical. Run the full test suite + Next.js build before merging.

### PR 3 — Extract `apps/pay/`

- New Next.js app at `apps/pay/`. Minimal `package.json`, its own `tsconfig.json` extending the root base, its own `vercel.json`.
- Move `(public)/pay/[publicId]/*` and any pay-only components/lib out of `apps/agency/` into `apps/pay/`.
- Reuses `convex/_generated/api` via the same root path alias.
- New Vercel project, hostname `pay.mutav.finance`.
- `apps/agency/` loses the `(public)` route group entirely.
- `apps/pay/` ships with **no Auth0 SDK** in its dependency list (load-bearing constraint).

**Net diff:** route group moved + new Vercel project + DNS record provisioned (downstream).

### PR 4 — Scaffold empty `apps/fund/`

- New Next.js app at `apps/fund/`. Same boilerplate as `apps/pay/`.
- Empty `(investor)` route group shell — just a placeholder landing route gated on a stub wallet-identity check (matches the existing `(investor)` posture in `apps/agency/`).
- No wallet kit installed (blocked on the wallet-kit selection spec).
- New Vercel project, hostname `fund.mutav.finance`.

**Net diff:** new app exists with placeholder routes; not yet a real surface.

### PR 5 — Move `(investor)` from `apps/agency/` into `apps/fund/`

- Move all `(investor)` routes, components, and lib code wholesale.
- Anything that gets duplicated across `apps/agency/` and `apps/fund/` (some `@/components/ui/*` primitives, theme tokens, i18n routing config) stays duplicated in this PR — extraction is PR 6.
- `apps/agency/` loses the `(investor)` route group.

**Net diff:** route group moved between apps; some duplication intentional and temporary.

### PR 6 — First packages extraction (on demand)

- Extract only the components/configs that PR 5 surfaced as duplicated between `apps/agency/` and `apps/fund/`. Likely candidates:
  - `packages/ui/` — shadcn primitives that both apps use
  - `packages/i18n/` — next-intl `routing`, `navigation`, `request` config (the wrappers under `@/i18n/`)
  - `packages/tsconfig/` — `base.json`, `nextjs.json` shared by apps
  - `packages/eslint-config/` — flat-config preset
- No speculative packages. Anything only one app uses stays in that app.
- Imports in `apps/agency/` and `apps/fund/` rewritten to `@mutav/ui`, `@mutav/i18n`, etc.

**Net diff:** real packages with real consumers; import-path rewrites in two apps.

### PR 7 — Scaffold empty `apps/admin/`

- New Next.js app at `apps/admin/`. Same boilerplate as `apps/fund/`.
- Empty `(admin)` shell, gated on a stub `mutavStaff` check.
- Auth0 SDK wired against the separate `mutavStaff` connection (Section 7) — the connection is provisioned in Auth0 manually before this PR merges.
- No routes beyond a placeholder `/`. A1–A6 work and the HW-wallet flow each get their own milestones.
- New Vercel project, hostname `admin.mutav.finance`.

**Net diff:** new app exists, auth gate works, no real surface yet.

### PR 8 — `turbo-ignore` CI + per-app deploy gating

- Each Vercel project gets an Ignored Build Step that invokes `npx turbo-ignore @mutav/<app>`. Only the affected app deploys on a given commit.
- GitHub Actions `test` workflow uses `turbo run test --filter=...[origin/main]` so only changed apps run tests. `convex/` changes run all app tests.
- Cleanup of any temporary CI shims from PRs 2–7.

**Net diff:** CI plumbing; no app code change.

### Sequencing summary

| PR | Purpose | LOC est. | Reverts cleanly |
|---|---|---|---|
| 1 | Workspace foundation | ~150 | Yes |
| 2 | `apps/agency/` move | ~2k (mostly file relocations) | Yes |
| 3 | Extract `apps/pay/` | ~400 | Yes |
| 4 | Scaffold `apps/fund/` | ~250 | Yes |
| 5 | Move `(investor)` | ~600 | Yes |
| 6 | Packages extraction | ~500 | Yes |
| 7 | Scaffold `apps/admin/` | ~300 | Yes |
| 8 | CI gating | ~100 | Yes |

## Section 3 — Convex domain reconciliation

The existing [Domain catalog](../../architecture/README.md#domain-catalog) wins, in full. The `#57` sketch is not adopted and not aliased.

| `#57`'s name | Disposition | Where the concept lives today |
|---|---|---|
| `agencies` | Carries over (same name, same scope) | `convex/agencies/` (shipped) |
| `investments` | **Rejected.** Concept is split across multiple existing domains | `fundState` (per-chain mirror), `nav` (proposals + safeguards), `contracts` (rental contracts), `mutavStaff` (treasury sub-role) |
| `fundMgmt` | **Rejected.** Same reason | Same split as above |
| `payments` | Carries over | `convex/payments/` (shipped) |
| `compliance` | Carries over (already planned) | `convex/compliance/` (planned) |

The migration plan lands a one-paragraph cross-reference in [`docs/architecture/README.md` § Domain catalog](../../architecture/README.md#domain-catalog) explaining the mapping for future readers of `#57`. No code-level aliases; no rename of any existing domain.

## Section 4 — `mutav-fund` fold-in checkpoints

`mutav-fund` is a separate repo today. Its content folds into `apps/fund/` across three checkpoints; archive happens only when all three are complete.

| Checkpoint | When | Trigger |
|---|---|---|
| 1. `apps/fund/` exists with `(investor)` routes | After PR 5 of this spec lands | Mechanical |
| 2. Wallet kit is selected and ported | After a separate wallet-kit selection spec resolves AND its implementation PR lands in `apps/fund/` | Spec-gated |
| 3. Feature parity with current `mutav-fund` deployment | After a parity audit confirms `apps/fund/` covers every flow the live `mutav-fund/` portal serves today | Audit-gated |

**Archive trigger** for `mutav-fund` = all three checkpoints complete. Until then, `mutav-fund` stays soft-deprecated per the existing banner. The repo does not archive prematurely; we have no rollback if `apps/fund/` lags.

`mutav-fund` will receive only critical fixes during the fold-in window — no new features.

## Section 5 — Env / secrets / cookie posture

### Vercel environment strategy

Vercel Team Environment Variables for v1. Three classes:

| Class | Examples | Scope |
|---|---|---|
| Shared across all apps | `NEXT_PUBLIC_CONVEX_URL`, Stellar RPC URLs | Team env var, available to every project |
| Per-app | Auth0 client ID/secret (agency), Auth0 client ID/secret (admin), wallet kit env (fund) | Project env var, never shared |
| Build-only | `CONVEX_DEPLOY_KEY` | Lives only in the env of the app that runs the Convex CLI (`apps/agency/` by convention) |

`process.env` access still goes through `convex/lib/env.ts` (Convex side) and `<app>/src/lib/env.ts` (client side) per existing convention. Those two file roles now live as: `convex/lib/env.ts` at the repo root; one `src/lib/env.ts` per app.

### Cookie posture (mandatory)

All session cookies set by any persona app:

- `Host-Only` (no `Domain=` attribute, so the cookie is scoped to the exact origin and never sent to sibling subdomains)
- `SameSite=Strict`
- `Secure`
- `HttpOnly`

`apps/admin/` cookies additionally use a shorter session lifetime (target: 12h max, idle timeout 30 min). Specific value tuned in the admin spec.

The plan documents this as a code-review checklist item: any new Auth0 SDK config, any new server-set cookie, any next-auth-style helper must conform.

### External secrets manager — deferred

The plan documents an explicit trigger for migrating to an external secrets manager (Doppler / Infisical / AWS Secrets Manager via OIDC). Trigger = whichever happens first of:

1. BACEN / CVM diligence requires it
2. The KMS-Action work in [`mutav-stellar#41`](https://github.com/mutav-finance/mutav-stellar/issues/41) lands and needs OIDC-based secret rotation

Until then, Vercel Team Env Variables are the source of truth.

## Section 6 — CI/CD + CODEOWNERS

### Per-app deploy gating

Each Vercel project has an Ignored Build Step:

```sh
npx turbo-ignore @mutav/<app>
```

This skips the deploy when nothing in the app's dependency graph changed. Combined with per-project hostnames, a PR that touches only `apps/agency/` does not redeploy `fund` or `admin`.

### Per-app test gating

In GitHub Actions:

```sh
turbo run test --filter=...[origin/main]
```

The `...[origin/main]` filter resolves to "changed apps since main." `convex/` is a dependency of every app, so a `convex/` change runs every app's tests — intended.

### Turborepo remote cache

Vercel's built-in Turborepo cache (free with Vercel deploy). No additional infra to set up.

### CODEOWNERS structure (lands in PR 1)

```
/apps/agency/         @<agency-team>
/apps/pay/            @<agency-team>
/apps/fund/           @<fund-team>
/apps/admin/          @<admin-team>
/convex/              @<api-team>
/packages/ui/         @<design-system>
/packages/*           @<api-team>
/.github/             @<api-team>
/CODEOWNERS           @<api-team>
/docs/                @<api-team>
```

Team handles are placeholders; the structure is what's committed. Picking actual GitHub team handles is tracked in Section 10.

## Section 7 — Auth0 posture (staff vs customer identity)

### Separate connections, same Auth0 tenant — v1 baseline

- **Agency staff** authenticate through the existing Auth0 connection (Username-Password-Authentication + google-oauth2) consumed by `apps/agency/`.
- **`mutavStaff`** authenticate through a **separate Auth0 connection** consumed only by `apps/admin/`. This connection:
  - Requires MFA at the Auth0 rule level (no opt-out)
  - Has IP allowlist gating (corporate egress or VPN)
  - Has a shorter session lifetime (Section 5)
  - Disables self-signup; `mutavStaff` users are provisioned manually
- Both connections live in the same Auth0 tenant, so existing dev/staging/prod tenant separation is preserved.

### Escalation trigger — tenant separation

If BACEN / CVM diligence requires administratively distinct identity providers, the `mutavStaff` connection migrates to its own Auth0 tenant. Trigger documented but not executed in v1.

### Auth0 callbacks per origin

Each Vercel project (each origin) registers its own Auth0 callback URLs. The plan commits to the per-origin pattern; the actual callback URL list is implementation detail.

## Section 8 — Out of scope

Called out explicitly so absence is not mistaken for an oversight:

- **Wallet-kit selection** — its own spec; blocks `apps/fund/` real-investor flows
- **`apps/marketing/`** — its own milestone (CMS choice, content sourcing)
- **`apps/docs/`** — its own milestone (Nextra vs Mintlify vs in-Next)
- **`apps/admin/` A1–A6 surface** — its own milestone (per [`admin.md`](../../architecture/admin.md))
- **HW-wallet flow inside `apps/admin/`** — depends on `apps/admin/` scaffold landing first; tracked separately
- **6 Convex Action implementations** (mutav-app#141–#146) — separate issues, picked up after this plan + the KMS-Action runbook (`mutav-stellar#41`) both land
- **KMS-Action runbook** — [`mutav-stellar#41`](https://github.com/mutav-finance/mutav-stellar/issues/41)
- **DNS provisioning** — downstream ops; the plan commits subdomain mapping, not registrar/CNAME steps
- **Convex US-hosted vs LGPD residency** — already in [`regulatory.md`](../../architecture/regulatory.md); no change from the migration
- **Branch-protection bypass cleanup** — non-institutional pattern noted; deferred to a separate cleanup follow-up
- **External secrets manager** — deferred per Section 5

## Section 9 — Decision log

Key decisions, with the rationale anchored to existing docs:

1. **Per-app subdomains** for the four persona apps. Origin isolation is the institutional default for fintech / RWA / custody platforms (Stripe, Anchorage, BitGo, every DeFi interface). Route-group split rejected.
2. **Tenant pay extracted to `apps/pay/` on its own origin.** Cookie scope (Auth0 cookie isolation), phishing posture (`pay.` reads cleanly to tenants), and BACEN 4.658 cyber-resilience floor all point the same way. The existing README anticipates the same pattern for `admin` ("future migration to `admin.mutav.app` is documented as a security-driven trigger"); the same logic generalizes.
3. **`mutavStaff` Auth0 connection administratively distinct** from agency staff. Mandatory MFA + IP allowlist; tenant separation as escalation. Matches Stripe / Anchorage staff IdP separation.
4. **Convex stays at the repo root, single deployment.** Load-bearing: the hash-chained audit log + Merkle anchor (per [`reliability.md` § Audit log integrity](../../architecture/reliability.md)) requires a single writer. Multi-Convex setups don't exist as a product.
5. **Workspace-first, packages-on-demand** migration strategy (Section 2). YAGNI on package boundaries — extract only when there's a real second consumer. Avoids speculative package design that doesn't survive contact with real apps.
6. **Existing Convex domain catalog wins.** `#57`'s `investments` / `fundMgmt` are conceptually split across `fundState` / `nav` / `contracts` / `mutavStaff`. No renames; one paragraph of cross-reference added.
7. **`mutav-fund` archive gated on three checkpoints** (Section 4) — including wallet-kit spec resolution and feature-parity audit. No premature archive.
8. **Host-Only cookies, no `Domain=.mutav.finance` ever.** Forecloses cross-subdomain cookie leakage.
9. **Vercel Team Env Variables for v1**, with a documented trigger for migration to an external secrets manager (Section 5).
10. **Per-app CI test + deploy gating** via `turbo-ignore` and `turbo --filter`. Per-app CODEOWNERS landing in PR 1.

## Section 10 — Open follow-ups

Each of these is a downstream spec or issue, tracked here so the migration plan reader has a single index:

| Item | Owner | Status |
|---|---|---|
| Wallet-kit selection | TBD | Blocked on this spec; needs CVE audit, smart-account-vs-hot-wallet posture |
| `apps/marketing/` scoping | TBD | Net-new app; CMS choice + content sourcing |
| `apps/docs/` scoping | TBD | Net-new app; Nextra vs Mintlify decision |
| `apps/admin/` A1–A6 build-out | Per [`admin.md`](../../architecture/admin.md) | Blocked on PR 7 of this spec |
| HW-wallet flow in `apps/admin/` | TBD | Blocked on PR 7 of this spec |
| Convex Action implementations (#141–#146) | API team | Blocked on this spec + `mutav-stellar#41` |
| KMS-Action runbook | mutav-stellar#41 | In flight |
| External secrets manager migration | TBD | Trigger: BACEN/CVM diligence OR KMS work landing |
| Branch-protection bypass cleanup | TBD | Operational hygiene, separate from migration |
| GitHub team handles for CODEOWNERS | TBD | Cosmetic; resolves before PR 1 merges |

## References

- [`docs/architecture/README.md`](../../architecture/README.md) — Domain catalog, Shell catalog, Trust boundaries (authoritative for naming)
- [`docs/architecture/admin.md`](../../architecture/admin.md) — `(admin)` shell, A1–A6 pillars
- [`docs/architecture/reliability.md`](../../architecture/reliability.md) — Audit log integrity (load-bearing for single-Convex decision)
- [`docs/architecture/regulatory.md`](../../architecture/regulatory.md) — BACEN/CVM/LGPD floor
- [`docs/architecture/security.md`](../../architecture/security.md) — Secrets and PII crypto model
- [`mutav-finance/mutav-stellar#57`](https://github.com/mutav-finance/mutav-stellar/issues/57) — Source of the consolidation proposal being reconciled
- [`mutav-finance/mutav-stellar#41`](https://github.com/mutav-finance/mutav-stellar/issues/41) — KMS-Action runbook (downstream)
- [`mutav-finance/mutav-app#139`](https://github.com/mutav-finance/mutav-app/issues/139) — This planning effort
