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
- Convex — backend (functions in convex/)
- Railway — deployment

> Stellar wallet connection: removed pending a vetted, low-CVE replacement.
> Earlier `@creit.tech/stellar-wallets-kit` pulled in 9 critical vulns via
> Trezor/Hot/NEAR adapters we never invoked.

## Architecture

- `src/providers/` — client providers (Convex, Stellar)
- `src/components/ui/` — shadcn components
- `src/app/` — Next.js app router pages
- `convex/` — Convex backend functions

## Code standards

- TypeScript strict
- Branch workflow: feature branches → squash merge PRs to main
- Barrel files (`index.ts`/`index.tsx`) are prohibited — every import references the actual file path

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
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { contractStatusValidator } from "./contracts/domain";
```

Client code uses the `@/convex/...` alias:

```typescript
// Inside src/components/...
import { api } from "@/convex/_generated/api";
```

### TypeScript escape hatches

Zero tolerance: never use `any`, `as Type`, `!` (non-null assertion), `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`. Use generics, type guards, `unknown` + Zod, discriminated unions, `?.`, `??`. **Boundary exception:** route params and external API responses may assert with a comment (`// route param validated by route shape`).

`as const` (narrowing) is allowed and encouraged for value objects — distinct from `as Type` (cast).

## Skills

Project skills live under `.claude/skills/`. Non-obvious trigger → skill mappings:

- Defining entity types or value objects derived from Convex schema (`Doc<>`, `Id<>`), validators, schema discriminated unions, or choosing between `.filter()` and composite indexes → `convex-document-types`
- Writing Convex queries/mutations/actions — pure-vs-impure separation, immutable updates, `Result<T>` returns → `convex-functional-programming`
- Building React page or feature components — pure rendering separated from logic via view model hooks → `react-component-view-model-pattern`
- Creating data fetching hooks — single-purpose hooks with no side effects → `react-hook-composition`

Plus the official Convex plugin skills (`convex-quickstart`, `convex-setup-auth`, `convex-create-component`, `convex-migration-helper`, `convex-performance-audit`) and Next.js skills (`next-best-practices`, `next-cache-components`, `next-upgrade`).

**Progressive loading:** load `SKILL.md` first via the Skill tool. Skills currently ship without supplementary `examples.md`/`reference.md`/`template.md`; add them only when the patterns merit deeper material.

**Deferred conventions** (auth wrappers, shared `useQuery`, React Hook Form + shadcn Field, server domain providers, Convex workpool) are tracked in `.claude/notes/deferred-conventions.md` with adoption triggers.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

<!-- convex-ai-end -->
