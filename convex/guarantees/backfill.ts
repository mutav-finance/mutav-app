import { internalMutation } from "../_generated/server";
import { insertGuaranteeAggregatesIfMissing } from "./aggregateWrites";
import { contractsByStatus } from "./aggregate";

const PAGE_SIZE = 200;

/**
 * Seed the `contractsByStatus` aggregate from the current state of the
 * `guarantees` table.
 *
 * Safe to run multiple times — uses `insertIfDoesNotExist` which is idempotent.
 * Process at most 200 documents per call to stay well within Convex mutation
 * limits; re-run until the return value shows `processed < 200`.
 *
 * Usage:
 *   bunx convex run guarantees/backfill:backfillGuaranteeAggregate
 */
export const backfillGuaranteeAggregate = internalMutation({
  args: {},
  handler: async (ctx) => {
    const guarantees = await ctx.db.query("guarantees").take(PAGE_SIZE);

    for (const doc of guarantees) {
      await contractsByStatus.insertIfDoesNotExist(ctx, doc);
    }

    return { processed: guarantees.length, done: guarantees.length < PAGE_SIZE };
  },
});

/**
 * Seed every guarantee aggregate (per-agency + platform state counts +
 * platform sum-insured) from the `guarantees` table.
 *
 * Idempotent — every aggregate uses `insertIfDoesNotExist` under the hood, so
 * re-running after a partial pass converges. PAGE_SIZE matches the existing
 * backfill so per-call mutation budget stays predictable.
 *
 * Usage:
 *   bunx convex run guarantees/backfill:backfillPlatformAggregates
 */
export const backfillPlatformAggregates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const guarantees = await ctx.db.query("guarantees").take(PAGE_SIZE);

    for (const doc of guarantees) {
      await insertGuaranteeAggregatesIfMissing(ctx, doc);
    }

    return { processed: guarantees.length, done: guarantees.length < PAGE_SIZE };
  },
});
