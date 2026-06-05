# Memory — mutav-app

Durable facts that survive context resets. Append as decisions land; remove when superseded.

## Repo identity

- **Turborepo monorepo.** Persona apps: `apps/admin/`, `apps/agency/`, `apps/fund/`, `apps/pay/`. Shared packages: `packages/{i18n,tsconfig,ui,wallet}`.
- **The Mutav API** is the Convex backend at `convex/`. It is the global API surface for every persona app and orchestrates off-chain state + Stellar settlement.
- **Stellar consumer**, not producer. Imports `@mutav-finance/mutav-stellar` for chain reads + XDR composition. No re-implementation of chain math; no daemon scaffolding in this repo.

## Authority model (per 2026-05-30 consolidation)

| Key            | Where it lives                                | Signs                                                                  |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Operator (hot) | KMS-backed Convex Action                      | Routine fund ops (partner inflows, redemptions, yield, TTL renewal)    |
| Admin (cold)   | Hardware wallet inside `apps/admin/`          | Parameter changes, `cover_default`, partner whitelist, pause, handover |
| Investor       | User wallet inside `apps/fund/` (client-side) | Deposit, request/cancel redemption, SEP-41 ops                         |

## In-progress consolidation

- Persona-app split + Convex Action operator runtime tracked at [`#139`](https://github.com/mutav-finance/mutav-app/issues/139). Until that plan lands, **don't pre-emptively scaffold `apps/*` or rename Convex domains**.
- `mutav-fund/` folds into `apps/fund/` (see [`mutav-fund#11`](https://github.com/mutav-finance/mutav-fund/issues/11)). No new features should land in `mutav-fund/`.

## Brand contract

- `branding/` is vendored from sibling `brand/` repo. Edits round-trip through `cd ../brand && bun brand:import mutav-app`. See `.claude/rules/brand.md`.

## Known harness debt

- **`CLAUDE.md` is ~510 lines** (target: <200). Pending split into `.claude/rules/{convex.md, i18n.md, brazil-domain.md, result-pattern.md}` with `paths:` frontmatter. See `STATE.md` if/when split begins.

## Open questions / pending decisions

- Three open treasury policy decisions awaiting Draau input — see [`docs/architecture/pending-treasury-decisions.md`](docs/architecture/pending-treasury-decisions.md).
