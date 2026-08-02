@AGENTS.md

# Mutav — Agent Context

## Project

Mutav — the web surface for the MUTAV protocol. Agency dashboard, tenant payment, investor portal, Mutav-internal admin, and the **Mutav API** (Convex backend) that orchestrates everything off-chain. Settles guarantees on Stellar via the `Fund` contract published by [`mutav-finance/mutav-stellar`](https://github.com/mutav-finance/mutav-stellar).

## Target architecture (per [mutav-stellar#57](https://github.com/mutav-finance/mutav-stellar/issues/57))

On 2026-05-30 the protocol consolidated to **two repos** (down from three):

- **`mutav-stellar`** — Fund contract (Soroban/Rust) + TS SDK only. Audited surface, slow cadence. No daemons, no UI.
- **`mutav-app`** (this repo) — Turborepo monorepo holding the persona apps + Mutav API. The 6 Bun operator daemons that were in flight on `mutav-stellar` (PRs #22–#27) move here as **Convex crons + Actions**. Operator key custody moves from a daemon host to a **KMS-backed Convex Action** (tracked at [`mutav-stellar#41`](https://github.com/mutav-finance/mutav-stellar/issues/41)).

The web3 portal currently in [`mutav-finance/mutav-fund`](https://github.com/mutav-finance/mutav-fund) folds into `apps/fund/`; that repo soft-deprecates and eventually archives (see [`mutav-fund#11`](https://github.com/mutav-finance/mutav-fund/issues/11)).

**Authority model** — which key signs what:

| Key                | Where it lives                                                                                                                                                                                                                                                                                                                                                                             | Signs                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Operator** (hot) | KMS-backed Convex Action                                                                                                                                                                                                                                                                                                                                                                   | Routine fund ops — partner inflows, redemption processing, yield/fee accrual, TTL renewal |
| **Admin** (cold)   | **M-of-N multisig** at the vault/policy admin address, each admin signing with their **own personal connected wallet** from `apps/admin/` (Stellar Wallets Kit; hardware via Freighter+Ledger). **Classic native Stellar multisig for the pilot → OZ smart account later** (drop-in `set_admin` upgrade). See [ADR 0005](docs/architecture/decisions/0005-wallet-signing-architecture.md). | Parameter changes, `cover_default`, partner whitelist, pause, admin handover              |
| **Investor**       | User wallet inside `apps/fund/` (client-side)                                                                                                                                                                                                                                                                                                                                              | Deposit, request/cancel redemption, SEP-41 token ops                                      |

**Status: monorepo is live.** The Turborepo split has landed — the persona apps are scaffolded under `apps/` and shared code is extracted into `packages/` (see [§ Monorepo layout](#monorepo-layout) below). The on-chain pieces (KMS-backed operator Convex Action, the `apps/admin/` M-of-N multisig signing path per [ADR 0005](docs/architecture/decisions/0005-wallet-signing-architecture.md)) are still being implemented; the Convex backend stays at the **repo root** in `convex/`, shared by every app. Migration history and the staged-PR sequence live in [`docs/architecture/monorepo-migration.md`](docs/architecture/monorepo-migration.md); the reconciliation against [`#57`](https://github.com/mutav-finance/mutav-stellar/issues/57)'s app/module sketch is in [`docs/architecture/README.md`](docs/architecture/README.md) (§ Shell catalog, § App catalog, § Domain catalog).

## Shared docs

Strategy, whitepaper, pitch deck, and brand assets live in a sibling repo.
Clone it for full context:

```bash
git clone https://github.com/mutav-finance/mutav.git ../mutav
```

Key files:

- `../mutav/docs/whitepaper.md` — protocol design and architecture
- `../mutav/docs/pitch-deck.md` — positioning and market context

If the sibling repo is not cloned locally, fetch files directly:

```bash
gh api repos/mutav-finance/mutav/contents/docs/whitepaper.md --jq '.content' | base64 -d
```

## System architecture

[`docs/architecture/`](docs/architecture/) is the canonical system map. Read [`docs/architecture/README.md`](docs/architecture/README.md) first for actor catalog, shell catalog, domain catalog, and trust boundaries.

**Surfaces:**

- [`docs/architecture/admin.md`](docs/architecture/admin.md) — Mutav Admin (`mutavStaff` actor, `(admin)` shell, A1–A6 pillars, default-approval workflow, NAV updates, hash-chained audit log)
- [`docs/architecture/investor.md`](docs/architecture/investor.md) — Investor portal (per-chain wallet-as-identity, level-gated KYC, wallet kit architecture, workflow-based deposit/redeem)

**Cross-cutting (consulted by every surface):**

- [`docs/architecture/compliance.md`](docs/architecture/compliance.md) — Account types, verification levels, risk classification, transaction limits, capability matrix, regulatory-pause primitive
- [`docs/architecture/reliability.md`](docs/architecture/reliability.md) — Reconciliation, idempotency, workflow durability, audit log integrity, NAV safety
- [`docs/architecture/regulatory.md`](docs/architecture/regulatory.md) — Brazilian regulatory floor (LGPD, CVM 175, BCB 519/2025)
- [`docs/architecture/security.md`](docs/architecture/security.md) — Secrets and PII crypto: threat model, asset inventory, two-key envelope + hash sidecar, key management lifecycle. Consult before adding a new PII field or a new env-derived secret.
- [`docs/architecture/onchain-integration.md`](docs/architecture/onchain-integration.md) — Chain ↔ Convex boundary (per-chain indexer modules, contract topology, external integrations) — shared by admin observability and investor data

**Architecture decisions:**

- [`docs/architecture/decisions/`](docs/architecture/decisions/) — Numbered ADRs. Read before reopening a decided question.

**Pending decisions:**

- [`docs/architecture/pending-treasury-decisions.md`](docs/architecture/pending-treasury-decisions.md) — Three open treasury policy decisions awaiting Draau input (NAV policy, deposit pricing, Pix quarantine window)

Implementation-level concerns live alongside: [`docs/auth.md`](docs/auth.md) (Convex function wrappers), [`docs/stellar-anchors.md`](docs/stellar-anchors.md) (anchor SEP integration), [`docs/key-management-guide.md`](docs/key-management-guide.md) (hands-on key handling — read before touching `process.env` or adding a new secret), [`docs/test-personas.md`](docs/test-personas.md) (pre-provisioned Auth0 dev accounts for testing each user state). When adding a new surface or domain, update the README catalogs before writing code. When adding a new public mutation that touches funds or accounts, consult [`docs/architecture/compliance.md`](docs/architecture/compliance.md) for the gating contract.

### Test accounts (dev tenant only)

Four pre-provisioned Auth0 personas for testing each user state. **Dev tenant only** (`dev-ay46ib0hhi1mdwpw.us.auth0.com` — localhost, Vercel previews, `mutav-app.vercel.app`); invalidated when the `mutav-prod` tenant is cut (#119). All share password **`MutavDev2026!`**, all `email_verified`. Full details + reseed/rotation in [`docs/test-personas.md`](docs/test-personas.md); persona↔subject binding lives in `convex/seed.ts`.

| Persona                   | Email                       | Seeded state               | Lands on                                |
| ------------------------- | --------------------------- | -------------------------- | --------------------------------------- |
| System admin (Mutav team) | `systemadmin@mutav.finance` | `isStaff: true`, no agency | `/onboarding`                           |
| Agency owner              | `agencyowner@mutav.finance` | active agency              | `/` (dashboard)                         |
| Pending user              | `pendinguser@mutav.finance` | under_review agency        | `/onboarding/status?state=under_review` |
| New user                  | `newuser@mutav.finance`     | none                       | `/onboarding`                           |

Full reseed (wipe + fictional dataset + all personas + agencyowner's book): `bun run seed` (`convex run seed:seedReset`). Personas only (idempotent, no wipe): `bunx convex run seed:seedTestPersonas`. First-time setup, env, and reseed scenarios: [`docs/development.md`](docs/development.md).

## Stellar concepts

Mutav settles guarantees on Stellar and moves BRL ↔ token via anchors. Before touching anchor code, read the in-repo docs:

- [`docs/stellar-anchors.md`](docs/stellar-anchors.md) — what an anchor is, which SEPs Mutav uses (SEP-1, 10, 12, 6, 24, 31, 38), how a Pix on-ramp flows end-to-end
- [`apps/agency/src/lib/anchors/README.md`](apps/agency/src/lib/anchors/README.md) — the foundation library: when to use the SEP modules vs the `Anchor` interface, how to implement a new provider client
- [`apps/agency/src/lib/anchors/sep/README.md`](apps/agency/src/lib/anchors/sep/README.md) — per-SEP API reference for the framework-agnostic protocol modules
- [`apps/agency/src/lib/anchors/testanchor/README.md`](apps/agency/src/lib/anchors/testanchor/README.md) — reference SEP client composed against `testanchor.stellar.org`; copy this as the starting point for a new SEP-compliant client
- [`apps/agency/src/lib/anchors/registry.ts`](apps/agency/src/lib/anchors/registry.ts) — single source of truth for which providers Mutav supports; **always resolve anchor clients through here**, never import a provider client directly outside the library
- [`convex/payments/providers/`](convex/payments/providers/) — Convex domain that wraps the registry: `getProviderForAgency` (per-agency provider lookup, currently a stub) + `discoverCapabilities` action (uses the registry end-to-end). Stellar anchors are one provider kind under the settlement (`payments`) domain.

### Installed expert skills

The official [`stellar/stellar-dev-skill`](https://github.com/stellar/stellar-dev-skill) is installed at project scope. Seven sub-skills auto-trigger on Stellar prompts — invoke explicitly via the Skill tool when in doubt:

| Skill              | Use for                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| `standards`        | Picking the right SEP/CAP — anchor flows (SEP-1/6/10/12/24/31), token interfaces  |
| `dapp`             | Frontend stellar-sdk, Freighter, Stellar Wallets Kit, smart accounts, signing     |
| `data`             | Stellar RPC (preferred) and Horizon (legacy) for balances, transactions, indexing |
| `assets`           | Stellar Assets, trustlines, SAC bridge — issuance, regulated assets               |
| `soroban`          | Rust smart-contract dev, testing, security patterns                               |
| `agentic-payments` | x402 + MPP for machine/agent payments                                             |
| `zk-proofs`        | BLS12-381 / BN254 / Poseidon ZK verification                                      |

### External references

When the in-repo docs and skills aren't enough, consult:

- [Stellar Developer Docs](https://developers.stellar.org) — canonical reference; the [`llms.txt`](https://developers.stellar.org/llms.txt) is a flat dump optimized for LLM context
- [SEPs index](https://github.com/stellar/stellar-protocol/tree/master/ecosystem) — authoritative source of truth for protocol status (the skill is a routing map only)
- [CAPs index](https://github.com/stellar/stellar-protocol/tree/master/core) — Core Advancement Proposals (Soroban runtime, cryptography)
- [Stellar Anchor Directory](https://anchors.stellar.org/) — live list of operating anchors per region; check before committing to a provider
- [Anchor Platform docs](https://developers.stellar.org/docs/platforms/anchor-platform) — SDF's reference implementation for running an anchor server (useful as a spec for what we consume)
- [Building with AI](https://developers.stellar.org/docs/build/building-with-ai) — SDF's guide to AI-assisted Stellar dev; lists the skill, llms.txt, and Stella
- **Stella AI** — yellow chat icon on developers.stellar.org for interactive Q&A; or `#stella-help` on the [Stellar Discord](https://discord.gg/stellar)

## Stack

- Turborepo monorepo — persona apps under `apps/*`, shared code under `packages/*`, Convex backend at the repo root in `convex/` (see [§ Monorepo layout](#monorepo-layout))
- Next.js 16 (App Router, `src/` directory **per app**, e.g. `apps/agency/src/app/`)
- Tailwind CSS 4 — workspace packages need `@source` (see [Tailwind 4 + workspace packages](#tailwind-4--workspace-packages))
- shadcn/ui (radix-nova style, neutral base color, MUTAV tokens in each app's `src/app/globals.css`)
- Convex — backend (functions in `convex/`, root-level, shared by every app)
- Railway / Vercel — deployment (one project per app)

> Stellar wallet connection: removed pending a vetted, low-CVE replacement.
> Earlier `@creit.tech/stellar-wallets-kit` pulled in 9 critical vulns via
> Trezor/Hot/NEAR adapters we never invoked.

## Architecture

### Monorepo layout

Turborepo workspace (`workspaces: ["apps/*", "packages/*"]`). One Next.js app per audience, each deployed to its own origin; the Convex backend is **shared and lives at the repo root**, not inside any app.

```
mutav-app/
├── apps/
│   ├── agency/      # app.mutav.finance  — agency dashboard (Auth0, agency membership)
│   ├── pay/         # pay.mutav.finance  — tenant payment (no Auth0; publicId bearer)
│   ├── fund/        # fund.mutav.finance — investor portal (wallet-as-identity)
│   └── admin/       # admin.mutav.finance — Mutav staff console (Auth0 mutavStaff connection)
├── packages/
│   ├── ui/          # @mutav/ui     — shadcn primitives, page primitives, cn, theme provider
│   ├── i18n/        # @mutav/i18n   — next-intl routing/navigation, cross-app URLs, Brazil formatters
│   ├── app-shell/   # @mutav/app-shell — shared Convex providers (Auth0-backed + public)
│   ├── wallet/      # @mutav/wallet — wallet-kit integration (in progress)
│   └── tsconfig/    # @mutav/tsconfig — shared TS base configs
└── convex/          # Mutav API — shared backend (functions, schema, generated types)
```

**Dependency rule:** apps depend on `packages/*` (never the reverse), and `packages/*` never depend on `apps/*`. Third-party deps are pinned **once at the root** `package.json` (single-version policy) and hoisted; apps/packages declare only `@mutav/*` workspace deps plus their own peers. Packages export per-file subpaths (`@mutav/ui/button`, `@mutav/i18n/brazil`) — **no barrel files**. A package consumed by an app must be listed in that app's `next.config.ts` `transpilePackages`.

**What's shared vs app-local:** truly cross-app code (UI primitives, locale/region utilities, the Convex provider bridge) lives in `packages/*`. App-specific shells, route groups, env getters, and providers stay in each app's `src/`. When you find yourself copy-pasting a file between two apps, that's the signal to promote it to a package — see how `cn`/`theme` landed in `@mutav/ui`, `cross-app`/`brazil` in `@mutav/i18n`, and the Convex providers in `@mutav/app-shell`.

### App Router structure (per app)

Each app's Next.js App Router pages live under `apps/<app>/src/app/[locale]/...`. The `[locale]` segment is consumed by next-intl. Route groups scope the guard and the shell (`(app)` agency dashboard, `(admin)` staff console, `(investor)` fund portal, `(onboarding)` agency signup; `apps/pay` needs no group — its whole tree is one flow).

```
apps/agency/src/app/
├── global-not-found.tsx        # <BareShell> + its own <html>/<body> — unmatched URLs
├── [locale]/
│   ├── layout.tsx              # root layout: <html>/<body>, fonts, NextIntlClientProvider
│   ├── not-found.tsx           # <BareShell> — notFound() thrown under [locale]
│   └── (app)/                  # dashboard route group
│       ├── layout.tsx          # guard + <AppShell>, nav passed as props
│       └── contracts/
│           └── [id]/
│               ├── page.tsx
│               └── error.tsx
```

#### Which shell a new route gets

Three shells live in `@mutav/ui/shell/*`. **The route picks the shell; auth state only fills the `identity` slot** — never select a shell at request time. Full rationale in [`docs/architecture/nav-shell-audit.md`](docs/architecture/nav-shell-audit.md) § 4 (D1–D6).

| Shell         | Import                       | Use when the route…                       | Today                                              |
| ------------- | ---------------------------- | ----------------------------------------- | -------------------------------------------------- |
| `<AppShell>`  | `@mutav/ui/shell/app-shell`  | is behind a nav a signed-in user lives in | `agency/(app)`, `admin/(admin)`                    |
| `<FlowShell>` | `@mutav/ui/shell/flow-shell` | is a multi-step flow — brand, no nav      | `agency/(onboarding)`, `pay/pay/[publicId]`        |
| `<BareShell>` | `@mutav/ui/shell/bare-shell` | is a terminal state — brand + a way out   | `admin/access-denied`, both 404 files in every app |

Rules the gates enforce:

- **Exactly one shell per rendered route**, mounted in the route-group `layout.tsx` (a page mounts its own only when no ancestor layout has one — `admin/access-denied`). The `[locale]/layout.tsx` root layout never mounts a shell.
- **`layout.tsx`, `template.tsx`, and `default.tsx` are all route wrappers** and are held to the same rules — a template wraps every page in its segment exactly like a layout, so chrome hiding in one is a second shell in disguise.
- **Extracting chrome into `src/components/` does not launder it.** A component rendered as a _child_ of the shell must not hand-roll `<header>`/`<nav>`/`<aside>`/`<footer>`; chrome reaches the shell through a slot prop or not at all. `bun run test:structure` follows a wrapper's app-local child components one hop.
- **Two 404 files per app, both BareShell.** `app/global-not-found.tsx` (app-dir root, behind `experimental.globalNotFound`) catches URLs that match no route, owns its own `<html>`/`<body>`/font/`NextIntlClientProvider`, and is the **only** 404 that server-renders. `[locale]/not-found.tsx` is the `notFound()` boundary — real, but its UI arrives in the RSC payload and paints on hydration, and `admin`/`fund` have no `notFound()` call site to reach it yet. `not-found.tsx` belongs at `[locale]/` and nowhere else: nested it renders inside its group's sidebar, and at the app-dir root Next has no root layout to wrap it in (these apps' root layout is `[locale]/layout.tsx`) so it gets a builtin bare document. Measurements + why a `loading.tsx` does not change this: nav-shell-audit § 5.
- **Never import `@mutav/ui/sidebar`, `@mutav/ui/public/public-shell`, or `@mutav/ui/sonner` from `src/app/**`** — the shells compose those. Nav definitions stay app-local and arrive as props (`nav`, `identity`, `sidebarHeader`, `headerEnd`, `footer`, `context`). App-local nav components under `src/components/\*\*` import the sidebar primitives freely.
- **`apps/pay` carries no Auth0 SDK** — its identity slot is empty for every viewer.
- `fund/(investor)` is a tracked exemption (top-bar arrangement, unresolved palette/scroll ownership) — see nav-shell-audit § 7.

Gates: `bun run test:structure` (`tests/shell-contract.test.ts` — the only check that detects a _missing_ shell) and the `no-restricted-imports` / `no-restricted-syntax` blocks in `eslint.config.mjs`. Both run in the `conventions` / `lint` jobs of `.github/workflows/quality.yml`. Advisory feedback at write time: `.claude/hooks/shell-contract.js`.

### Folder responsibilities

Paths below are **relative to each app** (`apps/<app>/`), except `convex/` and `packages/` which are repo-root.

| Path                      | Holds                                                                          | Does NOT hold                                    |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `src/app/`                | Next.js route files (`page.tsx`, `layout.tsx`, `error.tsx`, `loading.tsx`)     | Reusable components, business logic              |
| `src/components/`         | Feature components (organized by domain)                                       | Page-only logic, server code, shared primitives  |
| `src/hooks/`              | Reusable client hooks (data fetching, view models if shared across components) | Convex queries (those import via api directly)   |
| `src/providers/`          | App-local React providers + thin wrappers over `packages/*` providers          | Pure utilities, cross-app providers              |
| `src/lib/`                | App-local cross-cutting utilities (e.g. `env.ts`, `result.ts`)                 | Cross-app code (promote to a package), UI        |
| `src/i18n/`               | next-intl `request` config (imports routing/navigation from `@mutav/i18n`)     | Message strings (those live in `messages/`)      |
| `messages/`               | `pt-BR.json`, `en.json` — namespaced i18n strings, **per app**                 | Component-scoped strings (use `useTranslations`) |
| `packages/ui/src/`        | shadcn primitives, page primitives (`@mutav/ui/page/*`), `cn`, theme provider  | App-specific components, domain logic            |
| `packages/i18n/src/`      | next-intl routing/navigation, `cross-app`, Brazil formatters (`brazil`)        | Message strings, UI                              |
| `packages/app-shell/src/` | Shared Convex client providers (Auth0-backed + public variants)                | App env reads (passed in as props)               |
| `convex/`                 | Convex backend functions, schema, generated types (root, shared)               | Client code, UI                                  |
| `convex/lib/`             | Convex-side shared utilities (validators, custom function wrappers)            | Domain-specific business rules                   |

**Promotion rule:** types and helpers used in only one domain belong in that domain; code copy-pasted across apps belongs in a `packages/*` package. Promote only when genuinely cross-cutting.

### Convex backend organization

The backend uses domain folders. Target shape:

```
convex/
├── _generated/                 # codegen — never edit
├── schema.ts                   # all tables; validators used here are local
├── lib/                        # cross-domain utilities (custom function wrappers, env, etc.)
└── {domain}/
    ├── domain.ts               # Doc<>/Id<> aliases, value objects, validators
    ├── useCases.ts             # queries + mutations + internal functions (V8)
    └── actions.ts              # 'use node' integrations (HTTP, Buffer, crypto)
```

**Migration trigger:** the moment a flat file gains a second function (or the first non-trivial one), move it to a domain folder. Don't let `convex/contracts.ts` keep growing past 100 lines — promote to `convex/contracts/{domain.ts,useCases.ts}` immediately.

The `domain.ts` rule: never use raw `Doc<'tableName'>` or `Id<'tableName'>` outside the entity file — export aliases (e.g. `Contract`, `ContractId`) and import those everywhere else. See `convex-document-types` skill for the full rules.

### Schema changes & migrations — reseed-first (pre-production)

**The app is pre-production: there is no real data. So schema changes ship as wipe + reseed, NOT in-place migrations.** When you change the schema:

- **Do NOT write a data migration.** Update `convex/schema.ts` and update `convex/seed.ts` so `seed:seedReset` produces data in the new shape. Reshape the seed, not the data at rest.
- **The reseed wipe is app-demo-only — never touch marketing or other real data.** `seedReset` clears only `DEMO_TABLES` (agencies, users, memberships, contracts, contractHistory, tenants, invoices, payments, providerOrders). It must **never** wipe the **`waitlist`** table (marketing leads synced to Resend audiences), nor `mutavAuditLog`/`mutavAuditAnchors`, `mutavStaff`, `reserveSnapshots`, or `creditAnalysis*`. These hold real/operational data, are deliberately excluded from `DEMO_TABLES`, and a `convex/seed.test.ts` test asserts a `waitlist` row survives a reseed. Never add them to the wipe.
- `convex/migrations.ts` stays a **no-op runner** (`runAll = [noop]`); leave the migration infrastructure in place but empty. Operational backfills (aggregate rebuild, Resend audience sync, reserve snapshot clear) are **not** migrations and stay out of the runner.
- `schemaValidation: false` is intentional for this window — a deploy tolerates older data at rest until the operator reseeds (`bun run seed`). Don't flip it to `true` yet.
- Deploy runbook: `convex deploy` → `bun run seed`. Never assume in-place data preservation.

**This inverts once the first real (non-seed) data reaches the app.** From that point: switch to in-place migrations (widen → migrate → narrow, two PRs — the `schemaValidation` toggle pattern), add each `internal.migrations.<name>` to `runAll` (auto-run by `scripts/run-migrations.sh` on deploy), and re-enable strict `schemaValidation`. The full policy note lives at the top of `convex/migrations.ts`.

### Layout primitives

Every page wraps content in three composable primitives from `@mutav/ui/page/*` (`page-shell`, `page-header`, `page-content`). **Don't roll a custom page wrapper** — extend the primitives if your case doesn't fit.

- **`<PageShell>`** — outer 3-level wrapper. Provides `@container/main` and the project's vertical rhythm (`gap-4 md:gap-6`, `py-4 md:py-6`). Always wraps the entire page.
- **`<PageHeader title subtitle? variant? width? breadcrumb? actions? />`** — title row with two typography variants:
  - `variant="section"` (default, `text-xl`) — list / dashboard pages
  - `variant="hero"` (`text-3xl`) — detail pages with a single primary subject
  - `width="narrow"` aligns the header column with `<PageContent variant="narrow">` below it
- **`<PageContent variant="full" | "narrow" | "wide">`** — content area with width policy:
  - `full` (default) — no max-width, no horizontal padding; **children manage their own** (`px-4 lg:px-6`). For tables, dashboards, and other full-bleed-aware components.
  - `narrow` — `max-w-(--page-content-max-width)` (4xl, 56rem) with `px-4 lg:px-6`. For cards, forms, prose, detail pages.
  - `wide` — `max-w-(--page-wide-max-width)` (screen-2xl, 96rem) with `px-4 lg:px-6`. For wide tables that should still cap on ultra-wide screens.

Width tokens live in each app's `src/app/globals.css`:

```css
--page-content-max-width: 56rem; /* 4xl — narrow content */
--page-wide-max-width: 96rem; /* screen-2xl — wide content cap */
```

`--header-height` and `--sidebar-width` are **not** among them: `<AppShell>` declares both inline on its own `SidebarProvider`, so they exist only inside that shell. `h-(--header-height)` / `w-(--sidebar-width)` compile fine and collapse to nothing under `<FlowShell>` or `<BareShell>` — don't reach for them outside `AppShell`'s subtree.

**Patterns by page type:**

```tsx
// List / dashboard — full-bleed-aware children
<PageShell>
  <PageHeader title="Contratos" subtitle="..." />
  <PageContent variant="full">
    <ContractListTable />
  </PageContent>
</PageShell>

// Detail — narrow hero header + narrow card column
<PageShell>
  <PageHeader variant="hero" width="narrow" breadcrumb={<Breadcrumb />} title="..." />
  <PageContent variant="narrow">
    <SummaryCard />
    <RentalCard />
  </PageContent>
</PageShell>

// Loading / error mirror their page's variant inside <PageShell>.
```

If a new page doesn't fit any variant, that's a signal to add a variant — not to roll a one-off wrapper.

### Route segment files

Each Next.js route segment can declare conventional files. Use them at the segment that defines the natural error/loading scope — not piled into the root.

| File                   | Purpose                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `page.tsx`             | The route's UI                                                                                                   |
| `layout.tsx`           | Shared shell that wraps `page.tsx` + child segments; persists across navigation                                  |
| `loading.tsx`          | Suspense fallback while the segment loads — server component, no `"use client"`                                  |
| `error.tsx`            | Catches errors thrown in the segment — must be `"use client"`, receives `{ error, reset }`                       |
| `not-found.tsx`        | Renders when `notFound()` is called in this segment's subtree                                                    |
| `global-not-found.tsx` | App-dir root only. Renders for URLs that match no route; replaces the root layout, so it returns a full document |
| `global-error.tsx`     | Catches errors in the root `layout.tsx` itself — replaces the entire HTML                                        |

Co-locate the i18n keys these files use under a namespace that matches the segment (e.g. `contractDetails.errors` for `contracts/[id]/error.tsx`).

## Code style

Follow standard clean code principles, opinionated:

- **Semantic naming** — no `Helper`, `Util`, `Manager`, `Service` suffixes. Name by intent (`formatBRL` not `currencyHelper`).
- **Named constants over magic values** — `const RENT_MULTIPLIER_DEFAULT = 12` beats `12` in expressions.
- **Guard clauses over nesting** — early return for invariant violations; the happy path stays at the top indent level.
- **Object parameters over long argument lists** — three or more args, switch to `{ ... }`. Self-documenting and reorderable.
- **No boolean flag arguments** — split into named functions (`approveContract` / `rejectContract`, not `setContractStatus(id, approved)`).
- **No barrel files** — every import references the actual file path (`./Foo`, never `.` or `./index`).
- **No comments by default** — only add one when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader. Don't explain WHAT (well-named identifiers do that) and don't reference the current task or PR (that belongs in the PR description, not the code — comments rot, PRs don't).
- **English-only code identifiers** — all types, `as const` value objects, string literal enum values, DB field values, function/variable names, and i18n **keys** are English (American spelling: `canceled`, not `cancelled`). Portuguese belongs ONLY in `messages/pt-BR.json` **values**. When touching a page that uses PT literals in code, translate them in the same commit — never propagate PT into new code just because the surrounding UI has it. Pre-existing PT identifiers (e.g. `CONTRACT_STATUS = { ATIVO: "ativo", ... }`) are grandfathered — flag them but don't drive-by-rename unless the surrounding change makes it cheap.
- **TypeScript strict** — see Key Patterns / TypeScript escape hatches below.
- **Branch workflow** — feature branches → squash merge PRs to main. Commit subjects are commitlint-gated (`.husky/commit-msg`): lowercase `type(scope):`, **lowercase subject** (sentence-case / Start Case / PascalCase / UPPER all rejected), no trailing period, header ≤100 chars, and **every body and footer line ≤100 chars** (hard error — wrap bullets). Types: `build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test` — no `wip`. `pre-commit` runs a whole-monorepo `bun run typecheck` plus `eslint --fix --max-warnings=0` on staged files (one warning blocks the commit); `pre-push` runs `bun run changelog:validate` and refuses direct pushes to `main`.

## Key Patterns

### Result pattern

Domain operations return `Result<TData, TError>` from `@/lib/result` instead of throwing. Try/catch is acceptable only at external API boundaries (provider implementations, webhook handlers). Always return plain object literals — no helper functions.

```typescript
import type { Result } from "@/lib/result";

type CreateContractSuccessResult = { contractId: ContractId; status: ContractStatus };
type CreateContractErrorResult = { code: "INVALID_INPUT" | "DUPLICATE_CONTRACT" };

function createContract(
  args: CreateContractArgs,
): Result<CreateContractSuccessResult, CreateContractErrorResult> {
  if (!args.tenant.cpf) {
    return { success: false, error: { code: "INVALID_INPUT" }, message: "Tenant CPF is required" };
  }
  return { success: true, data: { contractId, status: "pendente" }, message: "Contract created" };
}
```

Always declare `Result<{Function}SuccessResult, {Function}ErrorResult>` explicitly so `result.data` and `result.error` narrow correctly. See `convex-functional-programming` skill for deeper rules.

### Auth & agency scoping

Every public Convex `query` / `mutation` that touches agency-scoped data **must** use a wrapper from `convex/lib/auth.ts`. Full spec: [`docs/auth.md`](docs/auth.md).

```typescript
import { mutationWithAgencyScope, queryWithAgencyScope, assertAgencyAccess } from "../lib/auth";

// Agency-scoped (the common case). Wrapper consumes agencyId, exposes
// ctx.user, ctx.membership, ctx.agencyId. Handler args do NOT redeclare agencyId.
export const cancelProposal = mutationWithAgencyScope({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    /* ctx.agencyId is guaranteed */
  },
});
```

Strict-compliance rule (enforced in review):

- **Default:** `queryWithAgencyScope` / `mutationWithAgencyScope` for any handler that filters or writes a resource scoped to one agency.
- **Resource-by-id exception:** when `agencyId` comes from a fetched resource rather than client args (e.g. `getByPublicId` on a deep-linkable URL), use bare `query` / `mutation` + inline `assertAgencyAccess(ctx, resource.agencyId)`. Reads should `try`/`catch` and return `null` to avoid leaking cross-agency existence; writes let the throw propagate.
- **Identity-only exception:** `queryWithAuth` / `mutationWithAuth` for handlers that don't have a natural agency (e.g. listing the current user's own agencies).
- **Internal writers (`internalMutation` / `internalQuery`):** no wrapper — auth was already enforced by the public caller.
- **Actions (`ActionCtx`):** no DB access for membership lookup; use `requireIdentity(ctx)` + an `internalQuery` for membership. Per-action wrappers may come later.
- **Calling wrapped functions from actions:** `ctx.runQuery(api.X.wrapped, …)` inherits the action's identity — fine when the action runs from an authenticated dashboard route, **broken post-Auth0** when the action runs from a tenant/public/webhook context. For those, route through an `internal.X.Y` companion (e.g. `invoices.getByIdInternal`, `contracts.getByPublicIdInternal`). When wrapping a new domain, grep `ctx\.runQuery(api\.<domain>\.` and fix every tenant-facing hit. See [`docs/auth.md`](docs/auth.md) for the full pattern.

### Convex import paths

The `@` alias is **not available** inside `convex/` files (Convex module resolver). Use relative paths for server-to-server imports:

```typescript
// Inside convex/contracts/useCases.ts
import { mutation, query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { contractStatusValidator } from "./domain";
```

Client code in an app uses the `@convex/...` alias (each app's tsconfig maps `@convex/*` → `../../convex/*`; `@/*` → that app's `./src/*`):

```typescript
// Inside apps/<app>/src/components/...
import { api } from "@convex/_generated/api";
```

### TypeScript escape hatches

Zero tolerance: never use `any`, `as Type`, `!` (non-null assertion), `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`. Use generics, type guards, `unknown` + Zod, discriminated unions, `?.`, `??`. **Boundary exception:** assertions at serialization edges (route params, external API responses, Convex deserialization) are acceptable when tagged inline with `// hook-ok: <reason>` (e.g. `// hook-ok: route param validated by loader`). The PreToolUse `code-quality` hook surfaces every other case as an advisory.

`as const` (narrowing) is allowed and encouraged for value objects — distinct from `as Type` (cast).

### Tailwind 4 + workspace packages

Tailwind 4 only scans the consuming project for class names. A utility used **only** inside a transpiled workspace package (e.g. `@mutav/ui`) silently compiles to nothing in the consumer's bundle — the element renders unstyled (no width/height/color/etc.). Each consuming app's `globals.css` must declare the package source explicitly:

```css
@source "../../../../packages/ui/src";
```

All four apps (`agency`, `admin`, `fund`, `pay`) already declare `@source "../../../../packages/ui/src"` in their `globals.css`. Add the same line for **any new workspace package that ships Tailwind classes** — and the moment an app first renders a primitive from such a package whose class set isn't already covered by app code. (`@mutav/app-shell` ships providers with no markup, so it needs no `@source`.)

### Environment variables

Never read `process.env` directly in domain code, components, or Convex functions. Centralize:

- **Server (Convex):** `convex/lib/env.ts` exports an eager `getEnv()` for non-secret config and lazy getter functions (e.g. `getResendApiKey()`) for secrets. Lazy access prevents Convex from flagging vars as required during deploy when they aren't actually called.
- **Client:** each app's `src/lib/env.ts` exports typed getters for `NEXT_PUBLIC_*` vars. Anything not prefixed `NEXT_PUBLIC_` is invisible to the browser bundle — don't try to read it from client code. Shared `packages/*` never read `process.env` — apps pass env values in (e.g. `@mutav/app-shell`'s Convex providers take `convexUrl`/`auth0Domain` as props).

Boundary exception: `convex/lib/env.ts` and each app's `src/lib/env.ts` are the only files allowed to touch `process.env` directly. If a caller needs a new env var, add a getter there.

### Validation at boundaries

Two validator systems coexist:

- **Convex `v.*` validators** — for `mutation` / `query` / `action` `args`. They live next to the entity (`convex/{domain}/domain.ts`) and pair with the Convex schema. Use `v.union(v.literal(...))` patterns for value objects.
- **Zod schemas** — for client-side parsing: form input (with React Hook Form once adopted), URL search params, route params at the boundary, and external API responses parsed via `z.parse()` / `z.safeParse()`.

The boundary: server-side speaks Convex `v`, client-side speaks Zod, generated types flow between them via `_generated/api`. Never reach for a third validator (joi, yup, ajv) — pick from these two.

### Server vs Client Components

Default to server. Add `"use client"` only when you need state, effects, browser APIs, event handlers, or a hook that requires it (most shadcn primitives, Convex `useQuery`).

Push the boundary down the tree — keep pages server-side, push interactivity to leaf components as client islands. The view-model pattern (`use{ComponentName}`) applies only inside client islands.

For Convex data, use `preloadQuery` (server) + `usePreloadedQuery` (client) from `convex/nextjs` so the server prerenders initial state and the client subscribes to live updates on the same query. Plain `useQuery` is for views with no SSR path (modals, popovers, conditional sections).

### Server Actions vs Convex mutations

All backend writes go through Convex mutations. Don't use Next.js Server Actions (`"use server"`) — they fragment backend logic across two RPC systems, break Convex's reactive update model, and add a testing surface that `convex-test` doesn't cover.

### React 19 async patterns

Never use the legacy promise-chain + `cancelled`-flag idiom inside `useEffect`. Two modern alternatives:

- **`useEffectEvent` + `useEffect`** — when an effect calls a function but should only re-run on data changes, isolate the function reference with `useEffectEvent`. The effect's dependency array declares only reactive values (e.g. `contractId`), not function references. Prevents unnecessary re-runs on parent re-renders.
- **`use()` + Suspense** — when an async result is the primary render data, lift the promise to the parent via `useMemo` and read it with `use()` in the child. No `useState`, no `useEffect`. Requires a `<Suspense>` boundary upstream.

For mutations and other stateful async ops, prefer a `useFunction`-style helper (deferred — see `.claude/notes/deferred-conventions.md`) over manual `useState` + `try/catch` once that lands.

### Testing

Runner: **Vitest** everywhere. Two flavors of test file per convex domain:

- **Pure logic** — `machine.test.ts`, `domain.test.ts`. No `convexTest(...)`. Default `node` env. Cover every branch of a state machine or value object; use `test.each` for the transition matrix. Canonical shape: `convex/delinquencies/machine.test.ts` (exhaustive 3×3 status matrix + self-transition + terminal-state rejection).
- **Scenario** — `scenarios.test.ts` (schema conformance, index coverage, cross-agency isolation; produced by the [`build-scenario-tests`](.claude/workflows/build-scenario-tests.js) workflow). Top of file: `// @vitest-environment edge-runtime`. Body: `const t = convexTest(schema); registerContractAggregateComponents(t);` (from `convex/lib/testFixtures.ts` — required or aggregate writes throw). Canonical shape: `convex/delinquencies/scenarios.test.ts`.
- **Scenario / db-backed** — `useCases.test.ts`, `seed.test.ts`. Same edge-runtime + `convexTest` harness as `scenarios.test.ts`; these cover the read/write surface (wrapper contract, pagination, staff-role gating) and the seed pipeline respectively. Canonical shape: `convex/seed.test.ts`.

**Commands (from repo root):**

- `bun run test:convex` — one-shot Convex suite; use before commits.
- `bun run test:convex:watch` — TDD loop.
- `bun run test:file <path>` — single file, e.g. `bun run test:file convex/delinquencies/machine.test.ts`.
- `bun run test` — full turbo run (each app runs its own vitest; convex tests run 4× as a safety net).

**Do NOT** run raw `bunx vitest` from a fresh shell — without config it fires `(intermediate value).glob is not a function` inside `convex-test`. Use the scripts above. See root [`vitest.config.ts`](vitest.config.ts) for why (`server.deps.inline: ["convex-test"]` + `resolve.preserveSymlinks: true`).

**Test hygiene:**

- One `describe` per unit under test; nested `describe`s only when the boundaries are semantic (e.g. "state machine constants" vs "assertTransition — illegal moves rejected").
- Expected values as literals in the test, not derived from the code under test (a broken implementation shouldn't produce a "correct" derived value that satisfies the test).
- Every Result-returning function gets both the happy-path and every distinct error `code` covered.
- Pure tests must run in **&lt;200ms per file**; if you're near that ceiling you're probably reaching for a db-backed test — move it to a `useCases.test.ts`.
- Seed tests must assert the `waitlist` row survives a reseed (existing regression guard in `convex/seed.test.ts`) — never wipe `waitlist`, `mutavAuditLog`, or `mutavStaff` in `DEMO_TABLES`.

### Domain-surface workflows

For any new convex domain, don't hand-roll the surface files. Three saved workflows in `.claude/workflows/` build them end-to-end (design → implement → 3-way adversarial verify → address gaps → tests). Each is opinionated about its output file, uses only pre-existing auth wrappers, and requires `bun run test:convex convex/<domain>/` all-green before returning.

| Workflow                                                                | Produces                                                             | When to use                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`build-scenario-tests`](.claude/workflows/build-scenario-tests.js)     | `convex/<domain>/scenarios.test.ts`                                  | After schema + seed land, before touching queries/mutations. Exhaustive db-layer coverage: schema conformance, every index, every value-object variant, cross-agency isolation via ctx.db.                              |
| [`build-domain-queries`](.claude/workflows/build-domain-queries.js)     | `convex/<domain>/useCases.ts` + `convex/<domain>/useCases.test.ts`   | Read-side. Verifier lenses: wrapper contract, index efficiency, return-shape stability. Test lens: wrapper enforcement + pagination + staff-role gating + null-on-miss.                                                 |
| [`build-domain-mutations`](.claude/workflows/build-domain-mutations.js) | `convex/<domain>/mutations.ts` + `convex/<domain>/mutations.test.ts` | Write-side. Verifier lenses: wrapper contract, machine composition (assertTransition-before-patch), audit + write safety. Test lens: happy paths + illegal transitions + auth failures + cross-agency + audit emission. |

Invocation shape (same for all three):

```
Workflow({
  name: 'build-domain-mutations',
  args: {
    domain: 'guarantees',                                     // required — convex/<domain>/
    contextNotes: 'What mutations to build, machine hints',   // strongly recommended
    // scenariosDocPath: '/abs/path.md',                      // build-scenario-tests only
  },
})
```

Only invoke when the caller opts into multi-agent orchestration (mentions "workflow" or "workflows" in the request). Workflow scripts run in a deterministic sandbox — `Date.now()` / `new Date()` / `Math.random()` are unavailable AND their literal tokens in prompt strings will trip the parser; use paraphrases like "current-time primitive" or "server-side timestamp" instead of embedding the call syntax.

## i18n (next-intl)

The app is bilingual: `pt-BR` (default) and `en`. Locale prefix is `as-needed` — default-locale URLs are unprefixed, English routes carry `/en/`.

### Message files

Strings live in `messages/{locale}.json` at project root, organized by namespace (`meta`, `common`, `nav`, `contractDetails`, etc.). Add new keys to **both** `pt-BR.json` and `en.json` in the same change — out-of-sync keys silently fall back to the key string at runtime.

### Reading messages

```tsx
// Client component
"use client";
import { useTranslations } from "next-intl";
const t = useTranslations("contractDetails.errors");
return <h1>{t("title")}</h1>;

// Server component
import { getTranslations } from "next-intl/server";
const t = await getTranslations("contractDetails.errors");
// or with explicit locale: getTranslations({ locale, namespace: 'meta' })
```

### Navigation

Use the wrappers from `@/i18n/navigation` — **never** import from `next/link` or `next/navigation` directly in app routes. The wrappers preserve the locale prefix automatically:

```tsx
import { Link, useRouter, usePathname, redirect } from "@/i18n/navigation";
```

### Server-derived error codes → message keys

When a Convex function returns `Result<TData, TError>` with a `code` field, map it to a localized message via dynamic key lookup:

```tsx
if (!result.success) {
  toast.error(t(`errors.${result.error.code}`));
}
```

Define error codes as `as const` value objects in the entity file (e.g. `CONTRACT_ERROR_CODE` in `convex/contracts/domain.ts`). Never display raw error messages from the server to users — only codes.

## Domain conventions (Brazil)

Mutav operates in Brazil. Convention choices:

- **Money** — store as **integer cents** (`v.number()` representing centavos). Field naming: suffix `Cents` (e.g. `rentCents`, `availableGuaranteeCents`). Float reais is a precision trap; cents is the industry-standard fix. Existing `*BRL: v.number()` fields predate this rule and need migration — see `.claude/notes/deferred-conventions.md`. Display via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)`.
- **CPF / CNPJ** — store as digits-only strings (CPF = 11 chars, CNPJ = 14 chars). Validate with proper checksum algorithms; never use regex alone. Format only at display time (`123.456.789-01`, `12.345.678/0001-90`).
- **Phone** — digits-only string (`+55` country code optional based on source). Format at display.
- **Dates** — stored as ISO 8601 strings (`v.string()`) when no time-zone arithmetic is needed (e.g. `nextRenewalDate`, `birthDate`). Use `v.number()` for unix timestamps when comparison/arithmetic matters. Don't store JS `Date` objects in Convex — they don't roundtrip.
- **Locale-aware formatting** — get the active locale from next-intl rather than hardcoding `pt-BR` in formatters meant to be language-agnostic.

## Skills

### Project skills (`.claude/skills/`)

Non-obvious trigger → skill mappings:

- Defining entity types or value objects derived from Convex schema (`Doc<>`, `Id<>`), validators, schema discriminated unions, or choosing between `.filter()` and composite indexes → `convex-document-types`
- Writing Convex queries/mutations/actions — pure-vs-impure separation, immutable updates, `Result<T>` returns → `convex-functional-programming`
- Building React page or feature components — pure rendering separated from logic via view model hooks → `react-component-view-model-pattern`
- Creating data fetching hooks — single-purpose hooks with no side effects → `react-hook-composition`

Plus the official Convex plugin skills (`convex-quickstart`, `convex-setup-auth`, `convex-create-component`, `convex-migration-helper`, `convex-performance-audit`) and Next.js skills (`next-best-practices`, `next-cache-components`, `next-upgrade`).

### Workflow (`superpowers:*`)

For any non-trivial change, lean on the `superpowers:*` skill family. These define _how_ to work, not _what_ to build:

| Phase   | Skill                                        | When                                                                                           |
| ------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Explore | `superpowers:brainstorming`                  | Before any creative work — new feature, component, or behavior change                          |
| Plan    | `superpowers:writing-plans`                  | Multi-step tasks where the path matters more than any single edit                              |
| Execute | `superpowers:executing-plans`                | Run a written plan in a fresh session with review checkpoints                                  |
| Debug   | `superpowers:systematic-debugging`           | Any bug, test failure, or unexpected behavior — before proposing a fix                         |
| Verify  | `superpowers:verification-before-completion` | Before claiming work is complete — evidence required; rendered output needs a fetch, see below |
| Review  | `superpowers:requesting-code-review`         | Before merging or after a major feature                                                        |
| Isolate | `superpowers:using-git-worktrees`            | Any parallel dispatch where an agent writes — see One writer per working tree                  |

**Behavioral verification.** `typecheck`, `lint`, `test:structure` and `build` prove a change _compiles_, never that it _renders_ — Tailwind classes that vanish and CSS-var arbitrary values compile clean (§ Tailwind 4 + workspace packages). A change under `src/app/**`, `src/components/**`, or `packages/ui/**` is not verified until the changed route was served: request it (agency `3000`, pay `3001`, fund `3002`, admin `3003`; `pt-BR` is unprefixed) and quote HTTP status **plus a string from the rendered HTML**, or a screenshot path (`.claude/skills/webapp-testing`). "Files exist, imports correct, exit 0" is structural evidence and does not satisfy this. For auth-gated routes log in as a persona (§ Test accounts) or say plainly that the check stopped at the Auth0 redirect. **A verifying subagent that never fetched a URL reports `structure only`, not `pass`.**

**One writer per working tree.** Agents run in parallel in the same tree only when _all_ of them are read-only. The moment one writes files, runs a build, or plants fixtures, it gets its own worktree under `.claude/worktrees/<name>` (then `bun install` inside it — workspace symlinks don't carry over). Planted-violation verifiers are the sharpest case: a file created to prove a gate fires is compiled into a sibling's build and leaves stale `.next/`, `tsconfig.tsbuildinfo`, and `convex/_generated/` behind, so the sibling fails for reasons unrelated to its change. Such a run ends with `git status --porcelain` empty, and the next turbo run in that tree passes `--force` (see the stale-cache-across-worktrees row in [`docs/development.md`](docs/development.md) § Troubleshooting).

Default to invoking via the Skill tool rather than relying on memory of past patterns — skills evolve. Load a skill's `SKILL.md` first; skills here ship without supplementary `examples.md`/`reference.md`/`template.md`, so add those only when the patterns merit deeper material.

### Domain design

Each Convex domain folder (`convex/{domain}/`) is a bounded context. Keep the boundaries tight:

**One concern per domain**

| Domain       | Owns                                                                 | Does NOT own                                                |
| ------------ | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `users/`     | Identity, profile, user resolution                                   | Roles, org membership, auth tokens                          |
| `agencies/`  | Organization data, membership, roles                                 | User profile fields, contract data                          |
| `contracts/` | Rental lifecycle, documents, tenant, history                         | Payment state, agency billing                               |
| `invoices/`  | Invoice lifecycle (the bill), line items, status (`overdue` derived) | Settlement/payment processing, contract status, tenant info |

When a query needs data from two domains (e.g. membership + user info), the enrichment belongs in the domain that drives the use case — `agencies/useCases.ts` enriches membership rows with user data because the agency domain drives the members list. The user domain does not reach into memberships.

**`domain.ts` is the type source of truth**

- Export `Doc<'tableName'>` and `Id<'tableName'>` aliases (`User`, `UserId`) — never use raw generics outside the entity file.
- Export value-object constants (`MEMBER_ROLE`, `CONTRACT_STATUS`) as `as const satisfies Record<...>` — keyof safety with literal inference.
- Export Convex `v.*` validators (`memberRoleValidator`) alongside the constants — one import gets both the type and the validator.
- Export domain helpers that encode business rules (`hasRole`, `isActiveContract`) — single place, no duplication.

**`useCases.ts` is the query/mutation anti-corruption layer**

- Every function must use an index — no `.filter()` (full table scans in Convex).
- `shape*` helpers inside `useCases.ts` define the projection between the DB schema and the UI. Name them `shapeContractSummary` / `shapeContract` etc. — not generic names like `toDTO`.
- Public handlers must use the auth wrappers from `convex/lib/auth.ts` — see Key Patterns / Auth & agency scoping and [`docs/auth.md`](docs/auth.md). Resolved `ctx.user`, `ctx.membership`, and `ctx.agencyId` come from the wrapper; do not hand-roll identity or membership lookups in handlers.

**Workspace / multi-tenancy**

- Every resource table carries `agencyId` — all scoped queries use the `by_agency_*` composite index.
- `WorkspaceContext` (`apps/agency/src/providers/workspace.tsx`) is the agency frontend's single source of `selectedAgencyId`. All list queries receive it as an argument — never read `localStorage` directly from a component.
- Server side, the auth wrappers in `convex/lib/auth.ts` resolve identity via `ctx.auth.getUserIdentity()` and assert membership; handlers do not re-check (see [`docs/auth.md`](docs/auth.md)).

### Deferred conventions

Auth wrappers, shared `useQuery`, React Hook Form + shadcn Field, server domain providers, and Convex workpool are tracked in `.claude/notes/deferred-conventions.md` with adoption triggers. Pending refactors (e.g. money → cents migration) live in the same file.

## Changelog — sync-action runbook

`changelog/pending/*.md` is a minimal per-branch runbook: **branch, category, one-line summary, and the mechanical `sync_actions[]`** (env / install / seed / migrate / run / manual) — that's the whole schema. Frontmatter only, no body.

Draft one via `bun run changelog:draft`. The drafter reads the diff + commits + optional PR title and writes the entry mechanically. Filesystem-signal detectors in `signals.ts` emit `sync_actions[]` deterministically — nobody has to remember to write "and run `bun run seed`."

**The two consumers of the entry today:**

- **`.husky/post-merge`** prints a compact banner to Draau on every `git pull`, listing `sync_actions[]` from entries that landed since his last pull. This is the load-bearing feature — it's how a schema-shape PR translates into "run `bun run seed`" showing up in his terminal automatically.
- **`.claude/hooks/changelog-sync-notice.js`** injects the same list into every agent's first turn as SessionStart context.

**Scope discipline (this is a start-small pilot):**

- No body sections. The 3-months-later "why" narrative was aspirational and got cut. If entries prove valuable enough to warrant it, we add a body back.
- No PR-blocking sensor. The pre-push hook validates schema shape only; it does not require an entry per PR. If entries get skipped and Draau starts missing sync steps, we add enforcement.
- No release aggregation. There is no versioned-release ritual on this repo today.

Full spec: [`docs/architecture/changelog.md`](docs/architecture/changelog.md).

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
