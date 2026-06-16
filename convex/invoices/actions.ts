"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getMutavSourceAccount, getStellarHorizonUrl } from "../lib/env";

type HorizonPaymentRecord = {
  type: string;
  to?: string;
  to_muxed?: string;
  to_muxed_id?: string;
  transaction_hash: string;
  created_at: string;
  paging_token: string;
};

type HorizonPaymentsResponse = {
  _embedded?: { records?: HorizonPaymentRecord[] };
};

/**
 * Poll the Mutav treasury account on Stellar Horizon for incoming muxed
 * payments. Decodes each `to_muxed_id`, looks up the matching open
 * invoice via the `by_muxedId` index, and marks it paid.
 *
 * Idempotent: cursor is persisted across runs, and `markPaidByTx` no-ops
 * when called twice with the same txHash. First run (no cursor) seeds the
 * cursor at "0" so historical payments are scanned once.
 */
type PollResult = {
  ok: boolean;
  status?: number;
  processed: number;
  scanned?: number;
  lastCursor?: string;
};

export const checkMutavTreasuryPayments = internalAction({
  args: {},
  handler: async (ctx): Promise<PollResult> => {
    const sourceAccount = getMutavSourceAccount();
    const horizon = getStellarHorizonUrl();

    const state = await ctx.runQuery(internal.invoices.useCases.getStellarIndexState, {
      sourceAccount,
    });
    const cursor = state?.cursor ?? "0";

    const url = `${horizon}/accounts/${sourceAccount}/payments?cursor=${cursor}&order=asc&limit=200`;
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, status: response.status, processed: 0 };
    }
    const data = (await response.json()) as HorizonPaymentsResponse;
    const records = data._embedded?.records ?? [];

    let processed = 0;
    let lastCursor = cursor;
    for (const record of records) {
      lastCursor = record.paging_token;
      if (record.type !== "payment") continue;
      if (record.to !== sourceAccount) continue;
      if (!record.to_muxed_id || !record.to_muxed) continue;

      const invoice = await ctx.runQuery(internal.invoices.useCases.findByMuxedId, {
        muxedId: record.to_muxed_id,
      });
      if (!invoice) continue;

      await ctx.runMutation(internal.invoices.mutations.markPaidByTx, {
        invoiceId: invoice._id,
        txHash: record.transaction_hash,
        paidAt: record.created_at,
        muxedAddress: record.to_muxed,
      });
      processed++;
    }

    if (lastCursor !== cursor) {
      await ctx.runMutation(internal.invoices.mutations.setStellarIndexCursor, {
        sourceAccount,
        cursor: lastCursor,
      });
    }

    return { ok: true, processed, scanned: records.length, lastCursor };
  },
});
