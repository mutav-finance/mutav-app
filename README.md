# SGR App — Dashboard

Web dashboard for managing rental guarantees across chains.

> *Painel web para gestão de garantias locatícias multi-chain.*

## Docs

Shared strategy, whitepaper, pitch deck, and brand assets live in [`tga-protocol/sgr`](https://github.com/tga-protocol/sgr).

## Stack

- Next.js 16 (App Router)
- Tailwind CSS 4 + shadcn/ui
- Privy — Solana wallet auth
- StellarWalletsKit — Stellar wallet connection
- Convex — backend
- Railway — deployment

## Setup

```bash
git clone https://github.com/tga-protocol/sgr-app.git
cd sgr-app
npm install
git config core.hooksPath .githooks
cp .env.example .env.local
```

Fill in `.env.local` with your Privy and Convex credentials, then:

```bash
npm run dev
```

See [CONTRIBUTING.md](https://github.com/tga-protocol/sgr/blob/main/CONTRIBUTING.md) in the shared docs repo for branch workflow and PR guidelines.
