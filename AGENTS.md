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

The MUTAV protocol spans several repos (the pilot runs on Solana in `mutav-protocol-solana`; `mutav-stellar` is the earlier Soroban implementation; `mutav-app` is the web surface + Mutav API) and re-uses a few words across them. The authority terms below (identity, staff, admin app, protocol admin, operator) have **one meaning each**; anything marked _Stellar legacy_ describes the earlier Soroban model, not the pilot.

- **contract** is **no longer a domain in this repo.** What used to be `convex/contracts/` split in two on 2026-09-09 (see [ADR 0007](docs/architecture/decisions/0007-lease-guarantee-split.md)):
  - **guarantee** = what Mutav sells. One life, a 7-state machine (`drafted · active · in_arrears · default_verified · cover_committed · in_eviction · closed`), its own immutable `terms` snapshot and its own coverage capacity. `convex/guarantees/`, `apps/agency/src/components/guarantees/`, `apps/agency/src/lib/guarantees/`, `apps/agency/src/app/[locale]/(app)/guarantees/`.
  - **lease** = the rental relationship the guarantee is written against — property, rent, payer, tenant. Long-lived: one lease takes many guarantees over time, at most one of them open. `convex/leases/`. There is no lease UI of its own; the guarantee detail page renders the lease card.
  - **product** = the pricing parameters a guarantee is priced from, as data. `convex/products/`.
  - The two survivors of the old name are deliberate: the table `contractApplications` (the Lei 12.414 bureau-consult record `creditAnalysisSignals` FK-references) and the `contract.*` audit wire values, frozen because the audit log is hash-chained.
  - On `mutav-stellar` "contract" still means a **Soroban smart contract** — the `Fund` Rust code. Unrelated to anything above.
- **Identity** = the Auth0 login for `apps/agency` and `apps/admin` (dev tenant today, prod tenant per [#119](https://github.com/mutav-finance/mutav-app/issues/119)). It proves who you are and **grants nothing**.
- **MUTAV staff** = a person with a `mutavStaff` row, role `admin` / `compliance` / `support` / `treasury` (ladder `support` < `compliance` < `admin`; `treasury` sits outside it). Roles in `convex/mutavStaff/domain.ts`, guards in `convex/lib/auth.ts` (`queryWithMutavStaff`, `mutationWithMutavRole`). Off-chain back-office actions only (KYC/KYB review, internal users — e.g. `convex/agencies/adminUseCases.ts`). People doing back-office work are **staff**, never "operators". The Auth0 `mutavStaff` connection + MFA is **planned** ([#206](https://github.com/mutav-finance/mutav-app/issues/206)) and does not exist yet.
- **admin** — never write it bare. Write one of:
  - **staff admin role** = the `admin` role on a `mutavStaff` row (above). Off-chain.
  - **admin app** = `apps/admin` at admin.mutav.finance, the UI staff use. **No on-chain power today.**
  - **protocol admin** = the Squads v4 multisig with time locks, on Solana (custody level per the baseline) ([ADR 0020](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/decisions/0020-operator-admin-separation-and-recovery.md), [spec §2](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/spec.md)). Owns reserve health: ceilings, caps, roles, allowlist, claim approvals. Upgrades belong to the separate **upgrade authority** multisig. Today its proposals are signed in the `/admin` console on reserve.mutav.finance; `apps/admin` becomes the signing home later ([mutav#151](https://github.com/mutav-finance/mutav/issues/151)).
  - _Stellar legacy:_ [ADR 0005](docs/architecture/decisions/0005-wallet-signing-architecture.md)'s M-of-N classic native multisig → OZ smart account, signing `set_*` / `cover_default` / partner whitelist on the Soroban `Fund`. Not the pilot model.
- **operator** = **only** the protocol operator key on Solana ([ADR 0020](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/decisions/0020-operator-admin-separation-and-recovery.md)): contracts and the claim cycle, within the caps the protocol admin sets. MUTAV's today; may be held by a separate company. Never a person. _Stellar legacy:_ the KMS-backed Convex Action plan for routine fund ops ([#141](https://github.com/mutav-finance/mutav-app/issues/141)–[#146](https://github.com/mutav-finance/mutav-app/issues/146), [`mutav-stellar#57`](https://github.com/mutav-finance/mutav-stellar/issues/57), [`mutav-stellar#41`](https://github.com/mutav-finance/mutav-stellar/issues/41); stage-2, not in the pilot). The audit-log source `"operator-cli"` is a frozen legacy value meaning the **deploy CLI**, not the protocol operator.
- **pauser / guardians** — as defined in [spec §2](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/spec.md).
- **treasury** — always qualify it: the `mutavStaff` **treasury role**; the Solana **`treasury_account`**; or the **Stellar treasury account** (legacy) whose keypair lives in `convex/lib/stellarSigner.ts`, used for SEP-10/SEP-24 anchor flows only (Etherfuse).
- **fund** = the MUTAV fund (a Soroban contract instance on `mutav-stellar`). Same sense everywhere.

Canonical, chain-neutral definitions: the [security baseline](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/security/baseline.md) (ADR 0031, proposed); Solana mapping in the [glossary](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/introduction/glossary.md) Authority section. The Stellar-era table at `mutav-stellar/docs/architecture/01-protocol-overview.md#terminology` is legacy.

<!-- END:terminology -->
