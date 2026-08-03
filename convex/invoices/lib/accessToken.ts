import type { QueryCtx } from "../../_generated/server";
import type { Invoice } from "../domain";

/**
 * The only way to turn a tenant bearer token into an invoice.
 *
 * Centralized because the failure mode is asymmetric. `accessToken` is
 * optional on the schema, so a row that predates the field is stored under the
 * `undefined` key of `by_accessToken`; rejecting a blank token before the index
 * is touched keeps "the payer presented nothing" from ever meeting "this row
 * holds nothing". Unknown token and missing token are the same `null` so no
 * caller can distinguish them.
 */
export async function findInvoiceByAccessToken(
  ctx: QueryCtx,
  accessToken: string,
): Promise<Invoice | null> {
  if (accessToken.length === 0) return null;
  return ctx.db
    .query("invoices")
    .withIndex("by_accessToken", (q) => q.eq("accessToken", accessToken))
    .unique();
}
