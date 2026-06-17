import { v } from "convex/values";
import { query } from "../_generated/server";
import { assertAgencyAccess } from "../lib/auth";
import type { Payment } from "./domain";

export const listByInvoice = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<Payment[]> => {
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) {
      return [];
    }
    try {
      await assertAgencyAccess(ctx, invoice.agencyId);
    } catch {
      return [];
    }
    return ctx.db
      .query("payments")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
      .collect();
  },
});
