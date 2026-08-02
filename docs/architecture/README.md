# Mutav — System Architecture

> Mutav is a multi-actor, multi-surface protocol: onchain rental-guarantee infrastructure operated through a web app that serves four distinct audiences, integrates with a regulated Brazilian anchor for BRL on/off-ramps, and mirrors a Stellar/Soroban fund as its source of truth. This document is the canvas for "what are we looking at". Detail docs cover individual surfaces and integration boundaries.

## Detail docs

**Foundations (read first):**

- [`entities.md`](entities.md) — The three legal entities (`Mutav-BR` / `Mutav-Fund` / `Mutav-Mgmt`) and how they relate. Naming convention enforcement.
- [`tranches.md`](tranches.md) — `MTVH` / `MTVM` / `MTVL` specification, default waterfall, per-tranche eligibility.

**Surfaces:**

- [`admin.md`](admin.md) — Mutav Admin (Mutav-internal staff surface, pillars A1–A6 scoped per entity)
- [`investor.md`](investor.md) — Investor portal (per-chain wallet-authenticated, KYC-gated by level, tranche selection at deposit, dual KYC regime for BR investors)
- [`underwriting.md`](underwriting.md) — Tenant underwriting pipeline (verify → credit analysis → offer products); the `compliance` (verification) / `creditAnalysis` (credit analysis) / `products` (catalog) / `contracts` (coverage decision) composition.

**Cross-cutting:**

- [`compliance.md`](compliance.md) — Account types, verification levels, risk classification, transaction limits, capability matrix (with tranche dimension). Consulted by every state-changing handler in the protocol.
- [`reliability.md`](reliability.md) — Three-axis reconciliation, idempotency, workflow durability, cross-entity flows, entity-tagged audit log, per-tranche NAV safety. The substrate every surface depends on.
- [`regulatory.md`](regulatory.md) — Per-entity regulatory floor (LGPD, CVM oferta pública for offshore Fund, BCB 519/2025, BACEN câmbio for cross-jurisdictional flows, cessão substance risk). Constraints the architecture must satisfy.
- [`security.md`](security.md) — Secrets and PII crypto: threat model, asset inventory, two-key envelope + hash sidecar pattern, key management lifecycle (generation / storage / rotation / audit / recovery), per-entity isolation roadmap. The "how" behind the LGPD floor.
- [`onchain-integration.md`](onchain-integration.md) — Chain ↔ Convex boundary (per-chain indexer modules, contract topology, offshore custody chain, write path, external integrations). Shared by admin observability and investor data.

**Architecture decisions:**

- [`decisions/`](decisions/) — Numbered ADRs documenting load-bearing decisions. Start with [`0001-pii-crypto-pattern.md`](decisions/0001-pii-crypto-pattern.md) (two-key envelope + hash sidecar — the rationale [`security.md`](security.md) implements). [`0002-b2b2c-tenant-credit-data-governance.md`](decisions/0002-b2b2c-tenant-credit-data-governance.md) — B2B2C controller model, legal basis, and the pseudonymization-vs-anonymization boundary for tenant credit data + the proprietary scoring dataset. [`0003-persona-app-origin-isolation-single-convex.md`](decisions/0003-persona-app-origin-isolation-single-convex.md) — persona-app origin isolation on a single-Convex monorepo (Host-Only cookies, single-writer audit log).

**Pending decisions:**

- [`../open-questions.md`](../open-questions.md) — Master index of unresolved questions across legal, treasury policy, vendor selection, and engineering deferrals. Start here when you need to know "what's still open."
- [`pending-treasury-decisions.md`](pending-treasury-decisions.md) — Three open treasury policy decisions for Draau (NAV update policy, deposit pricing approach, Pix quarantine window). Architecture supports any answer; pack designed to be walked through in one sitting.

For implementation-level concerns see the docs alongside this set: [`../auth.md`](../auth.md) (Convex function wrappers), [`../stellar-anchors.md`](../stellar-anchors.md) (anchor SEP integration), [`../key-management-guide.md`](../key-management-guide.md) (hands-on key handling for engineers). For per-domain Convex guidance see `convex/{domain}/` folders.

## Entity catalog

"Mutav" is the consumer brand. As a legal/operational entity it's a composite of three (see [`entities.md`](entities.md)). Every architecture sentence that names a Mutav entity in a financial / regulatory / operational sense resolves to one of these codes — bare "Mutav" is the consumer brand only.

| Code         | Entity (placeholder, see PR mutav#32) | Domicile       | Function                                                                                     |
| ------------ | ------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `Mutav-BR`   | Mutav Garantidora                     | Brazil         | Fiança under Lei do Inquilinato; receives agency fees; routes 80% via cessão to `Mutav-Fund` |
| `Mutav-Fund` | Mutav Fund                            | Offshore (TBD) | Holds TESOURO via Etherfuse; issues `MTVH` / `MTVM` / `MTVL` tranches with default waterfall |
| `Mutav-Mgmt` | Mutav Management                      | Offshore (TBD) | Administers `Mutav-Fund`: NAV updates, liquidation execution, treasury signing operations    |

## Actor catalog

The protocol serves four distinct human actors plus the system itself. Each actor's surface, identity source, and trust model differs.

| Actor              | Surface                                   | Identity                                                                                                                                                                         | Trust posture                                                                                                            |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Agency staff**   | `(app)/*`                                 | Auth0 → user resolved by JWT subject → agency membership via `memberships` table                                                                                                 | Trusted for their own agency; untrusted across agencies                                                                  |
| **Tenant**         | `(public)/pay/[publicId]/*`               | None — unguessable `publicId` in URL acts as bearer token                                                                                                                        | Untrusted by default; gated by `publicId` knowledge and contract status                                                  |
| **Mutav-internal** | `apps/admin` `(admin)/*`                  | Auth0 → `mutavStaff` row with sub-role                                                                                                                                           | Trusted platform-wide; sub-role gates which operations are allowed                                                       |
| **Investor**       | `(investor)/investor/*`                   | Wallet on a supported chain (Stellar v1; Solana, EVM future). Convex row keyed on `(chain, address)`. **One profile per (chain, wallet) — no cross-chain identity unification.** | Trusted to act on their own wallet; capability ladder gated by verification level (see [`compliance.md`](compliance.md)) |
| **System / cron**  | Convex actions, schedulers, HTTP webhooks | Internal — no client-facing surface                                                                                                                                              | Trusted; subject to least-privilege via `internalMutation` boundaries                                                    |

Auth0 has landed: all human identity resolves through `ctx.auth.getUserIdentity()` in `convex/lib/auth.ts`, and there is no `dev-user` fallback — a deployment without a real `AUTH0_DOMAIN` rejects every authenticated request. Dev uses the seeded personas in [`../test-personas.md`](../test-personas.md). See [`../auth.md`](../auth.md).

## Shell catalog

The app layer is a Turborepo monorepo with one Next.js app per audience (`apps/agency`, `apps/pay`, `apps/fund`, `apps/admin`), each on its own origin. Within an app, an App Router **route group scopes the guard and the shell**; the chrome itself is one of three components shared from `@mutav/ui/shell/*`. The route picks the shell — auth state only fills the `identity` slot ([nav-shell-audit](nav-shell-audit.md) § 4, D1–D2).

| Route group / tree            | Home          | Shell         | Guard                                                | Identity slot        | Status                                                                                                    |
| ----------------------------- | ------------- | ------------- | ---------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| `(app)`                       | `apps/agency` | `<AppShell>`  | Auth0 + agency membership                            | user menu            | Shipped — live                                                                                            |
| `(onboarding)/onboarding/*`   | `apps/agency` | `<FlowShell>` | Auth0, no agency yet                                 | log-out link or none | Shipped — live                                                                                            |
| `(admin)`                     | `apps/admin`  | `<AppShell>`  | Auth0 + `mutavStaff` row                             | user menu            | Shell + onboarding review built; A1–A6 pillars placeholder — see [`admin.md`](admin.md)                   |
| `access-denied`               | `apps/admin`  | `<BareShell>` | none — publicly reachable by design                  | none                 | Built                                                                                                     |
| `pay/[publicId]/*`            | `apps/pay`    | `<FlowShell>` | `publicId` bearer + contract status                  | **always empty**     | Built — deploy pending                                                                                    |
| `(investor)`                  | `apps/fund`   | app-local     | wallet-connected (KYC-gated per route)               | wallet connect       | UI built, data mocked; shell adoption deferred — [nav-shell-audit](nav-shell-audit.md) § 7                |
| `[locale]/not-found.tsx` (×4) | every app     | `<BareShell>` | n/a — `notFound()` boundary                          | none                 | Shipped — paints on hydration, not in SSR; no call site yet on `admin`/`fund` ([§ 5](nav-shell-audit.md)) |
| `global-not-found.tsx` (×4)   | every app     | `<BareShell>` | n/a — unmatched URLs; owns its own `<html>`/`<body>` | none                 | Shipped — the only server-rendered 404                                                                    |

Nav item **definitions** stay app-local and arrive as props, so the shells couple nothing the [origin-isolation ADR](decisions/0003-persona-app-origin-isolation-single-convex.md) keeps independent. Two structural rules are gated in CI (`tests/shell-contract.test.ts` + `eslint.config.mjs`): exactly one shell per rendered route, and both 404 files at their required paths (`[locale]/not-found.tsx`, `app/global-not-found.tsx`). Picking a shell for a new route: [`../../CLAUDE.md` § "Which shell a new route gets"](../../CLAUDE.md#which-shell-a-new-route-gets).

Mutav-internal users who also hold agency memberships flip between the agency app and the admin app via a shell-switcher in the user menu. They do not see the admin sidebar while inside the agency app, and vice versa. The switcher is a cross-origin link (cookies are `Host-Only` per the [Non-trust-boundary principles](#non-trust-boundary-principles), so a fresh Auth0 session is required on each origin).

## App catalog

The Shell catalog describes _how the UI is organized_; the App catalog describes _where the deployable units live_. The app layer is a Turborepo monorepo with one Next.js app per audience, each on its own origin. See [ADR 0003](decisions/0003-persona-app-origin-isolation-single-convex.md) for the decisions (origin isolation, single-Convex, cookie posture), and the [migration spec](monorepo-migration.md) for the staged-PR history.

| App           | Origin                | Hosts shell                 | Auth                                                                  | Cookie posture                                                           | Status                                        |
| ------------- | --------------------- | --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| `apps/agency` | `app.mutav.finance`   | `(app)`                     | Auth0 (agency connection) + agency membership                         | `Host-Only, SameSite=Strict, Secure, HttpOnly`                           | Built — live                                  |
| `apps/pay`    | `pay.mutav.finance`   | `(public)/pay/[publicId]/*` | None — `publicId` bearer in URL                                       | No session cookie; only short-lived `__Host-` CSRF token if forms appear | Built — deploy + attach pending               |
| `apps/fund`   | `fund.mutav.finance`  | `(investor)`                | Wallet-as-identity (per chain); any future Auth0 use = the shared app | No Auth0 cookie; wallet session in `localStorage` scoped to origin       | Built (data mocked) — deploy + attach pending |
| `apps/admin`  | `admin.mutav.finance` | `(admin)`                   | Auth0 (shared app; `mutavStaff` connection + mandatory-MFA Action)    | `Host-Only, SameSite=Strict, Secure, HttpOnly`; shorter session lifetime | Built — deploy + attach pending               |

Shared code lives in `packages/*`: `@mutav/ui` (shadcn + page primitives, `cn`, theme provider), `@mutav/i18n` (next-intl routing/navigation, cross-app URLs, Brazil formatters), `@mutav/app-shell` (Convex client providers), `@mutav/wallet` (one Stellar Wallets Kit v2 integration for fund/agency/admin — explicit modules, no `allowAllModules`; admin authority is an account-side M-of-N multisig; see [ADR 0005](decisions/0005-wallet-signing-architecture.md)), `@mutav/tsconfig`. Apps depend on packages, never the reverse.

The four apps share a **single Convex deployment** at the repo root (the Mutav API). The single-writer rule is load-bearing — the hash-chained audit log + Merkle anchor in [`reliability.md`](reliability.md) § Audit log integrity requires it. Per-app backends are explicitly rejected.

They also share a **single Auth0 application** (one client id / `aud`, validated by one provider in `convex/auth.config.ts`): `apps/agency` + `apps/admin` authenticate against it today, and `apps/fund` would use the **same** app if it adds Auth0 (it is wallet-as-identity today). A separate admin Auth0 _application_ (its own `aud`) was explored in [#206](https://github.com/mutav-finance/mutav-app/issues/206) and **dropped** ([#215](https://github.com/mutav-finance/mutav-app/pull/215)) — `aud` is not a capability gate, so the staff gate is the `mutavStaff` row, and per-app/per-surface Auth0 applications are rejected for the same reason per-app backends are. `apps/pay/` carries no Auth0 SDK at all (defends against phishing UI; limits blast radius of a future Auth0 vulnerability).

Staff distinctness on the shared app is a dedicated `mutavStaff` connection plus a mandatory-MFA Post-Login Action (no self-signup, shorter session); the escalation path to a separate Auth0 _tenant_ is documented in [`admin.md`](admin.md). See [ADR 0003](decisions/0003-persona-app-origin-isolation-single-convex.md) (single Convex + the #215 Auth0 amendment).

## Domain catalog

Convex domain folders are the system's bounded contexts. Existing domains are listed in [`../../CLAUDE.md` § "Convex backend organization"](../../CLAUDE.md). Architecture-level summary:

| Domain          | Status      | Owns                                                                                                                                                                                                                                                          | Detail doc                                                                   |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `users`         | Shipped     | Identity, profile                                                                                                                                                                                                                                             | —                                                                            |
| `agencies`      | Shipped     | Organizations, memberships, roles (`owner` / `admin` / `member`)                                                                                                                                                                                              | —                                                                            |
| `contracts`     | Shipped     | Rental lifecycle, documents, tenant, history                                                                                                                                                                                                                  | —                                                                            |
| `invoices`      | Shipped     | Invoice lifecycle (the bill — what's owed), line items, status (`INVOICE_STATUS`), `INV-…` publicId; `overdue` is derived, not stored. Renamed from `payments`. A separate settlement `payments` domain (how a bill is paid — boleto/pix/stellar) is planned. | —                                                                            |
| `anchors`       | Shipped     | Etherfuse / testanchor SEP integration (per-agency provider lookup)                                                                                                                                                                                           | [`../stellar-anchors.md`](../stellar-anchors.md)                             |
| `screening`     | Shipped     | Vendor-neutral external-data signals (credit, registration, sanctions) + reproducible assessment snapshots. Consumed by `contracts` (tenant underwriting) and, in Phase 2, `compliance` (agency KYB).                                                         | [`../../convex/screening/README.md`](../../convex/screening/README.md)       |
| `mutavStaff`    | **Planned** | Mutav-internal users, sub-roles (admin / compliance / support / treasury), hash-chained audit log                                                                                                                                                             | [`admin.md`](admin.md)                                                       |
| `compliance`    | **Planned** | Account classification, verification levels, risk classification, transaction limits (rule rows), capability resolution, review queue, regulatory pause                                                                                                       | [`compliance.md`](compliance.md)                                             |
| `delinquencies` | **Planned** | Default lifecycle, liquidation request approval workflow                                                                                                                                                                                                      | [`admin.md`](admin.md) § A3                                                  |
| `fundState`     | **Planned** | Per-chain mirror of onchain fund state — NAV, AUM, redemption queue. Convex-side cache, populated by per-chain indexer module. Rows carry `chain` discriminant.                                                                                               | [`onchain-integration.md`](onchain-integration.md)                           |
| `nav`           | **Planned** | NAV proposals + safeguards (push-only by treasury role, per-epoch change cap, pause-on-deviation)                                                                                                                                                             | [`admin.md`](admin.md) § A6, [`reliability.md`](reliability.md) § NAV safety |

**Promotion rule** (from CLAUDE.md): new domains start as a single file and split into `domain.ts` + `useCases.ts` (+ `mutations.ts` / `actions.ts` as needed) the moment they gain a second non-trivial function.

**Cross-reference to `mutav-stellar#57`.** The consolidation issue sketches Convex modules as `agencies · investments · fundMgmt · payments · compliance`. `agencies`, `payments`, and `compliance` carry over with the same names. `investments` and `fundMgmt` are **not** adopted as domain names: their conceptual scope is split across `fundState` (per-chain NAV/AUM/redemption-queue mirror), `nav` (proposals + safeguards), `contracts` (rental contracts), and `mutavStaff` (treasury sub-role). When a `#57` reader hits "where is `investments`?" — it's the union of those four. [ADR 0003](decisions/0003-persona-app-origin-isolation-single-convex.md) (decision 7) and the [migration spec](monorepo-migration.md) § Section 3 walk through the disposition for each `#57` name.

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
                                                               │  Mutav-Fund        │
                                                               │  (custody)         │
                                                               │  + Mutav-Mgmt      │
                                                               │  (signers)         │
                                                               └────────────────────┘
```

Boundaries (in order of blast radius):

1. **Auth0 ↔ Convex** — identity boundary. Convex trusts the JWT subject; Auth0 owns user provisioning. See [`../auth.md`](../auth.md).
2. **Wallet ↔ Convex (per chain)** — investor-only. Convex treats `(chain, address)` as the user's stable identifier. Convex does not verify wallet signatures for read; it does require wallet-signed transactions for writes (which go to chain, not Convex). One profile per (chain, wallet) — no cross-chain unification.
3. **Convex ↔ Etherfuse (primary settlement rail)** — high-concentration counterparty. Etherfuse fills four roles across two entities: investor on-ramp for `Mutav-Fund` (SEP-24), agency settlement primary for the `Mutav-BR` → `Mutav-Fund` cessão (SEP-6 BRL Pix → TESOURO direct), **TESOURO issuer** to `Mutav-Fund`, and TESOURO redemption counterparty for `Mutav-Fund`. Webhooks signature-verified + idempotent per [`reliability.md`](reliability.md) § Idempotency. Concentration risk explicitly acknowledged and mitigated by the BaaS hedge layer (boundary 4) and Bitso BRL1 as fallback investor on-ramp. **Additional load-bearing dependency:** whether Etherfuse permits an offshore entity (`Mutav-Fund`) to hold TESOURO at all — open per L3. See [`../stellar-anchors.md`](../stellar-anchors.md) and [`regulatory.md`](regulatory.md) § Etherfuse concentration.
4. **Convex ↔ BaaS hedge (Transfero / Bitso / Foxbit)** — **capacity, concentration, and incident hedge** for the agency-settlement primary rail. Multi-hop flow (Pix → BaaS → USDC → Stellar → Etherfuse mint TESOURO) adds spread; that's the cost of the hedge. Provider must hold BCB IP + VASP authorization. See [`onchain-integration.md`](onchain-integration.md) § Agency settlement (hedge rail) and [`regulatory.md`](regulatory.md) § Settlement provider selection.
5. **Convex ↔ Onchain (per-chain)** — chain boundary. **Read** is one-way (per-chain indexer modules pull chain state into Convex tables; see [`onchain-integration.md`](onchain-integration.md) § Per-chain indexer modules). **Write** is never initiated by Convex with key material — investor wallets sign client-side, admin writes are coordinated through a Mutav-built proposal queue in `(admin)` and signed on individual ops staff Lobstr Vaults; Convex composes XDR and submits once threshold is met but holds no keys. Segregated-account contract topology enforces separation between custody and operations (see [`onchain-integration.md`](onchain-integration.md) § Contract topology and [`regulatory.md`](regulatory.md) § Stellar implementation pattern).
6. **Anchor ↔ Onchain reconciliation** — periodic reconciliation between Etherfuse-reported BRL float, BaaS provider-reported settlement, and onchain fund supply per [`reliability.md`](reliability.md) § Reconciliation. Mismatch trips the regulatory-pause primitive (see [`compliance.md`](compliance.md)).
7. **`publicId` ↔ Tenant access** — bearer token boundary. The tenant pays via a URL containing an unguessable id. The id is not rotated today; revocation is "cancel the contract".
8. **Mutav-admin ↔ everything** — cross-tenant boundary. Mutav staff see across all agencies. Mitigated by `mutavStaff` sub-role gating + hash-chained audit log on every write (Merkle-anchored daily to chain for CVM/BCB defensibility per [`reliability.md`](reliability.md) § Audit log integrity).
9. **Convex (US) ↔ Brazilian PII** — data residency boundary. Convex is US-hosted; LGPD cross-border transfer is documented via SCCs; sensitive PII (biometric KYC, ID documents) stays at the KYC vendor (BR-resident option required where available — Sumsub is the v1 recommendation with DPA caveats per [`regulatory.md`](regulatory.md) § Recommended vendor). See [`regulatory.md`](regulatory.md) § LGPD.
10. **Cross-origin boundary between persona apps** (post-migration) — containment boundary. Each persona app (`agency` / `pay` / `fund` / `admin`) sits on its own origin (`app` / `pay` / `fund` / `admin`.`mutav.finance`). The enforcement mechanism is the cookie posture in [Non-trust-boundary principles](#non-trust-boundary-principles): cookies are `Host-Only` (no `Domain=.mutav.finance`), so a session set on one origin is unreachable from another. A bug or compromise on one origin does not yield access to another origin's session, even though the origins share a parent domain. This is the boundary that limits the blast radius of #1 (Auth0) and #8 (Mutav-admin) across persona apps. Before the monorepo migration (see [ADR 0003](decisions/0003-persona-app-origin-isolation-single-convex.md)) lands, all shells share an origin — this boundary is a future commitment, not a current control.

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
- **All cookies are `Host-Only`.** No `Domain=.mutav.finance` ever. A session cookie set on one persona app's origin is never sent to a sibling subdomain. Forecloses cross-subdomain cookie leakage between staff (`apps/admin`) and customer-facing surfaces (`apps/agency`, `apps/fund`, `apps/pay`). Pair with `SameSite=Strict`, `Secure`, `HttpOnly` on every session cookie. See [ADR 0003](decisions/0003-persona-app-origin-isolation-single-convex.md) (decision 5).
- **One Auth0 application; staff distinctness is a connection, not a separate app.** Every Auth0-authenticated surface shares a **single Auth0 application** (one client id / `aud`, one Convex provider). Mutav-internal staff authenticate through a `mutavStaff` _connection_ on that same app that is administratively distinct from the agency-staff connection — mandatory MFA (Post-Login Action) + shorter session + no self-signup (no IP allowlist — decided in [#206](https://github.com/mutav-finance/mutav-app/issues/206)). A separate admin _application_ (its own `aud`) was dropped ([#215](https://github.com/mutav-finance/mutav-app/pull/215)) since `aud` is not a capability gate. Escalation path (separate Auth0 _tenant_) is documented; trigger = BACEN/CVM diligence requires it. See [`admin.md`](admin.md) § Subdomain split and [ADR 0003](decisions/0003-persona-app-origin-isolation-single-convex.md) (#215 amendment).
- **Convex stays a single deployment.** The four persona apps share one Convex (the Mutav API). Load-bearing: the hash-chained audit log + Merkle anchor in [`reliability.md`](reliability.md) § Audit log integrity requires a single writer. Per-app backends are explicitly rejected; the trade-off is acknowledged (if Convex has an incident, all apps degrade together).
