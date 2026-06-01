# MUTAV App — Dashboard

Web dashboard for managing rental guarantees across chains.

> _Painel web para gestão de garantias locatícias multi-chain._

## Docs

Shared strategy, whitepaper, pitch deck, and brand assets live in [`mutav-finance/mutav`](https://github.com/mutav-finance/mutav).

## Stack

- **Next.js 16** — App Router, Turbopack
- **Tailwind CSS 4** + **shadcn/ui**
- **Convex** — realtime backend
- **Privy** — Solana wallet auth
- **Bun** — package manager + script runner
- **Railway** — deployment

## Related tools

[**stellar-build**](https://web-nine-umber-74.vercel.app/) — community CLI bundling 42 Stellar-focused Claude skills + 6 personas; useful when this app needs to interact with Stellar contracts on `mutav-stellar`. Install: `curl -fsSL https://raw.githubusercontent.com/kaankacar/stellar-build/main/install.sh | bash`

> Stellar wallet connection is currently unwired. The previous
> `@creit.tech/stellar-wallets-kit` integration was removed pending a
> replacement with a smaller transitive surface (the kit shipped Trezor,
> Hot Wallet, and NEAR adapters we never invoked, all flagged critical by
> npm audit).

## Quick start

Prerequisites: [Bun ≥ 1.3](https://bun.sh).

```bash
git clone https://github.com/mutav-finance/mutav-app.git
cd mutav-app
bun install                   # also installs git hooks via husky
cp .env.example .env.local    # fill in Convex + Privy creds
bun dev
```

`bun dev` runs Next.js and the Convex backend together with named, colored
logs (`web` in cyan, `cvx` in magenta). If either crashes, both shut down
so you never end up with half a dev environment.

## Scripts

| Command                | What it does                             |
| ---------------------- | ---------------------------------------- |
| `bun dev`              | Run Next + Convex together (recommended) |
| `bun run dev:web`      | Just the Next.js app                     |
| `bun run dev:convex`   | Just the Convex dev backend              |
| `bun run build`        | Production build                         |
| `bun run start`        | Serve the production build               |
| `bun run lint`         | ESLint                                   |
| `bun run lint:fix`     | ESLint with `--fix`                      |
| `bun run typecheck`    | `tsc --noEmit`                           |
| `bun run format`       | Prettier — write changes                 |
| `bun run format:check` | Prettier — verify only                   |

The root scripts above run unfiltered — the whole workspace is touched
regardless of what changed. CI uses a Turborepo filter
(`turbo run <task> --filter='...[origin/main]'`) so only changed apps
plus their dependents execute on a given PR.

## Workspace

`mutav-app` is a [Turborepo](https://turborepo.com) monorepo with four
persona apps and three shared packages, sharing one Convex backend at
the repo root.

### Apps

| App           | Origin                | Identity                       | Vercel project |
| ------------- | --------------------- | ------------------------------ | -------------- |
| `apps/agency` | `app.mutav.finance`   | Auth0 (agency staff)           | `mutav-agency` |
| `apps/pay`    | `pay.mutav.finance`   | None — `publicId` bearer URL   | `mutav-pay`    |
| `apps/fund`   | `fund.mutav.finance`  | Wallet-as-identity (per chain) | `mutav-fund`   |
| `apps/admin`  | `admin.mutav.finance` | Auth0 (`mutavStaff`, MFA)      | `mutav-admin`  |

Each app has its own Vercel project rooted at `apps/<name>` and its own
hostname. Cookies are `Host-Only` so a session never crosses subdomains
(see [spec § Section 1](docs/superpowers/specs/2026-05-31-monorepo-migration-design.md)).

### Packages

| Package           | Owns                                                  |
| ----------------- | ----------------------------------------------------- |
| `@mutav/ui`       | shadcn primitives shared across apps                  |
| `@mutav/i18n`     | next-intl `routing` / `navigation` / `request` shells |
| `@mutav/tsconfig` | `base.json` + `nextjs.json` consumed by every app     |

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

## Git hooks

Hooks are managed by [Husky](https://typicode.github.io/husky/) and install automatically on `bun install` (via the `prepare` script). No manual setup needed.

- **`pre-commit`** — runs `bun run typecheck` on the whole project, then `lint-staged` on staged files only:
  - `*.{ts,tsx}` → `prettier --write` + `eslint --fix --max-warnings=0`
  - `*.{js,jsx,mjs,cjs,json,md,yml,yaml,css}` → `prettier --write`
- **`commit-msg`** — enforces [Conventional Commits](https://www.conventionalcommits.org/) via `commitlint` (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `perf:`, `revert:`, optional scope, optional `!` for breaking).
- **`pre-push`** — blocks direct pushes to `main`. Use a feature branch + PR.

Bypass in emergencies: `git commit --no-verify` / `git push --no-verify`.

## Environment

`.env.local` (copied from `.env.example`):

```
CONVEX_DEPLOYMENT=          # set by `bunx convex dev` on first run
NEXT_PUBLIC_CONVEX_URL=     # https://<deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=# https://<deployment>.convex.site
```

On a fresh clone, the first `bun dev` may prompt you to log in to Convex
and pick a deployment — that's expected, and it writes the values above
into `.env.local` for you.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch workflow, commit style,
and code standards.

## License

Licensed under the Apache License, Version 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
