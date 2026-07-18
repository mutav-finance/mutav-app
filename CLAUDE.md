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

Each app's Next.js App Router pages live under `apps/<app>/src/app/[locale]/...`. The `[locale]` segment is consumed by next-intl. Route groups name the shell (`(app)` for the agency dashboard, `(admin)` for the staff console, `(public)` for tenant payment, `(investor)` for the fund portal).

```
apps/agency/src/app/
├── [locale]/
│   ├── layout.tsx              # root layout, locale-aware metadata
│   └── (app)/                  # dashboard route group
│       ├── layout.tsx          # sidebar + header shell
│       └── contracts/
│           └── [id]/
│               ├── page.tsx
│               └── error.tsx
```

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

Width tokens live in each app's `src/app/globals.css` alongside `--header-height` and `--sidebar-width`:

```css
--page-content-max-width: 56rem; /* 4xl — narrow content */
--page-wide-max-width: 96rem; /* screen-2xl — wide content cap */
```

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

| File               | Purpose                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `page.tsx`         | The route's UI                                                                             |
| `layout.tsx`       | Shared shell that wraps `page.tsx` + child segments; persists across navigation            |
| `loading.tsx`      | Suspense fallback while the segment loads — server component, no `"use client"`            |
| `error.tsx`        | Catches errors thrown in the segment — must be `"use client"`, receives `{ error, reset }` |
| `not-found.tsx`    | Renders when `notFound()` is called or a dynamic segment doesn't match                     |
| `global-error.tsx` | Catches errors in the root `layout.tsx` itself — replaces the entire HTML                  |

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
- **TypeScript strict** — see Key Patterns / TypeScript escape hatches below.
- **Branch workflow** — feature branches → squash merge PRs to main.

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

Pre-Auth0, `resolveCurrentUser` looks up the hardcoded `dev-user` row. When Auth0 lands, that one function in `convex/lib/auth.ts` swaps to `ctx.auth.getUserIdentity()` and every wrapped handler migrates at once. Do not add per-handler auth shims that would need to be undone on the swap.

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

| Phase   | Skill                                        | When                                                                      |
| ------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| Explore | `superpowers:brainstorming`                  | Before any creative work — new feature, component, or behavior change     |
| Plan    | `superpowers:writing-plans`                  | Multi-step tasks where the path matters more than any single edit         |
| Execute | `superpowers:executing-plans`                | Run a written plan in a fresh session with review checkpoints             |
| Debug   | `superpowers:systematic-debugging`           | Any bug, test failure, or unexpected behavior — before proposing a fix    |
| Verify  | `superpowers:verification-before-completion` | Before claiming work is complete — evidence (test runs, build) required   |
| Review  | `superpowers:requesting-code-review`         | Before merging or after a major feature                                   |
| Isolate | `superpowers:using-git-worktrees`            | When the work needs an isolated tree (long-running branches, experiments) |

Default to invoking via the Skill tool rather than relying on memory of past patterns — skills evolve.

### Progressive loading

Load `SKILL.md` first via the Skill tool. Skills currently ship without supplementary `examples.md`/`reference.md`/`template.md`; add them only when the patterns merit deeper material.

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
- Server side, the auth wrappers in `convex/lib/auth.ts` resolve identity and assert membership; handlers do not re-check. Pre-Auth0 the wrappers fall back to a hardcoded `dev-user` row, mirroring `DEV_USER_PUBLIC_ID` on the client. The Auth0 swap is a single function in `convex/lib/auth.ts` (see [`docs/auth.md`](docs/auth.md)) plus removing `DEV_USER_PUBLIC_ID` from `workspace.tsx` — no per-handler edits.

### Deferred conventions

Auth wrappers, shared `useQuery`, React Hook Form + shadcn Field, server domain providers, and Convex workpool are tracked in `.claude/notes/deferred-conventions.md` with adoption triggers. Pending refactors (e.g. money → cents migration) live in the same file.

## Changelog — mandatory pre-work read

Before starting non-trivial work in a domain, scan `changelog/pending/*.md` for entries whose `touched_domains` or `scopes` intersect your target files. These entries carry the "why" behind recent changes that `git log` alone can't reveal — they exist specifically to prevent you from operating on stale assumptions.

**Every non-trivial PR MUST land a changelog entry.** The `.husky/pre-push` gate and the `changelog-required.js` PreToolUse hook block `gh pr create` when the entry is missing. Draft one via `bun run changelog:draft` — it inspects the diff, commits, and `.env.example`/`package.json`/`convex/*` signals and writes a complete `changelog/pending/YYYY-MM-DD-<slug>.md`. No human confirmation is required; the sensor validates schema on the next hook fire.

**Sync actions** (`sync_actions[].kind`) are the runbook everyone needs on `git pull`. When your PR adds an env var, a seed dependency, or a manual step, the draft script emits the corresponding `sync_actions` entry — do not hand-strip them.

Released entries live on **GitHub Releases** (`gh release list`), tagged by SemVer. Pending entries are cleared into the release on `bun run changelog:release`.

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
