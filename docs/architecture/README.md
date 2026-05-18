# Mutav — System Architecture

> Mutav is a multi-actor, multi-surface protocol: onchain rental-guarantee infrastructure operated through a web app that serves four distinct audiences, integrates with a regulated Brazilian anchor for BRL on/off-ramps, and mirrors a Stellar/Soroban fund as its source of truth. This document is the canvas for "what are we looking at". Detail docs cover individual surfaces and integration boundaries.

## Detail docs

**Surfaces:**

- [`admin.md`](admin.md) — Mutav Admin (Mutav-internal staff surface)
- [`investor.md`](investor.md) — Investor portal (per-chain wallet-authenticated, KYC-gated by level)

**Cross-cutting:**

- [`compliance.md`](compliance.md) — Account types, verification levels, risk classification, transaction limits, capability matrix. Consulted by every state-changing handler in the protocol.
- [`reliability.md`](reliability.md) — Reconciliation, idempotency, workflow durability, audit log integrity, NAV safety. The substrate every surface depends on.
- [`regulatory.md`](regulatory.md) — Brazilian regulatory floor (LGPD, CVM 175, BCB 519/2025). Constraints the architecture must satisfy.
- [`onchain-integration.md`](onchain-integration.md) — Chain ↔ Convex boundary (per-chain indexer modules, contract topology, write path, external integrations). Shared by admin observability and investor data.

**Pending decisions:**

- [`pending-treasury-decisions.md`](pending-treasury-decisions.md) — Three open treasury policy decisions for Draau (NAV update policy, deposit pricing approach, Pix quarantine window). Architecture supports any answer; pack designed to be walked through in one sitting.

For implementation-level concerns see the docs alongside this set: [`../auth.md`](../auth.md) (Convex function wrappers), [`../stellar-anchors.md`](../stellar-anchors.md) (anchor SEP integration). For per-domain Convex guidance see `convex/{domain}/` folders.

## Actor catalog

The protocol serves four distinct human actors plus the system itself. Each actor's surface, identity source, and trust model differs.

| Actor              | Surface                                   | Identity                                                                                                                                                                         | Trust posture                                                                                                            |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Agency staff**   | `(app)/*`                                 | Auth0 (planned) → user resolved by JWT subject → agency membership via `memberships` table                                                                                       | Trusted for their own agency; untrusted across agencies                                                                  |
| **Tenant**         | `(public)/pagar/[publicId]/*`             | None — unguessable `publicId` in URL acts as bearer token                                                                                                                        | Untrusted by default; gated by `publicId` knowledge and contract status                                                  |
| **Mutav-internal** | `(admin)/admin/*` (planned)               | Auth0 (planned) → `mutavStaff` row with sub-role                                                                                                                                 | Trusted platform-wide; sub-role gates which operations are allowed                                                       |
| **Investor**       | `(investor)/investor/*`                   | Wallet on a supported chain (Stellar v1; Solana, EVM future). Convex row keyed on `(chain, address)`. **One profile per (chain, wallet) — no cross-chain identity unification.** | Trusted to act on their own wallet; capability ladder gated by verification level (see [`compliance.md`](compliance.md)) |
| **System / cron**  | Convex actions, schedulers, HTTP webhooks | Internal — no client-facing surface                                                                                                                                              | Trusted; subject to least-privilege via `internalMutation` boundaries                                                    |

The Auth0 swap is documented in [`../auth.md`](../auth.md). Pre-Auth0, all human identity resolves to a hardcoded `dev-user` row.

## Shell catalog

The app is a single Next.js deployment that hosts four distinct shells via App Router route groups. Each shell has its own layout, sidebar, identity model, and role gate. They share zero UI chrome — the visual separation reflects the actor separation.

| Shell                | Route group  | Layout owns                                         | Gate                                   | Status                                   |
| -------------------- | ------------ | --------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| **Agency dashboard** | `(app)`      | `AppSidebar`, agency switcher, NavMain/NavAgency    | Auth + agency membership               | Shipped                                  |
| **Tenant payment**   | `(public)`   | Minimal chrome, no auth UI                          | `publicId` validity + contract status  | Shipped                                  |
| **Investor portal**  | `(investor)` | Investor nav (no agency context)                    | Wallet-connected (KYC-gated per route) | UI shipped, data + auth mocked           |
| **Mutav Admin**      | `(admin)`    | `AdminSidebar` (Mutav branding, no agency switcher) | `mutavStaff` row exists                | **Planned** — see [`admin.md`](admin.md) |

The two authenticated shells (`(app)` and `(admin)`) coexist on the same domain (`app.mutav.app/{,admin}/*`) for v1. A future migration to `admin.mutav.app` is documented as a security-driven trigger in [`admin.md`](admin.md), not committed for v1.

Mutav-internal users who also hold agency memberships flip between `(app)` and `(admin)` via a shell-switcher in the user menu. They do not see the admin sidebar while inside `(app)`, and vice versa.

## Domain catalog

Convex domain folders are the system's bounded contexts. Existing domains are listed in [`../../CLAUDE.md` § "Convex backend organization"](../../CLAUDE.md). Architecture-level summary:

| Domain          | Status      | Owns                                                                                                                                                            | Detail doc                                                                   |
| --------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `users`         | Shipped     | Identity, profile                                                                                                                                               | —                                                                            |
| `agencies`      | Shipped     | Organizations, memberships, roles (`owner` / `admin` / `member`)                                                                                                | —                                                                            |
| `contracts`     | Shipped     | Rental lifecycle, documents, tenant, history                                                                                                                    | —                                                                            |
| `payments`      | Shipped     | Invoice lifecycle, line items, payment methods                                                                                                                  | —                                                                            |
| `anchors`       | Shipped     | Etherfuse / testanchor SEP integration (per-agency provider lookup)                                                                                             | [`../stellar-anchors.md`](../stellar-anchors.md)                             |
| `mutavStaff`    | **Planned** | Mutav-internal users, sub-roles (admin / compliance / support / treasury), hash-chained audit log                                                               | [`admin.md`](admin.md)                                                       |
| `compliance`    | **Planned** | Account classification, verification levels, risk classification, transaction limits (rule rows), capability resolution, review queue, regulatory pause         | [`compliance.md`](compliance.md)                                             |
| `delinquencies` | **Planned** | Default lifecycle, liquidation request approval workflow                                                                                                        | [`admin.md`](admin.md) § A3                                                  |
| `fundState`     | **Planned** | Per-chain mirror of onchain fund state — NAV, AUM, redemption queue. Convex-side cache, populated by per-chain indexer module. Rows carry `chain` discriminant. | [`onchain-integration.md`](onchain-integration.md)                           |
| `nav`           | **Planned** | NAV proposals + safeguards (push-only by treasury role, per-epoch change cap, pause-on-deviation)                                                               | [`admin.md`](admin.md) § A6, [`reliability.md`](reliability.md) § NAV safety |

**Promotion rule** (from CLAUDE.md): new domains start as a single file and split into `domain.ts` + `useCases.ts` (+ `mutations.ts` / `actions.ts` as needed) the moment they gain a second non-trivial function.

## Trust boundaries

The protocol crosses several trust boundaries. Each is a place where wrong assumptions become security holes.

```
                                          ┌────────────────────────┐
                                          │   Auth0 (planned)      │
                                          │   identity provider    │
                                          └──────────┬─────────────┘
                                                     │ JWT
                                                     ▼
┌───────────────┐       ┌──────────────────────────────────────────────┐       ┌─────────────────────┐
│   Tenant      │       │                                              │       │   Investor          │
│  (no auth,    ├──────►│              Mutav web app                   │◄──────┤   wallet (per chain)│
│  publicId)    │       │              (Next.js + Convex)              │       │  Stellar v1; future │
└───────────────┘       │                                              │       │  Solana, EVM, …     │
                        │   • Auth wrappers (convex/lib/auth.ts)       │       └─────────────────────┘
                        │   • Compliance check on every state change   │
                        │   • Hash-chained audit log on every write    │
                        │   • Reconciliation circuit breaker           │
                        │                                              │
                        └─────┬──────────┬────────────┬──────────────────┘
                              │          │            │
                              │ SEP-6/24 │ REST + WH  │ Per-chain RPC
                              │          │ (hedge)    │ (read via indexer module)
                              ▼          ▼            ▼
                  ┌───────────────────┐  ┌──────────────┐  ┌──────────────────────────┐
                  │   Etherfuse       │  │  BaaS hedge  │  │  Onchain (per-chain)     │
                  │   PRIMARY rail    │  │  (Transfero  │  │  Custody contract +      │
                  │   BRL ↔ TESOURO   │  │   / Bitso /  │  │  Operations contract     │
                  │   • investor      │  │   Foxbit)    │  │  (Segregated Account)    │
                  │     on-ramp       │  │              │  │  Treasury asset:         │
                  │   • agency        │  │ capacity +   │  │  TESOURO (Etherfuse-     │
                  │     settlement    │  │ concentration│  │  issued BRL T-bonds)     │
                  │   • TESOURO       │  │ hedge for    │  └────────────┬─────────────┘
                  │     issuer        │  │ agency       │               │
                  └───────────────────┘  │ settlement   │               │ Mutav-built
                                         └──────────────┘               │ proposal queue
                                                                        │ + Lobstr Vault
                                                                        │ signers (multisig)
                                                                        ▼
                                                               ┌────────────────────┐
                                                               │  Mutav SA          │
                                                               │  treasury ops      │
                                                               └────────────────────┘
```

Boundaries (in order of blast radius):

1. **Auth0 ↔ Convex** — identity boundary. Convex trusts the JWT subject; Auth0 owns user provisioning. See [`../auth.md`](../auth.md).
2. **Wallet ↔ Convex (per chain)** — investor-only. Convex treats `(chain, address)` as the user's stable identifier. Convex does not verify wallet signatures for read; it does require wallet-signed transactions for writes (which go to chain, not Convex). One profile per (chain, wallet) — no cross-chain unification.
3. **Convex ↔ Etherfuse (primary settlement rail)** — high-concentration counterparty. Etherfuse fills four roles: investor on-ramp (SEP-24), agency settlement primary (SEP-6 BRL Pix → TESOURO direct), **TESOURO issuer** (Mutav's treasury asset), and TESOURO redemption counterparty. Webhooks signature-verified + idempotent per [`reliability.md`](reliability.md) § Idempotency. Concentration risk explicitly acknowledged and mitigated by the BaaS hedge layer (boundary 4) and Bitso BRL1 as fallback investor on-ramp. See [`../stellar-anchors.md`](../stellar-anchors.md) and [`regulatory.md`](regulatory.md) § Etherfuse concentration.
4. **Convex ↔ BaaS hedge (Transfero / Bitso / Foxbit)** — **capacity, concentration, and incident hedge** for the agency-settlement primary rail. Multi-hop flow (Pix → BaaS → USDC → Stellar → Etherfuse mint TESOURO) adds spread; that's the cost of the hedge. Provider must hold BCB IP + VASP authorization. See [`onchain-integration.md`](onchain-integration.md) § Agency settlement (hedge rail) and [`regulatory.md`](regulatory.md) § Settlement provider selection.
5. **Convex ↔ Onchain (per-chain)** — chain boundary. **Read** is one-way (per-chain indexer modules pull chain state into Convex tables; see [`onchain-integration.md`](onchain-integration.md) § Per-chain indexer modules). **Write** is never initiated by Convex with key material — investor wallets sign client-side, admin writes are coordinated through a Mutav-built proposal queue in `(admin)` and signed on individual ops staff Lobstr Vaults; Convex composes XDR and submits once threshold is met but holds no keys. Segregated-account contract topology enforces separation between custody and operations (see [`onchain-integration.md`](onchain-integration.md) § Contract topology and [`regulatory.md`](regulatory.md) § Stellar implementation pattern).
6. **Anchor ↔ Onchain reconciliation** — periodic reconciliation between Etherfuse-reported BRL float, BaaS provider-reported settlement, and onchain fund supply per [`reliability.md`](reliability.md) § Reconciliation. Mismatch trips the regulatory-pause primitive (see [`compliance.md`](compliance.md)).
7. **`publicId` ↔ Tenant access** — bearer token boundary. The tenant pays via a URL containing an unguessable id. The id is not rotated today; revocation is "cancel the contract".
8. **Mutav-admin ↔ everything** — cross-tenant boundary. Mutav staff see across all agencies. Mitigated by `mutavStaff` sub-role gating + hash-chained audit log on every write (Merkle-anchored daily to chain for CVM/BCB defensibility per [`reliability.md`](reliability.md) § Audit log integrity).
9. **Convex (US) ↔ Brazilian PII** — data residency boundary. Convex is US-hosted; LGPD cross-border transfer is documented via SCCs; sensitive PII (biometric KYC, ID documents) stays at the KYC vendor (BR-resident option required where available — Sumsub is the v1 recommendation with DPA caveats per [`regulatory.md`](regulatory.md) § Recommended vendor). See [`regulatory.md`](regulatory.md) § LGPD.

## Non-trust-boundary principles

A few architectural rules that aren't boundary calls but constrain how each shell is built:

- **Convex is the only backend.** No Next.js Server Actions. All writes go through Convex mutations. (CLAUDE.md § "Server Actions vs Convex mutations".)
- **Convex never signs onchain transactions.** Custody stays with the wallet (investor) or multisig (admin). See [`onchain-integration.md`](onchain-integration.md).
- **Per-chain isolation.** Each chain integration is a self-contained module (`convex/chains/{chain}/`). A bug in one chain's indexer cannot affect another chain's funds. See [`onchain-integration.md`](onchain-integration.md) § Per-chain indexer modules.
- **Compliance gates everything.** Every state-changing handler consults the compliance domain before proceeding. The check resolves account type + level + risk + state + limits in one pass. See [`compliance.md`](compliance.md).
- **Multi-step flows use workflows.** Webhook ingestion, deposit, redeem, liquidation, KYC verification — anything spanning multiple checkpoints uses `@convex-dev/workflow` for durability. See [`reliability.md`](reliability.md) § Workflow durability.
- **Reconciliation is mandatory at the offchain↔onchain boundary.** Every offchain credit event carries a correlation id that propagates to the onchain operation. See [`reliability.md`](reliability.md) § Reconciliation.
- **Default to server components.** Push interactivity to leaf islands. (CLAUDE.md § "Server vs Client Components".)
- **Domain folders are bounded contexts.** A domain that needs data from another goes through that domain's `useCases.ts`, not its tables. (CLAUDE.md § "Domain design".)
- **Result pattern at domain boundaries.** Throw only at external integration edges. (CLAUDE.md § "Result pattern".)
