@AGENTS.md

# SGR App — Agent Context

## Project
SGR (Sistema de Garantia Registrada) — dashboard for managing rental guarantees across chains.

## Shared docs
Strategy, whitepaper, pitch deck, and brand assets live in a sibling repo.
Clone it for full context:

```bash
git clone https://github.com/tga-protocol/sgr.git ../sgr
```

Key files:
- `../sgr/docs/whitepaper.md` — protocol design and architecture
- `../sgr/docs/pitch-deck.md` — positioning and market context

If the sibling repo is not cloned locally, fetch files directly:
```bash
gh api repos/tga-protocol/sgr/contents/docs/whitepaper.md --jq '.content' | base64 -d
```

## Stack
- Next.js 16 (App Router, src/ directory)
- Tailwind CSS 4
- shadcn/ui (radix-nova style, neutral base color, TGA tokens in `src/app/globals.css`)
- StellarWalletsKit — Stellar wallet connection
- Convex — backend (functions in convex/)
- Railway — deployment

## Architecture
- `src/providers/` — client providers (Convex, Stellar)
- `src/components/ui/` — shadcn components
- `src/app/` — Next.js app router pages
- `convex/` — Convex backend functions

## Code standards
- TypeScript strict
- Branch workflow: feature branches → squash merge PRs to main
