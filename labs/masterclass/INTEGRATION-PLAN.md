# Integration plan — masterclass labs → Mutav payment system

How to translate what we verified in `labs/masterclass/` into production code, ordered for incremental landing on `main`.

## Current state (2026-05-17)

### What `main` already has

- `convex/payments/` — `payments` table, three method kinds in the discriminated union: `boleto | stellar | pix`.
- `src/app/[locale]/(public)/pagar/[publicId]/` — three checkout subroutes: `/pix`, `/stellar`, `/anchortest` + the picker.
- `convex/anchors/` — domain (`getProviderForAgency` stub returning `testanchor`), `accountDomain` + `accountUseCases` (proxy account management), `orderDomain` + `orderUseCases` (anchor orders), and a 646-line `actions.ts` calling SEP modules via the registry.
- `src/lib/anchors/` — framework only (registry, SEP-10/SEP-6/SEP-12/SEP-24/SEP-31/SEP-38 modules, `testanchor/` reference impl). No Etherfuse client on main.
- `src/lib/stellar/testnet-wallet.md` — disposable shared treasury (`GD7Z…NWV`), USDC trustline established, used by `convex/lib/env.ts → getMutavSourceAccount()`.
- Horizon polling indexer marks Stellar payments paid (referenced in checkout page docstring).

### What `feat/etherfuse-followup` already adds

10+ commits not yet on main. The substantive ones:

| Commit                                                                     | Adds                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `c3b11b7` chore: vendor regional-starter-pack anchor interface and clients | `src/lib/anchors/etherfuse/` ported from the starter pack the masterclass references |
| `c093d8a` feat: adapt Etherfuse client for BR business KYB + env getters   | BR-flavored client + env wiring                                                      |
| `b0f0538` feat: pixAnchor constructor + agency Etherfuse helpers           | `agencies/anchorHelpers.ts`-style boundary                                           |
| `e18eb98` feat: schema migration for anchor orders + webhook events        | tables for tracking on-ramp orders + replayable webhook events                       |
| `b4b3f9f` feat: webhook stub + Etherfuse registration script               | scaffolding for the webhook endpoint + a script to register it                       |
| `38bced0` feat: admin UI for agency Etherfuse onboarding                   | per-agency Etherfuse setup flow in the dashboard                                     |
| `e65d46c`/`a6c51a6` i18n keys                                              | pt-BR + en for the pix_anchor method + admin UI                                      |
| `be20bfa`/`3cd53f2` convex/anchors/ core merges                            | domain + useCases + actions extensions                                               |

That branch is in the right shape — most of the integration is already drafted. **The labs don't replace it; they de-risk the parts of it that touch the live Etherfuse API.**

## What the labs proved that the followup branch may not have

These are gaps the masterclass slides got wrong/skipped, which our labs verified the real path for. Worth double-checking against `feat/etherfuse-followup`:

1. **`POST /customers` doesn't exist.** Customer + bank account UUIDs are client-generated and registered via `POST /ramp/onboarding-url`. If the followup branch tries to "create customer" anywhere, it's calling a nonexistent endpoint.
2. **Hosted onboarding alone doesn't unlock orders.** Wallet stays at `kycStatus: proposed`. You must `POST /ramp/customer/{id}/kyc` (id field nested everywhere) — sandbox auto-approves. Production needs a real KYC submission per tenant.
3. **Terms acceptance is per-customer, takes the presigned URL.** `POST /ramp/agreements/terms-and-conditions { presignedUrl }`.
4. **Off-ramp memo is `hash` (base64 32-byte buffer), not `text`.** Use `Memo.hash(Buffer.from(withdrawMemo, "base64"))` — Soroban can't carry memos, so off-ramp must be classic.
5. **Target-asset trustline auto-open.** Etherfuse rejects orders to wallets that can't hold the target asset. The on-ramp script handles this for TESOURO; mirror the pattern for any other asset.
6. **Sandbox doesn't auto-progress Pix payments.** Orders sit at `status: created` until manual dashboard progression. Production payments advance via real Pix; sandbox testing requires a UI step.
7. **One Stellar G-address per customer, globally.** Reusing an address across orgs returns 409. Use per-tenant proxy accounts (the `accountDomain` from the followup branch).
8. **Webhook signature: HMAC-SHA256 over canonicalized JSON (RFC 8785).** Not raw body. We use the `canonicalize` package — verify the followup branch matches.

## Recommended PR sequence

Aim for small, independently-mergeable slices. Don't try to land `feat/etherfuse-followup` as one big PR — split it where the labs say to.

### PR-1 — rebase + sanity-check `feat/etherfuse-followup` against the labs

**Goal:** the followup branch reflects the verified API shapes.

- Rebase `feat/etherfuse-followup` on current `main`.
- Diff its `src/lib/anchors/etherfuse/*` against `labs/masterclass/lib/etherfuse.ts` — confirm:
  - `Authorization: <key>` header, no Bearer prefix.
  - `POST /ramp/onboarding-url` is what creates customer state, not `POST /customers`.
  - Customer + bank UUIDs are client-generated.
- Diff its webhook handler against `labs/masterclass/02-etherfuse/06-webhook-server.ts` — confirm canonicalized-JSON signature verification, not raw body.
- Update if any of #1–#8 above don't match.

### PR-2 — backend on-ramp action against real Etherfuse

**Goal:** when the user picks "pix" on `/pagar/[publicId]/pix`, Convex actually calls Etherfuse.

- Take the bits of `labs/masterclass/02-etherfuse/03-onramp.ts` that are HTTP calls (quote + order). Drop the trustline auto-open here — it belongs in proxy-account provisioning (PR-3).
- New Convex action `convex/anchors/actions.ts` → `createOnrampOrder({ agencyId, paymentId, amountBRLCents })`:
  1. Resolve agency's Etherfuse config via `getProviderForAgency`.
  2. Look up tenant's proxy account from `convex/anchors/accountUseCases.ts`.
  3. `POST /ramp/quote` → `POST /ramp/order` → store `anchorOrders` row keyed by `paymentId`.
  4. Return `{ depositAmount, depositBankName, depositAccountHolder, depositPixKey?, expiresAt }` to the route handler.
- `/pix` route reads the response and renders the Pix QR / copy-paste key.

### PR-3 — proxy account provisioning per tenant

**Goal:** each tenant gets a dedicated, sponsored Stellar account that's registered with Etherfuse.

- Use the Zero-Friction pattern from `labs/masterclass/01-sdk-advanced/04-zero-friction-onboarding.ts`:
  - Treasury sponsors the new account's base reserve and the TESOURO trustline.
  - User key generated server-side (HSM or KMS in prod; env for dev) and stored encrypted in `anchorAccounts`.
  - Followup branch's `accountDomain.ts` already shapes this — wire the actual creation tx.
- After the account exists, call `POST /ramp/onboarding-url` with that account's pubkey + new customer/bank UUIDs.
- The hosted-onboarding URL is presented to the agency admin (already wired in the followup branch's admin UI).
- After they complete onboarding, call `POST /ramp/customer/{id}/kyc` + `POST /ramp/agreements/terms-and-conditions` programmatically. Sandbox auto-approves; production tenants paste their real CPF/CNPJ via the admin UI before this step.

### PR-4 — webhook receiver

**Goal:** Etherfuse pushes `order_updated` → we advance the corresponding `payments` row's state.

- Port `labs/masterclass/02-etherfuse/06-webhook-server.ts` semantics into a Convex HTTP action (`convex/http.ts`):
  - HMAC-SHA256 verification over canonicalized JSON.
  - Idempotency: dedupe via `anchorWebhookEvents` table (followup branch has the schema).
  - On `order_updated` with `status=completed`: set the corresponding `payments` row to `state: { kind: "paid", paidAt }`.
- Register the URL once per environment via `bun run 2:webhook:register https://convex-deployment.convex.site/etherfuse-webhook`.

### PR-5 — off-ramp (deferred — not the v1 priority)

Mutav's rental-guarantee flow probably keeps funds in TESOURO (yields ~CDI on its own per slide 13), so off-ramp may not be needed for the first user-facing release. If/when it lands:

- Port `labs/masterclass/02-etherfuse/05-offramp.ts`: quote with `useAnchor: true` + classic payment with `Memo.hash(base64-decoded)`.
- Triggered from the admin UI on tenant withdrawal request.

## User flow after PR-2 + PR-3 + PR-4

```
1. Tenant lands on /pagar/PAY-2026-05-0123/pix
2. Server action createOnrampOrder fires:
     resolveProxyAccount(agencyId)        → CABC… (provisioned in PR-3)
     etherfuse.quote(BRL → TESOURO)        → { sourceAmount, destinationAmount, rate }
     etherfuse.order(quoteId, proxyAcct)   → { depositAmount, depositPixKey, … }
   → row in anchorOrders, status=created
3. Page renders Pix dynamic key + amount
4. Tenant pays in their banking app
5. Etherfuse webhook arrives at convex/http.ts/etherfuse:
     verify signature → check idempotency → look up anchorOrder by orderId
     → mark payments row paid
6. /pago renders the receipt; agency dashboard updates
```

Compared to the masterclass slide-21 flow, the difference is **the treasury never holds tenant funds directly** — Etherfuse mints TESOURO to a per-tenant proxy account that the agency controls.

## Open questions (need product / arch decisions)

1. **Per-tenant vs per-agency proxy accounts?** Slide hints at per-customer; for rental guarantees, an "account per contract" model might be cleaner since funds are tied to a specific guarantee. Affects PR-3 scope.
2. **Where do tenant Stellar secrets live?** Encrypted at rest in `anchorAccounts` (followup branch's pattern), Auth0-derived keys post-auth (the deferred Auth0 work), or a real KMS? For sandbox we're fine with env vars; production needs a decision before any real money.
3. **KYC data source.** Sandbox auto-approves with fake CPF. In production we need real CPF/CNPJ from the agency's CRM or from the tenant during contract creation. The contract wizard (#41-#44 in recent commits) already collects tenant data — confirm CPF lands in `anchorOrders` payload.
4. **Idempotency keys for `paymentId → orderId`.** Each `payments` row can only have one open Etherfuse order at a time. Retry semantics: if the first quote expires, do we create a new order or reject? Codify in `orderDomain`.
5. **Off-ramp authorization model.** When/who triggers a TESOURO → BRL conversion? Tenant-initiated, agency-initiated, or contract-end automatic? Affects when (or whether) PR-5 lands.
6. **What about the existing `anchortest` method?** The picker currently shows three cards including anchortest. After Etherfuse Pix is live, anchortest is a dev-only debugging tool — hide it behind a feature flag or remove from the public picker entirely.

## What the masterclass leaves on the floor

These are slide-level capabilities we did **not** explore because Mutav doesn't need them for v1:

- **Sponsored reserves + fee bump on the user-facing tx** (slide 09 Zero-Friction pattern). Only relevant when users sign their own Stellar txs. If Mutav's tenants never directly hold a Stellar wallet (everything goes through the proxy account the agency controls), this is moot.
- **DeFi composition** (Soroswap → Blend → DeFindex). Already scaffolded as exploration in `03-defi/`. Becomes relevant if we want to convert/yield-farm the float; not required for the on-ramp itself.
- **Soroban smart contracts** (Bloco 4). Mutav has no on-chain contract; the guarantee state lives in Convex. Soroban becomes relevant only if we go on-chain for the guarantee escrow.
- **x402** (Bloco 5). Pay-per-call API monetization. Not relevant unless Mutav exposes a paid API to other software.

## TL;DR action items

If you want to merge to main this week:

1. Rebase `feat/etherfuse-followup` on main; reconcile against labs gaps #1–#8.
2. Open PR-1 (audit + sanity).
3. Split the rest as PR-2 (action), PR-3 (proxy accounts), PR-4 (webhook).
4. Defer PR-5 (off-ramp) and `03-defi/` until v2.

The labs branch (`feat/masterclass-anchor-x402`) stays as reference — kept in `labs/masterclass/` so future devs can re-run the verified scripts when Etherfuse changes anything.
