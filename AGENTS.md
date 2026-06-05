<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

<!-- BEGIN:terminology -->

# Terminology (overloaded across repos)

The MUTAV protocol spans **two repos** (`mutav-stellar` for contracts + SDK; `mutav-app` for the web surface + Mutav API) and re-uses a few words across them. When you write or read code in **this** repo, the agency-platform / Web2 sense applies by default; the operator key is moving here as part of the [`mutav-stellar#57`](https://github.com/mutav-finance/mutav-stellar/issues/57) consolidation, so the table below reflects both senses.

- **contract** here = a **rental contract** (lease agreement between an agency and a tenant). Database record + CRUD UI. Lives in `convex/contracts/`, `src/components/contracts/`, `src/lib/contracts/`, `src/app/(app)/contracts/`. On `mutav-stellar` the same word means a **Soroban smart contract** — the `Fund` Rust code. They are unrelated.
- **admin** here = an Auth0 **staff role** that reviews KYC/KYB submissions, manages internal users, etc. (`convex/agencies/adminUseCases.ts`). On `mutav-stellar` the same word means the **Stellar admin keypair** (cold wallet that signs `set_*`, `cover_default`, partner whitelist) — exercised here via the planned `apps/admin/` shell with a hardware wallet.
- **operator** — today: the hot-wallet keypair held by the Bun daemons on `mutav-stellar` (in flight in PRs #22–#27). **Future** (per [`#57`](https://github.com/mutav-finance/mutav-stellar/issues/57)): a KMS-backed Convex Action in this repo signs operator ops. Tracked at [`mutav-stellar#41`](https://github.com/mutav-finance/mutav-stellar/issues/41).
- **treasury** here = the Mutav treasury Stellar account whose keypair lives in `convex/lib/stellarSigner.ts`. Used for SEP-10/SEP-24 anchor flows only (Etherfuse interactions). Distinct from operator/admin.
- **fund** = the MUTAV fund (a Soroban contract instance on `mutav-stellar`). Same sense everywhere.

Full table: `mutav-stellar/docs/architecture/01-protocol-overview.md#terminology`.

<!-- END:terminology -->
