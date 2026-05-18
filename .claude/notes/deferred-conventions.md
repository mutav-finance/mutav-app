# Deferred conventions

Patterns adapted from `bwb/tokenization` that aren't worth fully formalizing as skills until the supporting infrastructure exists. Each entry lists what triggers adoption and what to set up at that point.

## convex-helpers package + shared `useQuery` wrapper

**Adopt when:** any page renders Convex data and we want consistent loading/error states across components.

**Setup:** (`convex-helpers` already installed for the auth wrappers — see below.)

1. Create `src/hooks/useQuery.ts`:
   ```ts
   import { makeUseQueryWithStatus } from "convex-helpers/react";
   import { useQueries } from "convex/react";
   export const useQuery = makeUseQueryWithStatus(useQueries);
   ```
2. Wrap the app in `<ConvexQueryCacheProvider>` from `convex-helpers/react/cache` for SPA cache (5min default).
3. Update the `react-hook-composition` skill to import from `@/hooks/useQuery` and remove the "current state" caveat.

**Then port** the bwb `convex-query-hooks` skill (pass-through vs. stabilized hook patterns, anti-patterns around manual `data === undefined`).

## Convex security wrappers (auth-aware queries/mutations)

**Status (2026-05-17): partially landed as Auth0 prep.** The wrapper layer lives in `convex/lib/auth.ts` with four wrappers (`queryWithAuth`, `mutationWithAuth`, `queryWithAgencyScope`, `mutationWithAgencyScope`) + an `assertAgencyAccess` helper for resource-by-id handlers. Spec: [`docs/auth.md`](../../docs/auth.md). Pre-Auth0 the wrappers resolve identity by hardcoded `dev-user` lookup; the post-Auth0 swap is one function in `convex/lib/auth.ts`.

**Still to adopt** (when the underlying need shows up):

- Role-gated wrappers — `queryWithAgencyRole({ minRole: "admin" })` on top of the existing scope wrapper. Defer until the first admin-only operation lands.
- Row-level security via `wrapDatabaseReader` / `wrapDatabaseWriter` from `convex-helpers/server/rowLevelSecurity`. Defer until handlers other than `ctx.db.query(...).withIndex("by_agency_...")` start showing up — current discipline (every query uses `by_agency_*` indexes from `ctx.agencyId`) makes RLS redundant.
- Triggers (`convex-helpers/server/triggers`) — adopt with RLS, composition order: Triggers first, then RLS.
- Per-action wrappers (`actionWithAuth`) — currently actions handle identity inline. Promote once a second action needs the same boilerplate.

When porting the bwb `convex-security` skill, drop the layered taxonomy (`authQuery`/`userQuery`/`permissionQuery`/`roleQuery`/`domainQuery`) — Mutav's flat 4-wrapper API is the convention.

## React Hook Form + shadcn Field

**Adopt when:** the first non-trivial form ships (anything beyond a single input).

**Setup:**

1. `bun add react-hook-form @hookform/resolvers`
2. Install shadcn Field components: `bunx shadcn@latest add field` (the new-york / radix-nova `Field`/`FieldLabel`/`FieldError`/`FieldGroup`/`FieldSet` family).
3. For Brazilian numeric inputs (BRL, percentage): `bun add react-number-format`. Use comma decimals (`thousandSeparator="."`, `decimalSeparator=","`).

**Then port** the bwb `react-forms` skill. Hard rules to keep:

- Never use `FormProvider` (forces re-renders on all children) — pass `control` directly to `<Controller>`.
- Edit forms use the `values` prop, not `useEffect` + `reset()`.
- Always use `field.id` (not array index) as the key in `useFieldArray`.
- Wrap `onValueChange` and `isAllowed` callbacks in `useCallback` for `react-number-format`. Use the ref pattern to avoid stale closures.

## Server domain providers (external integrations)

**Adopt when:** the first external integration lands — KYC (probably Avenia in Brazil), payments (Pix/PSP), email (Resend), or document signing.

**Setup the structure:**

```
convex/
├── shared/providers/{provider}/
│   ├── {Provider}ApiClient.ts    # generic, reused across domains
│   ├── credentials.ts            # auth/key management
│   └── types.ts                  # API-level types only
├── {domain}/
│   ├── domain/I{Concept}.ts      # provider interface (Strategy)
│   ├── providers/
│   │   ├── {name}Factory.ts      # selects provider by type
│   │   └── {Provider}{Domain}ProviderImpl.ts
```

**Hard rules:**

- Concrete classes use `Impl` suffix; interface files don't.
- Credentials read in factory only, injected into provider via constructor.
- All provider methods return `Result<TData, TError>` directly.
- API clients in `shared/providers/` are generic; domain types live in the provider interface file.
- External API calls go in actions (`'use node'` if needed), not mutations. Two-phase: mutation creates placeholder, action completes via `ctx.runMutation`.

**Then port** the bwb `server-domain-providers` skill.

## Convex workpool (webhooks & async jobs)

**Adopt when:** the first webhook endpoint or async background job lands (e.g., KYC status webhook, payment confirmation).

**Setup:**

1. `bun add @convex-dev/workpool`
2. Register in `convex.config.ts`: `app.use(workpool, { name: '{domain}WebhooksWorkpool' })`
3. Create `convex/shared/workpools/Workpool.ts` exporting workpool instances with sane defaults: `maxParallelism: 5`, `retryActionsByDefault: true`, `defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 1000, base: 2 }`.

**Pattern:** HTTP endpoint validates+enqueues, returns 200 immediately. Workpool action handles signature verification (failures retry) and processing.

**Result-pattern exception:** workpool handlers throw on error — required for retry mechanics. Falls under the "external API boundary" exception.

**Then port** the bwb `convex-workpool` skill.

## Self-improvement lessons file

bwb keeps a `.self-improvement/lessons.md` updated after every user correction, and reviews it at session start. Worth adopting once the project has enough recurring corrections that the same mistakes show up twice. Until then, this `.claude/notes/` folder serves the same role.

---

# Pending refactors

Code that predates a current convention and needs migrating.

## Money fields → integer cents

**Rule:** money is stored as integer cents (`*Cents: v.number()`). See CLAUDE.md → Domain conventions (Brazil) → Money.

**Existing `*BRL: v.number()` fields to migrate** (in `convex/schema.ts`):

- `contracts.availableGuaranteeBRL`
- `contracts.rental.rentBRL`
- `contracts.rental.condoBRL`
- `contracts.rental.otherFeesBRL`
- `contracts.rental.totalRentBRL`
- `contracts.rental.feeBRL`
- `contracts.rental.oneTimeActivationFeeBRL`

**Migration approach** (widen → backfill → narrow):

1. Add new `*Cents: v.number()` fields next to the existing `*BRL` fields (keep both during transition).
2. Backfill via a Convex migration: `cents = Math.round(brl * 100)`.
3. Update all reads to use the new fields, dividing by 100 only at the display layer.
4. Drop the old `*BRL` fields once no readers remain. Use `@convex-dev/migrations` for the schema-shape change — see official `convex-migration-helper` skill.

Defer until the schema has at least one production record or a feature actually performs money arithmetic on these values; until then, a simple rename + seed-data update suffices.
