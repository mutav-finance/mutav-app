@AGENTS.md

# Mutav — Agent Context

## Project

Mutav — dashboard for managing rental guarantees across chains.

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

## Stellar concepts

Mutav settles guarantees on Stellar and moves BRL ↔ token via anchors. Before touching anchor code, read the in-repo docs:

- [`docs/stellar-anchors.md`](docs/stellar-anchors.md) — what an anchor is, which SEPs Mutav uses (SEP-1, 10, 12, 6, 24, 31, 38), how a Pix on-ramp flows end-to-end
- [`src/lib/anchors/README.md`](src/lib/anchors/README.md) — the foundation library: when to use the SEP modules vs the `Anchor` interface, how to implement a new provider client
- [`src/lib/anchors/sep/README.md`](src/lib/anchors/sep/README.md) — per-SEP API reference for the framework-agnostic protocol modules
- [`src/lib/anchors/testanchor/README.md`](src/lib/anchors/testanchor/README.md) — reference SEP client composed against `testanchor.stellar.org`; copy this as the starting point for a new SEP-compliant client
- [`src/lib/anchors/registry.ts`](src/lib/anchors/registry.ts) — single source of truth for which providers Mutav supports; **always resolve anchor clients through here**, never import a provider client directly outside the library
- [`convex/anchors/`](convex/anchors/) — Convex domain that wraps the registry: `getProviderForAgency` (per-agency provider lookup, currently a stub) + `discoverCapabilities` action (uses the registry end-to-end)

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

- Next.js 16 (App Router, src/ directory)
- Tailwind CSS 4
- shadcn/ui (radix-nova style, neutral base color, TGA tokens in `src/app/globals.css`)
- Convex — backend (functions in convex/)
- Railway — deployment

> Stellar wallet connection: removed pending a vetted, low-CVE replacement.
> Earlier `@creit.tech/stellar-wallets-kit` pulled in 9 critical vulns via
> Trezor/Hot/NEAR adapters we never invoked.

## Architecture

### App Router structure

Next.js App Router pages live under `src/app/[locale]/...`. The `[locale]` segment is consumed by next-intl. The `(app)` route group holds authenticated dashboard routes.

```
src/app/
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

| Path                 | Holds                                                                          | Does NOT hold                                    |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `src/app/`           | Next.js route files (`page.tsx`, `layout.tsx`, `error.tsx`, `loading.tsx`)     | Reusable components, business logic              |
| `src/components/`    | Feature components (organized by domain) + `components/ui/` for shadcn         | Page-only logic, server code                     |
| `src/components/ui/` | shadcn primitives — generated, edit only when extending the registry           | Domain components                                |
| `src/hooks/`         | Reusable client hooks (data fetching, view models if shared across components) | Convex queries (those import via api directly)   |
| `src/providers/`     | Client React providers (Convex, theme, etc.)                                   | Pure utilities                                   |
| `src/lib/`           | Cross-cutting utilities used by both client and server (e.g. `result.ts`)      | UI components, Convex functions                  |
| `src/i18n/`          | next-intl `routing`, `navigation`, `request` config                            | Message strings (those live in `messages/`)      |
| `convex/`            | Convex backend functions, schema, generated types                              | Client code, UI                                  |
| `convex/lib/`        | Convex-side shared utilities (validators, custom function wrappers)            | Domain-specific business rules                   |
| `messages/`          | `pt-BR.json`, `en.json` — namespaced i18n strings                              | Component-scoped strings (use `useTranslations`) |

**Promotion rule:** types and helpers used in only one domain belong in that domain — promote to a shared folder only when genuinely cross-cutting.

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

### Layout primitives

Every page wraps content in three composable primitives from `@/components/page/*`. **Don't roll a custom page wrapper** — extend the primitives if your case doesn't fit.

- **`<PageShell>`** — outer 3-level wrapper. Provides `@container/main` and the project's vertical rhythm (`gap-4 md:gap-6`, `py-4 md:py-6`). Always wraps the entire page.
- **`<PageHeader title subtitle? variant? width? breadcrumb? actions? />`** — title row with two typography variants:
  - `variant="section"` (default, `text-xl`) — list / dashboard pages
  - `variant="hero"` (`text-3xl`) — detail pages with a single primary subject
  - `width="narrow"` aligns the header column with `<PageContent variant="narrow">` below it
- **`<PageContent variant="full" | "narrow" | "wide">`** — content area with width policy:
  - `full` (default) — no max-width, no horizontal padding; **children manage their own** (`px-4 lg:px-6`). For tables, dashboards, and other full-bleed-aware components.
  - `narrow` — `max-w-(--page-content-max-width)` (4xl, 56rem) with `px-4 lg:px-6`. For cards, forms, prose, detail pages.
  - `wide` — `max-w-(--page-wide-max-width)` (screen-2xl, 96rem) with `px-4 lg:px-6`. For wide tables that should still cap on ultra-wide screens.

Width tokens live in `src/app/globals.css` alongside `--header-height` and `--sidebar-width`:

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

### Convex import paths

The `@` alias is **not available** inside `convex/` files (Convex module resolver). Use relative paths for server-to-server imports:

```typescript
// Inside convex/contracts/useCases.ts
import { mutation, query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { contractStatusValidator } from "./domain";
```

Client code uses the `@/convex/...` alias:

```typescript
// Inside src/components/...
import { api } from "@/convex/_generated/api";
```

### TypeScript escape hatches

Zero tolerance: never use `any`, `as Type`, `!` (non-null assertion), `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`. Use generics, type guards, `unknown` + Zod, discriminated unions, `?.`, `??`. **Boundary exception:** route params and external API responses may assert with a comment (`// route param validated by route shape`).

`as const` (narrowing) is allowed and encouraged for value objects — distinct from `as Type` (cast).

### Environment variables

Never read `process.env` directly in domain code, components, or Convex functions. Centralize:

- **Server (Convex):** `convex/lib/env.ts` exports an eager `getEnv()` for non-secret config and lazy getter functions (e.g. `getResendApiKey()`) for secrets. Lazy access prevents Convex from flagging vars as required during deploy when they aren't actually called.
- **Client:** `src/lib/env.ts` exports typed getters for `NEXT_PUBLIC_*` vars. Anything not prefixed `NEXT_PUBLIC_` is invisible to the browser bundle — don't try to read it from client code.

Boundary exception: `convex/lib/env.ts` and `src/lib/env.ts` are themselves the only files allowed to touch `process.env` directly. If a caller needs a new env var, add a getter there.

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

| Domain       | Owns                                           | Does NOT own                       |
| ------------ | ---------------------------------------------- | ---------------------------------- |
| `users/`     | Identity, profile, user resolution             | Roles, org membership, auth tokens |
| `agencies/`  | Organization data, membership, roles           | User profile fields, contract data |
| `contracts/` | Rental lifecycle, documents, tenant, history   | Payment state, agency billing      |
| `payments/`  | Invoice lifecycle, line items, payment methods | Contract status, tenant info       |

When a query needs data from two domains (e.g. membership + user info), the enrichment belongs in the domain that drives the use case — `agencies/useCases.ts` enriches membership rows with user data because the agency domain drives the members list. The user domain does not reach into memberships.

**`domain.ts` is the type source of truth**

- Export `Doc<'tableName'>` and `Id<'tableName'>` aliases (`User`, `UserId`) — never use raw generics outside the entity file.
- Export value-object constants (`MEMBER_ROLE`, `CONTRACT_STATUS`) as `as const satisfies Record<...>` — keyof safety with literal inference.
- Export Convex `v.*` validators (`memberRoleValidator`) alongside the constants — one import gets both the type and the validator.
- Export domain helpers that encode business rules (`hasRole`, `isActiveContract`) — single place, no duplication.

**`useCases.ts` is the query/mutation anti-corruption layer**

- Every function must use an index — no `.filter()` (full table scans in Convex).
- `shape*` helpers inside `useCases.ts` define the projection between the DB schema and the UI. Name them `shapeContractSummary` / `shapeContract` etc. — not generic names like `toDTO`.
- When real auth lands, the insertion point is: `requireIdentity(ctx)` at the top of each handler, then `getMembership(userId, agencyId)` + `hasRole()` check for agency-scoped operations. Domain boundaries make this mechanical.

**Workspace / multi-tenancy**

- Every resource table carries `agencyId` — all scoped queries use the `by_agency_*` composite index.
- `WorkspaceContext` (`src/providers/workspace.tsx`) is the frontend's single source of `selectedAgencyId`. All list queries receive it as an argument — never read `localStorage` directly from a component.
- Auth shortcut: `DEV_USER_PUBLIC_ID = "dev-user"` in `workspace.tsx` is the only hardcoded identity. When Convex Auth ships, replace it with `ctx.auth.getUserIdentity()` and derive `userId` from the JWT subject.

### Deferred conventions

Auth wrappers, shared `useQuery`, React Hook Form + shadcn Field, server domain providers, and Convex workpool are tracked in `.claude/notes/deferred-conventions.md` with adoption triggers. Pending refactors (e.g. money → cents migration) live in the same file.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

<!-- convex-ai-end -->
