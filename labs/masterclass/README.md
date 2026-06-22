# Masterclass: do SDK ao x402

Hands-on labs following Wlad Mendes' (SDF DevRel LATAM) masterclass — 5 blocos building toward an x402 client paying for an API in USDC on Stellar.

These are **learning labs**, not Mutav production code. Each bloco is a standalone Node + TypeScript script run against Stellar testnet.

> **Provenance.** Salvaged on 2026-06-21 from the orphaned `feat/masterclass-anchor-x402`
> branch — a worktree stranded by the `sgr-app` → `mutav-app` repo rename. Kept because
> it's the only place this material exists: a runnable verification harness for the live
> Etherfuse Pix flow plus documented API gotchas (see `02-etherfuse/README.md` and
> `INTEGRATION-PLAN.md`). Since these labs were written, the production Etherfuse
> integration has landed on `main` (`apps/*/src/lib/anchors/etherfuse/`,
> `convex/payments/providers/`), so read `INTEGRATION-PLAN.md` as a historical map; the
> `02-etherfuse/` scripts remain useful for smoke-testing the sandbox end-to-end.

## Blocos

| #   | Bloco                                                 | Folder             | Status                                              |
| --- | ----------------------------------------------------- | ------------------ | --------------------------------------------------- |
| 1   | SDK avançado — multi-op, fee bump, sponsored reserves | `01-sdk-advanced/` | ✓ verified on testnet                               |
| 2   | Etherfuse anchor — on-ramp, off-ramp, webhooks        | `02-etherfuse/`    | ✓ on-ramp verified; off-ramp + webhook ready to run |
| 3   | DeFi — Soroswap, Blend, DeFindex                      | `03-defi/`         | exploration scaffold — see folder README            |
| 4   | Soroban for builders — TTL, hybrid pattern            | `04-soroban/`      | pending                                             |
| 5   | Lab x402 — paying an API in USDC                      | `05-x402/`         | pending                                             |

## Stack

- **Runtime:** Bun (the project already pins `bun@1.3.1`, so no extra install)
- **SDK:** `@stellar/stellar-sdk` v15+
- **Network:** Stellar testnet via `https://horizon-testnet.stellar.org` and Soroban RPC at `https://soroban-testnet.stellar.org`

## Setup

```sh
cd labs/masterclass
bun install
cp .env.example .env
# fill MASTER_SECRET + (optionally) SPONSOR_SECRET, USDC_ISSUER
```

Run any lab:

```sh
bun run 01-sdk-advanced/01-multi-op.ts
```

## Why labs and not `src/`

These scripts pull in deps (`@x402/fetch`, `@x402/stellar`, …) that have no business in the Mutav app bundle, and the patterns here are exploratory. Production code lives in `apps/*/src/lib/anchors/` and `convex/payments/providers/`.

When a pattern from a lab graduates to production, port it into the main tree — don't import from `labs/`.
