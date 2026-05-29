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
