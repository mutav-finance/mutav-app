# MUTAV App — Dashboard

Web dashboard for managing rental guarantees across chains.

> _Painel web para gestão de garantias locatícias multi-chain._

## Docs

Shared strategy, whitepaper, pitch deck, and brand assets live in [`mutav-finance/mutav`](https://github.com/mutav-finance/mutav).

## Stack

- **Next.js 16** — App Router, Turbopack
- **Tailwind CSS 4** + **shadcn/ui**
- **Convex** — realtime backend
- **Auth0** — agency/admin auth (cookie sessions + JWT-verified Convex functions)
- **Bun** — package manager + script runner
- **Vercel** — deployment (one project per app)

## Related tools

[**stellar-build**](https://web-nine-umber-74.vercel.app/) — community CLI bundling 42 Stellar-focused Claude skills + 6 personas; useful when this app needs to interact with Stellar contracts on `mutav-stellar`. Install: `curl -fsSL https://raw.githubusercontent.com/kaankacar/stellar-build/main/install.sh | bash`

> Stellar wallet connection is currently unwired. The previous
> `@creit.tech/stellar-wallets-kit` integration was removed pending a
> replacement with a smaller transitive surface (the kit shipped Trezor,
> Hot Wallet, and NEAR adapters we never invoked, all flagged critical by
> npm audit).

## Quick start

Prerequisites: [Bun ≥ 1.3](https://bun.sh) + a Convex login (`bunx convex login`).

```bash
git clone https://github.com/mutav-finance/mutav-app.git
cd mutav-app
bun install                   # also installs git hooks via husky
cp .env.example .env.local    # fill in Auth0 + (optional) PII values
bunx convex dev --once        # provisions a dev deployment (writes Convex URLs)
bun run convex:env:sync       # push deployment-side env (Auth0 etc.) from .env.local
bunx convex dev --once        # re-run: now deploys cleanly
bun run seed                  # seed:seedReset — full dataset + all 4 personas
bun dev
```

> **First time?** The apps are Auth0-gated (no dev-user fallback) and a few env
> vars live in **two** places (`.env.local` _and_ the Convex deployment), so the
> naked `bun dev` above needs the env + seed steps first. The full runbook,
> scenarios (reseed, fresh deployment), and a troubleshooting table for the
> common walls live in **[docs/development.md](docs/development.md)**.

`bun dev` runs Next.js and the Convex backend together with named, colored
logs (`web` in cyan, `cvx` in magenta). If either crashes, both shut down
so you never end up with half a dev environment.

## Scripts

| Command                     | What it does                                                                |
| --------------------------- | --------------------------------------------------------------------------- |
| `bun dev`                   | Run Next + Convex together (recommended)                                    |
| `bun run dev:web`           | Just the Next.js app                                                        |
| `bun run dev:convex`        | Just the Convex dev backend                                                 |
| `bun run convex:env:sync`   | Push deployment-side env from `.env.local` (Auth0/PII/providers)            |
| `bun run seed`              | Full reseed (`seed:seedReset`)                                              |
| `bun run build`             | Production build                                                            |
| `bun run start`             | Serve the production build                                                  |
| `bun run lint`              | ESLint                                                                      |
| `bun run lint:fix`          | ESLint with `--fix`                                                         |
| `bun run typecheck`         | `tsc --noEmit`                                                              |
| `bun run test`              | Full suite via turbo (each app + convex/\*\* picked up 4×)                  |
| `bun run test:convex`       | Convex-only run from repo root — one shot, no duplication                   |
| `bun run test:convex:watch` | Watch mode for `convex/**` (fastest TDD loop)                               |
| `bun run test:file <path>`  | Run one file, e.g. `bun run test:file convex/delinquencies/machine.test.ts` |
| `bun run format`            | Prettier — write changes                                                    |
| `bun run format:check`      | Prettier — verify only                                                      |

The root scripts above run unfiltered — the whole workspace is touched
regardless of what changed. CI uses a Turborepo filter
(`turbo run <task> --filter='...[origin/main]'`) so only changed apps
plus their dependents execute on a given PR.

## Workspace

`mutav-app` is a [Turborepo](https://turborepo.com) monorepo with four
persona apps and three shared packages, sharing one Convex backend at
the repo root.

### Apps

| App           | Origin                | Identity                       | Vercel project    |
| ------------- | --------------------- | ------------------------------ | ----------------- |
| `apps/agency` | `app.mutav.finance`   | Auth0 (agency staff)           | `mutav-app`       |
| `apps/pay`    | `pay.mutav.finance`   | None — `publicId` bearer URL   | `mutav-app-pay`   |
| `apps/fund`   | `fund.mutav.finance`  | Wallet-as-identity (per chain) | `mutav-app-fund`  |
| `apps/admin`  | `admin.mutav.finance` | Auth0 (`mutavStaff`, MFA)      | `mutav-app-admin` |

Each app has its own Vercel project rooted at `apps/<name>` and its own
hostname. Cookies are `Host-Only` so a session never crosses subdomains
(see [spec § Section 1](docs/architecture/monorepo-migration.md)).

### Packages

See [CLAUDE.md § Monorepo layout](./CLAUDE.md#monorepo-layout) for the
canonical list of workspace packages under `packages/*` and what each
one owns.

Packages are extracted on demand — only when a second app actually
consumes the code. No speculative package boundaries.

### Running a single app

```bash
bun --filter @mutav/agency dev          # Next dev server, agency only
bun --filter @mutav/agency test         # vitest run, agency only
bun --filter @mutav/agency typecheck    # tsc --noEmit, agency only
bun --filter @mutav/agency build        # next build, agency only
```

Swap `agency` for `pay`, `fund`, or `admin` to target a different app.
`bun run dev` at the root still launches Next (agency) + Convex
together for the common dev loop.

### Per-app Vercel deploy gating

Each of the four Vercel projects has its
[**Ignored Build Step**](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step)
(Settings → Build and Deployment → Ignored Build Step → **Custom**)
set to a one-line `git diff` that returns exit `0` (skip) when none of
this app's relevant paths changed since the parent commit, and exit
`1` (proceed) otherwise:

| Project           | Ignored Build Step command                                      |
| ----------------- | --------------------------------------------------------------- |
| `mutav-app`       | `git diff --quiet HEAD^ HEAD -- apps/agency/ convex/ packages/` |
| `mutav-app-pay`   | `git diff --quiet HEAD^ HEAD -- apps/pay/ convex/ packages/`    |
| `mutav-app-fund`  | `git diff --quiet HEAD^ HEAD -- apps/fund/ convex/ packages/`   |
| `mutav-app-admin` | `git diff --quiet HEAD^ HEAD -- apps/admin/ convex/ packages/`  |

`convex/` and `packages/` are in every app's path list because they are
shared dependencies — a change to either triggers a rebuild of all four
apps (single Convex deployment, single audit log; PR 6 packages
consumed via `transpilePackages`). This replaces the deprecated
`npx turbo-ignore` package referenced in some older docs.

### Per-app CI gating

`.github/workflows/quality.yml` uses
`bunx turbo run <task> --filter='...[origin/main]'` for `lint`,
`typecheck`, and `test`. Only changed apps plus their dependents run,
which keeps CI fast as more persona apps land. The `conventions`
(regression-greps) and root `format:check` are not per-app turbo tasks
and continue to run on every PR.

## Testing

The runner is **Vitest** everywhere. Three kinds of test file:

| Kind                     | Where                                                        | Environment                                                                       | Uses convex-test? | Runs without a Convex deployment             |
| ------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------- | -------------------------------------------- |
| **Pure logic**           | `convex/**/{domain,machine}.test.ts`, `apps/**/*.test.ts(x)` | `node` (default) — some opt into `edge-runtime`                                   | no                | yes                                          |
| **Scenario**             | `convex/**/scenarios.test.ts`                                | `edge-runtime` (opt in with `// @vitest-environment edge-runtime` at top of file) | yes               | yes — convex-test spins an in-memory backend |
| **Scenario / db-backed** | `convex/**/{seed,useCases}.test.ts`                          | `edge-runtime` (opt in with `// @vitest-environment edge-runtime` at top of file) | yes               | yes — convex-test spins an in-memory backend |

**How to run:**

```bash
bun run test              # everything, via turbo — each app runs its own vitest
bun run test:convex       # convex/** only, from repo root — no duplication
bun run test:convex:watch # TDD loop over convex/**
bun run test:file <path>  # one file, e.g. bun run test:file convex/delinquencies/machine.test.ts
```

**Config layout:** every app has its own `vitest.config.ts` scoped to `apps/<app>/**` + `convex/**`, and there's a root `vitest.config.ts` scoped to `convex/**` only. Root config is what `bun run test:convex` uses; the app configs are what `turbo run test` invokes. Both share the two settings convex-test needs — `server.deps.inline: ["convex-test"]` and `resolve.preserveSymlinks: true`.

**Common failure modes** (all solved by using the scripts above — do NOT run raw `bunx vitest` from a fresh shell):

- `(intermediate value).glob is not a function` — you invoked vitest without a config that inlines `convex-test`. Use `bun run test:convex`.
- `Cannot find module '@mutav/ui/...'` after entering a worktree — workspace symlinks are missing. Run `bun install` once inside the worktree.
- `No CONVEX_DEPLOYMENT set` when running codegen or `bun run seed` — copy `.env.local` from the parent working tree into the worktree, or run `bunx convex dev --once` in the worktree.

**Writing tests — the shape convention:**

- Pure logic → `machine.test.ts`, `domain.test.ts` — plain vitest, no `convexTest(...)`. See `convex/delinquencies/machine.test.ts` for the canonical shape (state-machine exhaustive coverage, self-transition + terminal-state rejection).
- Scenario → `scenarios.test.ts` — schema conformance, index coverage, and cross-agency isolation; produced by the [`build-scenario-tests`](.claude/workflows/build-scenario-tests.js) workflow. Same edge-runtime + `convexTest` harness as db-backed tests. See `convex/delinquencies/scenarios.test.ts` for the canonical shape.
- Db-backed scenarios → `useCases.test.ts`, `seed.test.ts` — starts with `// @vitest-environment edge-runtime`, calls `convexTest(schema)` and `registerContractAggregateComponents(t)` (from `convex/lib/testFixtures.ts`) so aggregate writes don't throw. See `convex/seed.test.ts` for the pattern.

## Git hooks

Hooks are managed by [Husky](https://typicode.github.io/husky/) and install automatically on `bun install` (via the `prepare` script). No manual setup needed.

- **`pre-commit`** — runs `bun run typecheck` on the whole project, then `lint-staged` on staged files only:
  - `*.{ts,tsx}` → `prettier --write` + `eslint --fix --max-warnings=0`
  - `*.{js,jsx,mjs,cjs,json,md,yml,yaml,css}` → `prettier --write`
- **`commit-msg`** — enforces [Conventional Commits](https://www.conventionalcommits.org/) via `commitlint` (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `perf:`, `revert:`, optional scope, optional `!` for breaking).
- **`pre-push`** — blocks direct pushes to `main`. Use a feature branch + PR.

Bypass in emergencies: `git commit --no-verify` / `git push --no-verify`.

## Environment

Copy [`.env.example`](.env.example) → `.env.local` and fill it in. The file is
annotated; the key thing to know is that some vars live in **two** places:

- **`.env.local`** — read by Next.js (Convex URLs, Auth0 cookie-session secrets, `NEXT_PUBLIC_*`).
- **The Convex deployment** — read by `convex/` functions _and_ the deploy-time analyzer. `AUTH0_DOMAIN` + `AUTH0_CLIENT_ID` **must** be set here or `convex dev` refuses to deploy. Push them from `.env.local` with `bun run convex:env:sync`.

The Convex URLs (`CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`) are written for you by the first `bunx convex dev`.

See **[docs/development.md](docs/development.md)** for the full first-setup sequence, the two-sided env table, reseed/fresh-deployment scenarios, and a troubleshooting table for the common walls (missing Auth0/PII env, `Buffer is not defined`, empty dashboard after login).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch workflow, commit style,
and code standards.

## License

Licensed under the Apache License, Version 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
