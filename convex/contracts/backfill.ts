import { internalMutation } from "../_generated/server";
import { insertContractAggregatesIfMissing } from "./aggregateWrites";
import { contractsByStatus } from "./aggregate";

const PAGE_SIZE = 200;

/**
 * Seed the `contractsByStatus` aggregate from the current state of the
 * `contracts` table.
 *
 * Safe to run multiple times — uses `insertIfDoesNotExist` which is idempotent.
 * Process at most 200 documents per call to stay well within Convex mutation
 * limits; re-run until the return value shows `processed < 200`.
 *
 * Usage:
 *   bunx convex run contracts/backfill:backfillContractAggregate
 */
export const backfillContractAggregate = internalMutation({
  args: {},
  handler: async (ctx) => {
    const contracts = await ctx.db.query("contracts").take(PAGE_SIZE);

    for (const doc of contracts) {
      await contractsByStatus.insertIfDoesNotExist(ctx, doc);
    }

    return { processed: contracts.length, done: contracts.length < PAGE_SIZE };
  },
});

/**
 * Seed every contract aggregate (per-agency + platform status counts +
 * platform sum-insured) from the `contracts` table.
 *
 * Idempotent — every aggregate uses `insertIfDoesNotExist` under the hood, so
 * re-running after a partial pass converges. PAGE_SIZE matches the existing
 * backfill so per-call mutation budget stays predictable.
 *
 * Usage:
 *   bunx convex run contracts/backfill:backfillPlatformAggregates
 */
export const backfillPlatformAggregates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const contracts = await ctx.db.query("contracts").take(PAGE_SIZE);

    for (const doc of contracts) {
      await insertContractAggregatesIfMissing(ctx, doc);
    }

    return { processed: contracts.length, done: contracts.length < PAGE_SIZE };
  },
});
