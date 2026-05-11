import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { PAYMENT_LINE_ITEM_KIND, PaymentMethods, PaymentStates } from "./domain";

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

      // Public ID: PAY-{period}-{last 4 digits of CNPJ}
      const publicId = `PAY-${periodMonth}-${agency.cnpj.slice(-4)}`;

      const paymentId = await ctx.db.insert("payments", {
        agencyId: agency._id,
        publicId,
        periodMonth,
        issuedAt,
        dueDate,
        totalCents,
        state: PaymentStates.pending(),
        method: null,
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
      .withIndex("by_state_kind", (q) => q.eq("state.kind", "pending"))
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

    const stateKind = payment.state.kind;
    if (stateKind !== "pending" && stateKind !== "overdue") {
      throw new Error(`Cannot change method on a payment in state "${stateKind}"`);
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
