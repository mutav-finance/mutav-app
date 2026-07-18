# Development setup

The canonical "clone → running" runbook. For architecture see [`docs/architecture/README.md`](architecture/README.md); for the persona logins see [`docs/test-personas.md`](test-personas.md).

## Prerequisites

- [Bun ≥ 1.3](https://bun.sh)
- A [Convex](https://convex.dev) account, logged in (`bunx convex login`)
- The dev-tenant Auth0 values from the team (client id/secret) — the apps are Auth0-gated, there is no dev-user fallback

## Environment lives in two places

This trips up every first setup. Some vars must be set **twice**:

| Where        | File / target                                       | Read by                                                         | Vars                                                                                                                   |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Frontend** | `.env.local` (gitignored; copy from `.env.example`) | Next.js — cookie sessions + browser bundle                      | `NEXT_PUBLIC_CONVEX_URL`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`, `NEXT_PUBLIC_AUTH0_DOMAIN`            |
| **Backend**  | the **Convex deployment** (via `convex env set`)    | `convex/` functions at runtime **and the deploy-time analyzer** | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, plus provider keys (Etherfuse/Resend/Stellar) |

**`AUTH0_DOMAIN` + `AUTH0_CLIENT_ID` are required on the deployment or `convex dev` fails to deploy at all** — `auth.config.ts` reads them eagerly and Convex's analyzer refuses to push if they're unset (fail-closed; do not "fix" by making them optional — that was the PR #75 rollback). Set them in `.env.local` and run `bun run convex:env:sync` to push them to the deployment in one shot.

> **PII keys:** `PII_ENCRYPTION_KEY` / `PII_HMAC_KEY` are only exercised by PII crypto paths (credit scoring; **and, post tenant-registry cascade, the seed itself** — it hashes tax IDs via `getOrCreateTenant`). On today's `main` the seed does not need them. Generate dev keys with `openssl rand -base64 32` each. Tracked for prod in [#119](https://github.com/mutav-finance/mutav-app/issues/119); an early-warning "env doctor" is [#249](https://github.com/mutav-finance/mutav-app/issues/249).

## Scenario 1 — first-time setup (fresh clone, new Convex deployment)

```bash
bun install                       # also installs git hooks (husky)
cp .env.example .env.local

# Provision a Convex dev deployment. This first run writes CONVEX_DEPLOYMENT +
# NEXT_PUBLIC_CONVEX_URL into .env.local, then STOPS on the missing Auth0 env —
# that's expected.
bunx convex dev --once            # (or `bun run dev:convex`)

# Fill in the Auth0 (and optionally PII) values in .env.local, then push the
# deployment-side ones:
bun run convex:env:sync

bunx convex dev --once            # now deploys cleanly (schema + functions + components)
bun run seed                      # seed:seedReset — full dataset + all 4 personas
bun dev                           # Next (agency) + Convex together
```

Log in at http://localhost:3000 with a persona from [`docs/test-personas.md`](test-personas.md) (e.g. `agencyowner@mutav.finance` / `MutavDev2026!`).

## Scenario 2 — reseed / reset an existing deployment

| Goal                                                                          | Command                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------------- |
| **Full reset** (wipe + fictional dataset + all personas + agencyowner's book) | `bun run seed` &nbsp;(`convex run seed:seedReset`) |
| Refresh personas only (idempotent, no wipe)                                   | `bunx convex run seed:seedTestPersonas`            |

`seedReset` is the **only** full-seed entrypoint by design — the building blocks (`seedFictional`, etc.) are not independently runnable, because running a subset used to leave `agencyowner` with an empty dashboard (their "Imobiliária Aprovada" book is seeded by a step `seedFictional` skips). See the regression guard in `convex/seed.test.ts`.

## Scenario 3 — fresh Convex deployment for an existing dev (preview / personal)

- **Vercel previews:** automatic — `scripts/seed-preview.sh` runs `seed:seedReset` after each deploy.
- **Manual:** `bunx convex dev` → `bun run convex:env:sync` → `bun run seed`.

## Running the apps

`bun dev` runs Next (agency) + Convex together. Single app:

```bash
bun --filter @mutav/agency dev     # swap agency → pay | fund | admin
```

Only `agency` and `admin` need Auth0 login; `pay` is a `publicId`-bearer URL; `fund` is wallet-as-identity. See the [README](../README.md#workspace) for the app/package map.

## Troubleshooting (the walls, and what they mean)

| Symptom                                                                                   | Cause → fix                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Environment variable AUTH0_DOMAIN is used in auth config file but its value was not set` | Deployment-side Auth0 env missing → `bun run convex:env:sync` (after filling `.env.local`).                                                                               |
| `PII_HMAC_KEY is not set` / `PII_ENCRYPTION_KEY is not set`                               | Credit-score / (post-cascade) seed path hit an unset PII key → set them in `.env.local`, `bun run convex:env:sync`.                                                       |
| `ReferenceError: Buffer is not defined` in a Convex function                              | You're on the **local open-source backend** (`convex dev --local`), whose V8 isolate lacks `Buffer` (cloud Convex provides it). Use a cloud dev deployment.               |
| Logged in, but **no contracts**                                                           | A partial seed (only the demo agencies) — you're on a login persona's own agency, which that path skips. Run `bun run seed` (`seedReset`).                                |
| Browser console: `ws://127.0.0.1:3210 … violates … Content-Security-Policy`               | Only happens when pointing at a **local** backend; the CSP allows `*.convex.cloud`. Use cloud dev, or add the local origin to the dev CSP in `apps/<app>/next.config.ts`. |
| `convex run seed:seedFictional` → function not found                                      | Intentional — the footgun entrypoints were removed. Use `bun run seed`.                                                                                                   |
| CI green locally but a stale test passes across worktrees                                 | Known turbo cache quirk (`convex/**` not hashed into app `test` inputs) — verify with `bunx turbo run typecheck lint test --force`.                                       |

## Related

- [`.env.example`](../.env.example) — the annotated env template (source of truth for var names)
- [`docs/test-personas.md`](test-personas.md) — the four dev logins + reseed/rotation
- [`docs/key-management-guide.md`](key-management-guide.md) — handling secrets / adding a new env-derived key
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — branch workflow, commit style, code standards
