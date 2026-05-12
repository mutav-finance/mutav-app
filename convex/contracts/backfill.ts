import { internalMutation } from "../_generated/server";
import { contractsByStatus } from "./aggregate";

/**
 * Seed the `contractsByStatus` aggregate from the current state of the
 * `contracts` table.
 *
 * Safe to run multiple times — uses `replaceOrInsert` which is idempotent.
 * Process at most 200 documents per call to stay well within Convex mutation
 * limits; re-run until the return value shows `processed < 200`.
 *
 * Usage:
 *   bunx convex run contracts/backfill:backfillContractAggregate
 *
 * After confirming the aggregate is correct, switch mutations.ts to use
 * `insert` / `replace` / `delete` (non-idempotent) for better perf.
 */
export const backfillContractAggregate = internalMutation({
  args: {},
  handler: async (ctx) => {
    const PAGE_SIZE = 200;

    const contracts = await ctx.db.query("contracts").take(PAGE_SIZE);

    for (const doc of contracts) {
      // insertIfDoesNotExist is idempotent — safe to re-run this backfill.
      await contractsByStatus.insertIfDoesNotExist(ctx, doc);
    }

    return { processed: contracts.length, done: contracts.length < PAGE_SIZE };
  },
});
