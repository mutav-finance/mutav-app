# Project State — mutav-app

> Consolidated status snapshot. **Last updated: 2026-06-23.**
> This is a human-facing summary; the canonical system map is [`docs/architecture/README.md`](docs/architecture/README.md). When status changes materially, update this file and the relevant architecture doc together.

## What this repo is

`mutav-app` is the Turborepo monorepo holding every web surface for the **MUTAV protocol** (onchain rental-guarantee infrastructure for Brazil) plus the **Mutav API** (Convex backend). It consumes the `@mutav-finance/mutav-stellar` SDK to settle guarantees on Stellar via the `Fund` contract. See the workspace [`../CLAUDE.md`](../CLAUDE.md) for the multi-repo picture.

## Status at a glance

> Verified 2026-06-23 against live Vercel deployments, the Convex backend code, and git/PR state.

| Area                                 | Status                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo split (apps + packages)     | ✅ Live — Turborepo layout landed; all four apps build & deploy                                                                                                                                                                                                                                                                                                                                               |
| Auth0 wiring                         | ✅ Wired end-to-end — backend resolves identity via `ctx.auth.getUserIdentity()` (`convex/lib/auth.ts`); shared dev tenant `dev-ay46ib0hhi1mdwpw`; prod tenant not yet cut                                                                                                                                                                                                                                    |
| Agency dashboard (`apps/agency`)     | 🟢 Live — `app.mutav.finance` (307 → Auth0 login)                                                                                                                                                                                                                                                                                                                                                             |
| Tenant payment (`apps/pay`)          | 🟢 Deployed + domain attached — `pay.mutav.finance` (bearer/`publicId`; bare root 404 by design)                                                                                                                                                                                                                                                                                                              |
| Mutav admin (`apps/admin`)           | 🟢 Live — `admin.mutav.finance`, Auth0 working; consumes `@mutav/wallet` for staff connect                                                                                                                                                                                                                                                                                                                    |
| Investor portal (`apps/fund`)        | 🟡 Deployed to prod (`mutav-app-fund-mutav.vercel.app`); custom domain `fund.mutav.finance` **not yet attached**; **stage 2** — Web2 version not opened during pilot. The **decentralized** fund is being built as a POC in the sibling **`mutav-pulse`** repo (PULSO hackathon) — see below                                                                                                                  |
| Wallet integration (`@mutav/wallet`) | 🟠 In progress — Stellar Wallets Kit v2, admin connect + signed-challenge ownership proof; consumed by `apps/admin` only; unmerged on `feat/mutav-wallet` (PR #218)                                                                                                                                                                                                                                           |
| KMS-backed operator Convex Action    | 🔴 Not implemented — only a future-rotation comment in `convex/lib/env.ts`; **stage 2**                                                                                                                                                                                                                                                                                                                       |
| Admin signing authority              | 🟠 Decided ([ADR 0005](docs/architecture/decisions/0005-wallet-signing-architecture.md), PR #217) — **M-of-N multisig; quorum lives in the account, signed by each admin's personal connected wallet** (hardware via Freighter+Ledger, no separate Ledger path). **Classic native Stellar multisig for the pilot → OZ smart account upgrade later.** Foundation = the `@mutav/wallet` connect/sign work above |

## Architecture

Two-repo protocol (consolidated 2026-05-30 per [`mutav-stellar#57`](https://github.com/mutav-finance/mutav-stellar/issues/57)):

- **`mutav-stellar`** — audited surface: `Fund` Soroban contract + read-only TS SDK. No signing keys.
- **`mutav-app`** (this repo) — persona apps + Mutav API (Convex). Operator key custody moves here as a KMS-backed Convex Action; admin authority is an **M-of-N multisig** at the vault/policy admin address, each admin signing from `apps/admin/` with their own personal connected wallet.

Authority model (which key signs what): operator (hot, KMS Convex Action) · admin (cold — M-of-N multisig quorum, each admin signs with their own connected wallet from `apps/admin/`) · investor (user wallet). Full table in [`CLAUDE.md`](CLAUDE.md). **Account model** ([ADR 0005](docs/architecture/decisions/0005-wallet-signing-architecture.md)): **classic native Stellar multisig for the pilot, OZ smart account as a later drop-in upgrade** (`set_admin` to a `C…`) — the frontend wallet code is identical for both. ADR 0005 evolves [ADR 0004](docs/architecture/decisions/0004-pilot-cover-default-coverage-draw.md)'s earlier "OZ Smart Account M-of-N passkeys" framing on the account-model point (ADR 0004's body is left as the historical record; it still warrants a "superseded-in-part by 0005" banner when #217 merges).

### Layout

```
apps/      agency · pay · fund · admin        (one Next.js app per audience, one origin each)
packages/  ui · i18n · app-shell · wallet · tsconfig   (@mutav/* — shared, no app deps)
convex/    Mutav API — shared backend at repo root (NOT inside any app)
```

Convex domains: `agencies`, `audit`, `contracts`, `creditAnalysis`, `invoices`, `mutavStaff`, `payments`, `reserve`, `transparency`, `users`, `waitlist`.

## Deployments (Vercel team `mutav`, verified 2026-06-23)

| Project           | Latest prod URL                   | Custom domain                        | State                                      |
| ----------------- | --------------------------------- | ------------------------------------ | ------------------------------------------ |
| `mutav-app`       | `app.mutav.finance`               | ✅ attached                          | Live (agency)                              |
| `mutav-app-admin` | `admin.mutav.finance`             | ✅ attached                          | Live (Auth0 working)                       |
| `mutav-app-pay`   | `pay.mutav.finance`               | ✅ attached                          | Live (bearer; bare root 404 by design)     |
| `mutav-app-fund`  | `mutav-app-fund-mutav.vercel.app` | ❌ `fund.mutav.finance` not attached | Deployed; domain attach deferred (stage 2) |

DNS: `mutav.finance` zone on Vercel with a wildcard `* ALIAS`, so `fund.mutav.finance` resolves to the edge but 404s until the domain is attached to the `mutav-app-fund` project. Operator/admin signing keys are **not** in any deployment yet (no operator Convex Action; treasury signer in `convex/lib/stellarSigner.ts` is for SEP-10/24 anchor flows only).

## Recent milestones (merged to main)

- **Monorepo** — shared app shell extracted into packages; persona apps simplified (#211).
- **Auth0** — single Auth0 provider across agency/fund/admin, unblocking preview deploys (#215).
- **Mutav staff (admin)** — `mutavStaff` authorization core with aud-bound wrappers (#202), onboarding review queue + shell-switcher (#205), runtime fixes (#210).
- **Credit analysis** — vendor-neutral `creditAnalysis` domain + tenant-credit migration (#188); tenant `entityType` backfill (#216, step 1 of #60).
- **Invoice + settlement refactor** — COMPLETE (9 PRs). Dev + prod migrated/reseeded; prod live on `app.mutav.finance`. See [`.claude/notes/invoice-refactor-handoff.md`](.claude/notes/invoice-refactor-handoff.md).
- **ADRs** — 0001 PII crypto · 0002 tenant-credit data governance · 0003 persona-app origin isolation · 0004 pilot `cover_default` coverage-draw.

## In flight

- **Wallet signing** — `@mutav/wallet` scaffold (Stellar Wallets Kit v2) on `feat/mutav-wallet` (PR #218); admin staff connect proves ownership via a signed challenge in one gesture. ADR 0005 (wallet-signing architecture, supersedes #157) open as PR #217 on `docs/adr-0005-wallet-architecture`. Selection spec #157 is draft.
- **BigDataCorp integration** — worktree `feat/bigdatacorp-integration`.

## Related repos / parallel work

- **`mutav-pulse`** (`mutav-finance/mutav-pulse`) — a **PULSO hackathon** submission (Brazil track, Stellar/Soroban): a POC of the **decentralized** version of the fund / guarantee system. The trust-minimized counterpart to this repo's Web2 `apps/fund` — the decentralized fund work is happening **there**, not in `apps/fund`, for now.
  - **Contracts** (`contracts/`, Soroban/Rust) — modular design: `interfaces` (shared `Guarantee` + cross-contract client traits), `registry` (writer-gated store), `vault` (custody: OZ-fungible shares, NAV with virtual-offset anti-inflation, surplus-gated redemption queue, strategy allocator, policy-gated `disburse`/`collect_premium`), `policy` (swappable premium-gated underwriting brain), `strategy` trait + `adapter-defindex` (real DeFindex yield) + mock doubles. Onchain solvency invariant `stable_assets ≥ coverage_required` enforced re-entrancy-safely; SEP-0056 vault conformance. 23 unit tests. Build wasm with `stellar contract build` (not `cargo build`). Live strategy slot currently runs a mock.
  - **Frontend** (`frontend/`, Next.js 16 + React 19) — investor app **MUTAV Reserve** (`/earn`, `/earn/transparency`, `/earn/defi`) + admin-gated operator cockpit **MUTAV Protocol** (`/protocol`). Frontend holds **no keys**: signing is via **Stellar Wallets Kit v2.3.0** (`lib/wallet.ts` — `connect()` authModal → `signTransaction`), with investor txs in `lib/tx.ts` and admin ops (e.g. `sign_guarantee`) in `lib/admin-tx.ts`. Typed bindings generated from the deployed contracts (`bindings/{vault,policy,registry}`). 10 vitest tests.
  - Deployed + seeded on **Stellar testnet**; vault/policy/registry live. Status as of 2026-06-22: three plans complete on `main`, demo-ready.
  - **Relevance to this repo:** `mutav-pulse` is the reference implementation of the per-admin connected-wallet signing model now adopted for `apps/admin` — `@mutav/wallet` is porting/hardening that Stellar Wallets Kit pattern.

## Pilot scope

Pilot = **admin + agency only**, plus LGPD work. The Web2 fund (investor app) is **not** opened during the pilot; the operator-runtime cluster that serves the fund is deferred too (issues labeled `stage-2`). The decentralized fund is being explored separately in `mutav-pulse` (above).

## Pending decisions

- [`docs/architecture/pending-treasury-decisions.md`](docs/architecture/pending-treasury-decisions.md) — three open treasury policy decisions awaiting Draau (NAV policy, deposit pricing, Pix quarantine window).
- Regulatory classification (VASP / FIDC / FIF / IP) open pending counsel; Mutav is not a VASP today.

## Deferred / tracked refactors

See [`.claude/notes/deferred-conventions.md`](.claude/notes/deferred-conventions.md) — auth wrappers, shared `useQuery`, React Hook Form + shadcn Field, server domain providers, Convex workpool, and the money → integer-cents migration.

## Key pointers

- System map: [`docs/architecture/README.md`](docs/architecture/README.md) (actor / shell / domain catalogs, trust boundaries)
- Surfaces: [`admin.md`](docs/architecture/admin.md), [`investor.md`](docs/architecture/investor.md)
- Cross-cutting: [`compliance.md`](docs/architecture/compliance.md), [`reliability.md`](docs/architecture/reliability.md), [`regulatory.md`](docs/architecture/regulatory.md), [`security.md`](docs/architecture/security.md), [`onchain-integration.md`](docs/architecture/onchain-integration.md)
- Decisions: [`docs/architecture/decisions/`](docs/architecture/decisions/)
- Migration history: [`docs/architecture/monorepo-migration.md`](docs/architecture/monorepo-migration.md)
- Deploy: [`reference_vercel_mutav_app_deploy`](.claude/projects) memory note · Vercel team `mutav` (`team_GNLcWCe3CRw43IgLIjconlkU`)
