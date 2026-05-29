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

The MUTAV protocol spans three repos and re-uses a few words across them. When you write or read code in **this** repo, the agency-platform / Web2 sense always applies:

- **contract** here = a **rental contract** (lease agreement between an agency and a tenant). Database record + CRUD UI. Lives in `convex/contracts/`, `src/components/contracts/`, `src/lib/contracts/`, `src/app/(app)/contracts/`. On `mutav-stellar` the same word means a **Soroban smart contract** — the `Fund` Rust code. They are unrelated.
- **admin** here = an Auth0 **staff role** that reviews KYC/KYB submissions, manages internal users, etc. (`convex/agencies/adminUseCases.ts`). On `mutav-stellar` the same word means the **Stellar admin keypair** (cold wallet that signs `set_*`, `cover_default`, partner whitelist).
- **operator** doesn't appear in this repo. On `mutav-stellar` it's the hot-wallet keypair the daemons use.
- **treasury** here = the Mutav treasury Stellar account whose keypair lives in `convex/lib/stellarSigner.ts`. Used for SEP-10/SEP-24 anchor flows only (Etherfuse interactions). Distinct from operator/admin.
- **fund** = the MUTAV fund (a Soroban contract instance on `mutav-stellar`). Same sense everywhere.

Full table: `mutav-stellar/docs/architecture/01-protocol-overview.md#terminology`.

<!-- END:terminology -->

<!-- BEGIN:stellar-build-tool -->

# stellar-build (recommended toolkit)

CLI that bundles 42 Stellar-focused Claude skills (Soroban guidance, dApp patterns, SCF grant submission, security review, edge-case hunters) plus 6 named personas. Useful when the agency-side surface needs to interact with Stellar contracts on `mutav-stellar` or reference Stellar-specific patterns.

- Site: https://web-nine-umber-74.vercel.app/
- Source: https://github.com/kaankacar/stellar-build
- Install: `curl -fsSL https://raw.githubusercontent.com/kaankacar/stellar-build/main/install.sh | bash`

<!-- END:stellar-build-tool -->
