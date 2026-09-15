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

- **contract** is **no longer a domain in this repo.** What used to be `convex/contracts/` split in two on 2026-09-09 (see [ADR 0007](docs/architecture/decisions/0007-lease-guarantee-split.md)):
  - **guarantee** = what Mutav sells. One life, a 7-state machine (`drafted · active · in_arrears · default_verified · cover_committed · in_eviction · closed`), its own immutable `terms` snapshot and its own coverage capacity. `convex/guarantees/`, `apps/agency/src/components/guarantees/`, `apps/agency/src/lib/guarantees/`, `apps/agency/src/app/[locale]/(app)/guarantees/`.
  - **lease** = the rental relationship the guarantee is written against — property, rent, payer, tenant. Long-lived: one lease takes many guarantees over time, at most one of them open. `convex/leases/`. There is no lease UI of its own; the guarantee detail page renders the lease card.
  - **product** = the pricing parameters a guarantee is priced from, as data. `convex/products/`.
  - The two survivors of the old name are deliberate: the table `contractApplications` (the Lei 12.414 bureau-consult record `creditAnalysisSignals` FK-references) and the `contract.*` audit wire values, frozen because the audit log is hash-chained.
  - On `mutav-stellar` "contract" still means a **Soroban smart contract** — the `Fund` Rust code. Unrelated to anything above.
- **admin** here = an Auth0 **staff role** that reviews KYC/KYB submissions, manages internal users, etc. (`convex/agencies/adminUseCases.ts`). On `mutav-stellar` the same word means the **Stellar admin authority** (cold) that signs `set_*`, `cover_default`, partner whitelist — exercised here via the `apps/admin/` shell as an **M-of-N multisig**, each admin signing with their own personal connected wallet (classic native multisig for the pilot → OZ smart account later; see [ADR 0005](docs/architecture/decisions/0005-wallet-signing-architecture.md)).
- **operator** — today: the hot-wallet keypair held by the Bun daemons on `mutav-stellar` (in flight in PRs #22–#27). **Future** (per [`#57`](https://github.com/mutav-finance/mutav-stellar/issues/57)): a KMS-backed Convex Action in this repo signs operator ops. Tracked at [`mutav-stellar#41`](https://github.com/mutav-finance/mutav-stellar/issues/41).
- **treasury** here = the Mutav treasury Stellar account whose keypair lives in `convex/lib/stellarSigner.ts`. Used for SEP-10/SEP-24 anchor flows only (Etherfuse interactions). Distinct from operator/admin.
- **fund** = the MUTAV fund (a Soroban contract instance on `mutav-stellar`). Same sense everywhere.

Full table: `mutav-stellar/docs/architecture/01-protocol-overview.md#terminology`.

<!-- END:terminology -->
