import type { MutationCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import type { InvoiceId } from "../invoices/domain";
import type { ProviderOrderId } from "./providers/orderDomain";
import type { PaymentId, PaymentStatus, SettlementMethod } from "./domain";

type RecordSettlementArgs = {
  agencyId: AgencyId;
  invoiceId: InvoiceId;
  status: PaymentStatus;
  amountCents: number;
  method: SettlementMethod;
  paidAt?: string;
  externalRef?: string;
  providerOrderId?: ProviderOrderId;
};

/**
 * Plain helper called inline from a mutation handler (shares its transaction).
 *
 * Idempotent on `externalRef`: indexer restarts and webhook retries replay the
 * same provider reference, so a matching row short-circuits to the existing id
 * instead of inserting a duplicate settlement.
 */
export async function recordSettlement(
  ctx: MutationCtx,
  args: RecordSettlementArgs,
): Promise<PaymentId> {
  const { externalRef } = args;
  if (externalRef !== undefined) {
    const existing = await ctx.db
      .query("payments")
      .withIndex("by_externalRef", (q) => q.eq("externalRef", externalRef))
      .first();
    if (existing) {
      return existing._id;
    }
  }
  return ctx.db.insert("payments", args);
}
