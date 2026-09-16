# ADR 0006 — Invoice/settlement split: the bill is not the payment

**Status:** Accepted (2026-06-17), **shipped** · **Phase:** Pre-launch invoice refactor · **PRs:** [#185](https://github.com/mutav-finance/mutav-app/pull/185), [#186](https://github.com/mutav-finance/mutav-app/pull/186), [#189](https://github.com/mutav-finance/mutav-app/pull/189), [#191](https://github.com/mutav-finance/mutav-app/pull/191), [#193](https://github.com/mutav-finance/mutav-app/pull/193), [#194](https://github.com/mutav-finance/mutav-app/pull/194) · **Related:** [ADR 0003](0003-persona-app-origin-isolation-single-convex.md) (the `apps/pay` trust boundary that motivated the `listByAgency` closure)

## Context

The original `payments` table conflated two different things: **the bill** (what a tenant owes, its amount, its due date, its status) and **the settlement** (a concrete attempt to move money — via boleto, Pix, or a Stellar transfer — with its own provider reference, its own status, and its own failure modes). One row carried both, so `payment.method` was a column on the bill and a failed Pix attempt was indistinguishable from an unpaid invoice.

That conflation blocks the obvious things: retrying a settlement after a failure, recording two attempts against one bill, deriving the method actually used, and reconciling against a provider without mutating the bill.

The split ships as a **rename plus an extraction**: the bill becomes `invoices` (Stripe-shaped statuses: `open` / `paid` / `void`, with `overdue` derived), and a new `payments` table holds settlement rows pointing back at the invoice. `anchorOrders` becomes `providerOrders` — an order is the _attempt/intent_ against a provider; a completed order **produces** a settlement row.

This ADR records the Phase-2 decisions that were locked before the schema PRs landed. They were previously written down only in a session plan and a transient design spec, both since deleted; this file is now their home.

## Decisions

### 1. An invoice moves to `paid` on the **first `succeeded` settlement** — no partial payments

A single settlement row reaching `succeeded` flips the invoice to `paid`. There is no concept of a partially-paid invoice, no running balance, and no sum-of-settlements check. A bill is settled or it is not.

- **Alternative weighed:** track `amountPaidCents` on the invoice and derive `paid` when it reaches `amountCents`. Rejected — the Brazilian rental flow being modeled issues one invoice per rent period and expects it paid in one movement; a balance column buys generality nobody has asked for and puts an arithmetic invariant into every settlement write path.
- **Revisit if:** a real product requirement for installments or partial settlement appears. That is a schema change (balance field + a derived-status rule), not a patch.

### 2. `invoice.state` stays **authoritative**, not derived

The invoice's status is a stored column, patched by the settlement mutation when a settlement succeeds. It is _not_ computed on read from the settlement rows.

- **Why:** a derived status makes every list query fan out to the settlements table, and it makes the invoice's own history unreadable. `overdue` is the one exception — it is derived from the due date, because it depends on the current time rather than on any write.
- **Consequence:** the settlement mutation owns the invariant. Any new code path that marks a settlement `succeeded` **must** patch the invoice in the same mutation.

### 3. `method` and transaction fields move to the settlement row; **`muxedId` stays on the invoice**

`invoice.method` is dropped entirely. The method is derived from the succeeded settlement row via `resolveInvoiceMethod` (`convex/invoices/useCases.ts`). Transaction-shaped fields (barcode, Pix `txId`, Stellar `txHash`, destination address) live inside the settlement row's `method` variant.

**`muxedId` is the deliberate exception and stays on the invoice** (`convex/schema.ts` `by_muxedId`). It is the _receiving address_ — it must exist before any settlement is attempted, since it is what the payer sends to, and the Horizon-polling reconciler (`convex/invoices/actions.ts`) resolves an incoming transfer back to an invoice through it. Moving it to the settlement row would require creating a settlement before there is anything to settle.

### 4. `providerOrders` is the attempt; a completed order **produces** a settlement

`anchorOrders` → `providerOrders` was a hard rename (pre-launch, no compatibility shim). An order is an intent against a provider; when it completes it produces a settlement row. The link is `payments.providerOrderId?` — **optional**, because a settlement can arrive without an order behind it (a direct Stellar transfer to the invoice's muxed address has no provider order).

The SEP protocol library at `apps/agency/src/lib/anchors/` was **not** renamed — "anchor" is the correct domain word there. Only the Convex domain moved, to `convex/payments/providers/`.

### 5. Settlement idempotency dedupes on **`externalRef`**

The settlement insert is idempotent on `externalRef` (the txHash / anchorTxId / Pix txId, whichever the method supplies) via a `by_externalRef` index. Every dual-writing caller checks that index rather than checking whether the invoice is already `paid`.

- **Why not dedupe on invoice-already-paid:** that check races and is wrong for retries — it silently swallows a _second, distinct_ settlement instead of recognizing a _replay of the same one_. The external reference is the provider's own identity for the money movement; it is the only thing that distinguishes replay from a genuine second attempt.

### 6. Refunds and void-with-settlement are **out of scope for v1**

There is no refund path and no story for voiding an invoice that already has a succeeded settlement. This is a deliberate scope cut, not an oversight: the pilot has no refund flow, and designing a reversal model before there is a settlement model to reverse is speculative.

- **Consequence:** `void` is only legal on an invoice with no succeeded settlement. A mis-settled invoice is corrected operationally, not through the app.
- **Revisit if:** the pilot takes real money and a chargeback, provider reversal, or cancellation-after-payment occurs. Refunds are their own domain (a reversal row referencing the settlement), not a status on the invoice.

## Settlement `payments` table

```
payments: { agencyId, invoiceId, status, amountCents, paidAt?, externalRef?, providerOrderId?, method }
  status: pending | processing | succeeded | failed | canceled
  method: boleto{barcode} | pix{pixKey,txId} | stellar{destinationAddress,txHash}
  indexes: by_invoice, by_agency, by_externalRef
```

## Migration approach — wipe + reseed, not migrate-in-place

The schema PRs shipped as **wipe + reseed** rather than the documented widen → migrate → narrow two-PR pattern. Prod was empty pre-launch and dev data is disposable, so the new schema applies cleanly with no backfill.

This was a **context-specific override**, and it has since become the general rule: see CLAUDE.md § "Schema changes & migrations — reseed-first (pre-production)" and `.claude/notes/deferred-conventions.md` § "Convex data migrations". The migrate-in-place pattern is the plan for **after** the first real (non-seed) data lands.

## Consequences

- The invoice domain owns the bill only. Anything about _how money moved_ belongs in the settlement domain — reviewers should push back on new columns creeping onto `invoices`.
- The settlement mutation is the single writer of the `open → paid` transition. It is the place to look when an invoice's status is wrong.
- `resolveInvoiceMethod` is a read-time join. Every invoice read that needs a method pays for it; if that ever becomes hot, denormalizing a `settledMethod` column onto the invoice is the escape hatch — but it must be written by the same mutation that sets `paid` (decision 2's rule).
- Refund-shaped bug reports are a **known gap**, not a defect, until the revisit trigger in decision 6 fires.
