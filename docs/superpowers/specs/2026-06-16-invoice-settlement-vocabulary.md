# Payments → Invoice + Settlement vocabulary alignment — scope

> **Status:** Scope / design spec. Decomposes into per-phase implementation plans
> (`docs/superpowers/plans/`). Each phase ships independently and leaves `main`
> deployable.

## Purpose

Today the `payments` table conflates two distinct industry concepts into one word:

- the **bill** (line items, billing period, issue + due date, total) — an **Invoice**
- the **act of settling** it (boleto clearing, Pix receipt, Stellar deposit) — a **Payment / Charge**

Every standard (Stripe, Asaas/_cobrança_, Mercado Pago) keeps these separate. Aligning
unlocks precise language (“invoice paid **by** a payment”), a clean home for the
on-chain settlement record the operator runtime (#141, #160) will produce, and pt-BR
labels that match Brazilian accounting (“fatura em aberto”).

## Decisions locked (2026-06-16)

| Axis              | Decision                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Depth             | **Tier C** — rename `Payment→Invoice` **and** introduce a distinct settlement `Payment` record                    |
| Tenant URLs       | `publicId` **`PAY-`→`INV-`**; **keep** the payer route at `/pay` (tenant-friendly, matches Stripe hosted-invoice) |
| Status vocabulary | **Stripe names** with agreed pt-BR translations (below)                                                           |

Pre-launch assumption (load-bearing for the cheap migration path): **no production
tenant holds a live `PAY-` link** — only seed data exists. Confirm before Phase 1.

## Target model (Tier C end-state)

Stripe’s Invoice ↔ PaymentIntent/Charge split, two tables:

### `invoices` (renamed from `payments`)

```
agencyId      Id<"agencies">
publicId      string            // INV-{period}-{last4 of CNPJ/CPF}   (was PAY-)
periodMonth   string
issuedAt      string
dueDate       string
totalCents    number
status        "draft" | "open" | "paid" | "void" | "uncollectible"
lineItems     { contractId, contractPublicId, kind, amountCents, description }[]
muxedId?      string            // stable per-invoice Stellar receiving address (stays here)
```

- No `method` field — a bill has no method.
- `overdue` is **derived** (`status === "open" && now > dueDate`), not stored.
- `status` is driven by settlement: a succeeded `payment` → `paid`; write-off → `uncollectible`.

### `payments` (NEW — the settlement record)

```
invoiceId     Id<"invoices">
agencyId      Id<"agencies">    // denormalized for by_agency scoping
method        "boleto" | "pix" | "stellar"
status        "pending" | "processing" | "succeeded" | "failed" | "canceled"
amountCents   number
paidAt?       string
// method-specific (discriminated by `method`):
//   boleto:  barcode
//   pix:     pixKey, txId
//   stellar: destinationAddress, txHash
createdAt     string
```

One invoice → zero-or-more payments (attempts). The Horizon indexer /
`markPaidByAnchor` create + transition `payment` rows and flip the invoice to `paid`.

> **Name reuse caveat:** the word `payments` is _retired then reused_ (old = bill, new =
> settlement). The phase ordering below renames the bill away **first**, so the two
> meanings never coexist under one name.

## Domain ownership

The split is a **two-domain boundary** — one concern each (per CLAUDE.md § Domain design):

| Domain             | Owns                                                                                                                                                       | Does NOT own                                            | Driven by                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `convex/invoices/` | **Generation** of the bill from contracts for a period; lifecycle `status`; line items; period; due date                                                   | Settlement, payment method, provider/anchor integration | **Agency** — agent creates/manages invoices in `apps/agency`    |
| `convex/payments/` | Payment-method **integrations & processing** (boleto/Pix via Etherfuse-anchor, Stellar); settlement records; status transitions; webhook/indexer ingestion | What's owed (the invoice), contract data                | **Tenant checkout** (`apps/pay`) + operator runtime (#141/#160) |

The dividing line: **invoices = _what_ is owed** (an agency concern), **payments = _how_
it gets settled** (an integration/processing concern). The invoice carries no method; the
payment owns the method and the rail-specific integration. A succeeded payment is the only
thing that flips an invoice to `paid`; the agency never writes settlement state directly.

Concretely, Phase 2 moves the anchor/Etherfuse actions and the Horizon indexer under the
`payments/` domain — they are settlement processing, not invoice generation.

## Vocabulary map (code → pt-BR / en)

### Invoice status — `INVOICE_STATUS`

| Stripe code           | pt-BR (fatura, fem.) | en            |
| --------------------- | -------------------- | ------------- |
| `draft`               | Rascunho             | Draft         |
| `open`                | Em aberto            | Open          |
| `paid`                | Paga                 | Paid          |
| `void`                | Anulada              | Void          |
| `uncollectible`       | Incobrável           | Uncollectible |
| _(derived)_ `overdue` | Em atraso            | Overdue       |

Current → new status mapping: `pending → open`, `paid → paid`, `canceled → void`,
`overdue → derived`. `draft` + `uncollectible` are added (may be unused at first;
`uncollectible` is the write-off state that couples to delinquencies #52 + reserve coverage).

### Payment (settlement) status — `PAYMENT_STATUS`

| code         | pt-BR       | en         |
| ------------ | ----------- | ---------- |
| `pending`    | Pendente    | Pending    |
| `processing` | Processando | Processing |
| `succeeded`  | Confirmado  | Succeeded  |
| `failed`     | Falhou      | Failed     |
| `canceled`   | Cancelado   | Canceled   |

### Method — unchanged (already Stripe-aligned)

`boleto` · `pix` · `stellar` → Boleto · Pix · Stellar

### Line-item kind — minor open decision

`recurring` (keep; = Stripe `recurring`). `activation` → keep (domain-clearer) **or**
rename to Stripe `one_time`. Lean: keep `activation`. (Decide in Phase 1.)

### Symbol renames (Phase 1 unless noted)

| Today                                      | New                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| table `payments`                           | `invoices`                                                                    |
| `convex/payments/`                         | `convex/invoices/` (new `convex/payments/` reappears in Phase 2 = settlement) |
| `Payment`, `PaymentId`                     | `Invoice`, `InvoiceId`                                                        |
| `PaymentState`, `PaymentStateKind`         | `InvoiceStatus`, `InvoiceStatusKind`                                          |
| `PAYMENT_STATE_KIND`                       | `INVOICE_STATUS`                                                              |
| `PAYMENT_METHOD_KIND`                      | moves to settlement domain (Phase 2)                                          |
| `api.payments.useCases.*`                  | `api.invoices.useCases.*`                                                     |
| `generatePaymentMuxedId`                   | `generateInvoiceMuxedId`                                                      |
| publicId `PAY-…`                           | `INV-…`                                                                       |
| agency route `/payments`, `/payments/[id]` | `/invoices`, `/invoices/[id]`                                                 |
| tenant route `/pay/[publicId]`             | **unchanged**                                                                 |
| components `payment-*` (agency)            | `invoice-*`                                                                   |
| pay-app components                         | `checkout-*` (payer-side) settles the prefix split                            |

## Phasing — three independently-shippable plans

### Phase 0 — Lexicon (Tier A) · hours · zero schema risk

- Agency UI label **“share link” → “Link de pagamento” / “Payment Link”**; rename the
  `checkoutUrl` helper (added in the boleto-link fix) to `paymentLinkUrl`.
- Settle the component-prefix policy (`checkout-*` payer-side; `invoice-*` document) —
  rename only; no behavior change.
- Ships value immediately, independent of the migration.

### Phase 1 — Invoice rename (Tier B) · days · schema + reseed

- Rename table/domain/types/api/routes/components/publicId per the symbol table.
- Adopt `INVOICE_STATUS` + pt-BR/en labels; `pending→open`, `canceled→void`, `overdue`
  derived.
- **Migration path (pre-launch):** rename in `convex/schema.ts` + update `convex/seed.ts`
  - wipe-and-reseed the dev deployment. No `@convex-dev/migrations` needed _while
    pre-launch_ (per `.claude/notes/deferred-conventions.md`). If a prod deployment with
    real rows exists, escalate to widen→backfill→narrow with `@convex-dev/migrations`.
- Leaves `method` + on-chain refs on the invoice **for now** (removed in Phase 2).

### Phase 2 — Settlement split (Tier C) · architectural · couples to #141/#160

- Introduce the new `payments` (settlement) table + `convex/payments/` domain.
- Move `method` + boleto/pix/stellar refs off `invoices` onto `payments`.
- Rewire the `/pay` checkout flow and the Horizon indexer to **create/transition payment
  rows**; derive `invoice.status` from them.
- Fold in the two known boundary fixes here: the `listByAgency` violation in
  `checkout-pix-view.tsx` (route through a `publicId`-gated path) and confirm the
  cross-origin `paymentLinkUrl` from Phase 0.

## Open design questions (resolve before Phase 2 plan)

1. Does selecting a method create a `payment` immediately (`pending`, Stripe-style) or
   only on settlement?
2. One `payment` per attempt, or one mutable row per invoice? (boleto/pix usually one.)
3. `muxedId` home — proposed: stays on `invoice` (stable receiving address). Confirm.
4. Do we use `draft` at all, or are invoices finalized (`open`) on creation?
5. `uncollectible` ↔ delinquencies (#52) ↔ reserve coverage — coordinate the write-off path.

## Risks / watch-items

- **`payments` name reuse** — mitigated by phase order (rename bill away first).
- **Blast radius:** `payments` ×187, `Payment` ×35, `"PAY-` ×33, ~116 i18n keys, plus
  regenerated `_generated/api`. Do per-area, lean on `tsc --noEmit` between areas; keep
  pt-BR/en keys in sync in the same commit.
- **Tenant URL change `PAY-→INV-`** is only safe pre-launch — gate Phase 1 on the
  no-live-links confirmation.
- Cents migration is **not** a blocker — already done for this domain (`*Cents` fields,
  no `*BRL` in schema).

## References

- `docs/architecture/README.md` (Actor/Shell catalogs, trust boundaries)
- `docs/superpowers/specs/2026-05-31-monorepo-migration-design.md` (origin/trust split)
- Stripe Invoice object + statuses; Asaas _link de pagamento_ (benchmark sources)
- `.claude/notes/deferred-conventions.md` (cents migration; pre-launch reseed guidance)
- Issues: #52 delinquencies, #141/#160 operator-runtime settlement, #180 vocabulary-migration precedent
