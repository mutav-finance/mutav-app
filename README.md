# SGR App — Dashboard

Web dashboard for managing rental guarantees across chains.

> *Painel web para gestão de garantias locatícias multi-chain.*

## Docs

Shared strategy, whitepaper, pitch deck, and brand assets live in [`tga-protocol/sgr`](https://github.com/tga-protocol/sgr).

## Stack

- **Next.js 16** — App Router, Turbopack
- **Tailwind CSS 4** + **shadcn/ui**
- **Convex** — realtime backend
- **Privy** — Solana wallet auth
- **Bun** — package manager + script runner
- **Railway** — deployment

> Stellar wallet connection is currently unwired. The previous
> `@creit.tech/stellar-wallets-kit` integration was removed pending a
> replacement with a smaller transitive surface (the kit shipped Trezor,
> Hot Wallet, and NEAR adapters we never invoked, all flagged critical by
> npm audit).

## Quick start

Prerequisites: [Bun ≥ 1.3](https://bun.sh).

```bash
git clone https://github.com/tga-protocol/sgr-app.git
cd sgr-app
bun install
git config core.hooksPath .githooks
cp .env.example .env.local   # fill in Convex + Privy creds
bun dev
```

`bun dev` runs Next.js and the Convex backend together with named, colored
logs (`web` in cyan, `cvx` in magenta). If either crashes, both shut down
so you never end up with half a dev environment.

## Scripts

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `bun dev`          | Run Next + Convex together (recommended)      |
| `bun run dev:web`  | Just the Next.js app                          |
| `bun run dev:convex` | Just the Convex dev backend                 |
| `bun run build`    | Production build                              |
| `bun run start`    | Serve the production build                    |
| `bun run lint`     | ESLint                                        |

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
