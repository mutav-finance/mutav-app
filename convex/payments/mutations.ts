import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
  PAYMENT_LINE_ITEM_KIND,
  PAYMENT_STATE_KIND,
  PaymentMethods,
  PaymentStates,
  isChargeable,
} from "./domain";
import { generatePaymentMuxedId } from "./lib/muxedId";

/**
 * Generate one `payments` record per agency for the given billing period.
 *
 * Rules:
 * - Only `ativo` contracts contribute line items.
 * - Every active contract generates a `recurring` line item (feeCents).
 * - Contracts whose `_creationTime` falls within the period also get an
 *   `activation` line item (oneTimeActivationFeeCents).
 * - Idempotent: skips agencies that already have a record for the period.
 * - `state` starts as `pending`; `method` is `null` until the agency chooses one.
 * - `dueDate` is always the 10th of the billing month.
 *
 * Call manually:
 *   bunx convex run payments/mutations:generateMonthlyPayments '{"periodMonth":"2026-05"}'
 */
export const generateMonthlyPayments = internalMutation({
  args: { periodMonth: v.string() },
  handler: async (ctx, { periodMonth }) => {
    // Period boundaries (UTC ms) — used to detect newly activated contracts.
    const [yearStr, monthStr] = periodMonth.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const periodStart = Date.UTC(year, month - 1, 1);
    const periodEnd = Date.UTC(year, month, 1); // exclusive

    const dueDate = `${periodMonth}-10`;
    const issuedAt = new Date().toISOString().split("T")[0]!;

    const agencies = await ctx.db.query("agencies").collect();

    type Result =
      | { agencyId: string; skipped: true }
      | { agencyId: string; paymentId: string; totalCents: number; lineItemCount: number };

    const results: Result[] = [];

    for (const agency of agencies) {
      // ── Idempotency check ──────────────────────────────────────────────────
      const existing = await ctx.db
        .query("payments")
        .withIndex("by_agency_period", (q) =>
          q.eq("agencyId", agency._id).eq("periodMonth", periodMonth),
        )
        .unique();

      if (existing !== null) {
        results.push({ agencyId: agency._id, skipped: true });
        continue;
      }

      // ── Collect active contracts ───────────────────────────────────────────
      const activeContracts = await ctx.db
        .query("contracts")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", agency._id).eq("status", "ativo"))
        .collect();

      const lineItems: Array<{
        contractId: (typeof activeContracts)[number]["_id"];
        contractPublicId: string;
        kind: "recurring" | "activation";
        amountCents: number;
        description: string;
      }> = [];

      for (const contract of activeContracts) {
        // Recurring fee — every active contract.
        lineItems.push({
          contractId: contract._id,
          contractPublicId: contract.publicId,
          kind: PAYMENT_LINE_ITEM_KIND.RECURRING,
          amountCents: contract.rental.feeCents,
          description: `Mensalidade — contrato ${contract.publicId}`,
        });

        // Activation fee — contracts first activated within this billing period.
        const activatedThisPeriod =
          contract._creationTime >= periodStart && contract._creationTime < periodEnd;

        if (activatedThisPeriod && contract.rental.oneTimeActivationFeeCents > 0) {
          lineItems.push({
            contractId: contract._id,
            contractPublicId: contract.publicId,
            kind: PAYMENT_LINE_ITEM_KIND.ACTIVATION,
            amountCents: contract.rental.oneTimeActivationFeeCents,
            description: `Taxa de ativação — contrato ${contract.publicId}`,
          });
        }
      }

      const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

      // Public ID: PAY-{period}-{last 4 digits of CNPJ or CPF}
      const identifier = agency.cnpj ?? agency.cpf ?? "0000";
      const publicId = `PAY-${periodMonth}-${identifier.slice(-4)}`;

      const paymentId = await ctx.db.insert("payments", {
        agencyId: agency._id,
        publicId,
        periodMonth,
        issuedAt,
        dueDate,
        totalCents,
        state: PaymentStates.pending(),
        method: null,
        muxedId: generatePaymentMuxedId(),
        lineItems,
      });

      results.push({
        agencyId: agency._id,
        paymentId,
        totalCents,
        lineItemCount: lineItems.length,
      });
    }

    return results;
  },
});

/**
 * Scan all `pending` payments and flip to `overdue` those whose `dueDate`
 * is strictly before today (UTC date).
 *
 * Processes up to 200 at a time; safe to run repeatedly (idempotent).
 */
export const markOverduePayments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0]!;

    const pending = await ctx.db
      .query("payments")
      .withIndex("by_state_kind", (q) => q.eq("state.kind", PAYMENT_STATE_KIND.PENDING))
      .take(200);

    let count = 0;
    for (const payment of pending) {
      if (payment.dueDate < today) {
        await ctx.db.patch(payment._id, { state: PaymentStates.overdue() });
        count++;
      }
    }

    return { markedOverdue: count };
  },
});

/**
 * Choose a payment method for an existing pending (or overdue) payment.
 * Exposed as internal so the agency-facing action layer controls validation.
 */
export const setPaymentMethod = internalMutation({
  args: {
    paymentId: v.id("payments"),
    method: v.union(
      v.object({ kind: v.literal("boleto") }),
      v.object({ kind: v.literal("stellar"), destinationAddress: v.string() }),
      v.object({ kind: v.literal("pix"), pixKey: v.string() }),
    ),
  },
  handler: async (ctx, { paymentId, method }) => {
    const payment = await ctx.db.get(paymentId);
    if (!payment) throw new Error(`Payment ${paymentId} not found`);

    if (!isChargeable(payment.state)) {
      throw new Error(`Cannot change method on a payment in state "${payment.state.kind}"`);
    }

    let newMethod: NonNullable<(typeof payment)["method"]>;

    switch (method.kind) {
      case "boleto":
        newMethod = PaymentMethods.boleto(null);
        break;
      case "stellar":
        newMethod = PaymentMethods.stellar(method.destinationAddress);
        break;
      case "pix":
        newMethod = PaymentMethods.pix(method.pixKey);
        break;
    }

    await ctx.db.patch(paymentId, { method: newMethod });
    return { paymentId, method: newMethod };
  },
});

/**
 * Idempotent mark-as-paid. Called by the Horizon reconciler when an
 * incoming Stellar payment matches a pending invoice's muxed-id.
 *
 * No-ops if the payment is already paid with the same txHash (re-runs
 * after restart are safe). Records the muxed `M…` destination + tx hash
 * on `method` and moves state to `paid` with the observed timestamp.
 */
export const markPaidByTx = internalMutation({
  args: {
    paymentId: v.id("payments"),
    txHash: v.string(),
    paidAt: v.string(),
    muxedAddress: v.string(),
  },
  handler: async (ctx, { paymentId, txHash, paidAt, muxedAddress }) => {
    const payment = await ctx.db.get(paymentId);
    if (!payment) return { paymentId, status: "not_found" as const };

    if (payment.state.kind === "paid") {
      const existingTx = payment.method?.kind === "stellar" ? payment.method.txHash : null;
      if (existingTx === txHash) return { paymentId, status: "already_paid" as const };
      return { paymentId, status: "duplicate_inbound" as const };
    }

    await ctx.db.patch(paymentId, {
      state: PaymentStates.paid(paidAt),
      method: PaymentMethods.stellar(muxedAddress, txHash),
    });
    return { paymentId, status: "paid" as const };
  },
});

/**
 * Idempotent mark-as-paid for anchor-mediated on-ramps (e.g. testanchor /
 * Etherfuse Pix). Called from `pollPixOnramp` when the underlying anchor
 * order reaches `completed`.
 *
 * No-ops if the payment is already paid via the same anchor txId. Records
 * the anchor's reported PIX key + anchor transaction ID on `method` and
 * moves state to `paid` with the observed timestamp.
 */
export const markPaidByAnchor = internalMutation({
  args: {
    paymentId: v.id("payments"),
    anchorTxId: v.string(),
    pixKey: v.string(),
    paidAt: v.string(),
  },
  handler: async (ctx, { paymentId, anchorTxId, pixKey, paidAt }) => {
    const payment = await ctx.db.get(paymentId);
    if (!payment) return { paymentId, status: "not_found" as const };

    if (payment.state.kind === "paid") {
      const existingTxId = payment.method?.kind === "pix" ? payment.method.txId : null;
      if (existingTxId === anchorTxId) return { paymentId, status: "already_paid" as const };
      return { paymentId, status: "duplicate_inbound" as const };
    }

    await ctx.db.patch(paymentId, {
      state: PaymentStates.paid(paidAt),
      method: PaymentMethods.pix(pixKey, anchorTxId),
    });
    return { paymentId, status: "paid" as const };
  },
});

/**
 * Dev-only: flip a payment back to `pending` and clear `method`. Used to
 * rerun the demo flow against an already-paid invoice. The Horizon cursor
 * is not rewound, so the original tx is NOT re-discovered — only NEW
 * incoming payments to the muxed address re-mark this payment paid.
 *
 *   bunx convex run payments/mutations:resetPaymentToPending '{"publicId":"PAY-TEST-001"}'
 */
export const resetPaymentToPending = internalMutation({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique();
    if (!payment) throw new Error(`Payment ${publicId} not found`);
    const previousState = payment.state.kind;
    await ctx.db.patch(payment._id, {
      state: PaymentStates.pending(),
      method: null,
    });
    return { publicId, previousState };
  },
});

/**
 * Persist the latest Horizon paging token for a treasury account, so the
 * next polling tick resumes after the last processed record.
 */
export const setStellarIndexCursor = internalMutation({
  args: { sourceAccount: v.string(), cursor: v.string() },
  handler: async (ctx, { sourceAccount, cursor }) => {
    const lastRunAt = new Date().toISOString();
    const existing = await ctx.db
      .query("stellarIndexState")
      .withIndex("by_sourceAccount", (q) => q.eq("sourceAccount", sourceAccount))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { cursor, lastRunAt });
      return existing._id;
    }
    return ctx.db.insert("stellarIndexState", { sourceAccount, cursor, lastRunAt });
  },
});
