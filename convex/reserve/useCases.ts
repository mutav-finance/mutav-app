import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { sumInsuredExposure } from "../guarantees/aggregate";
import {
  reserveAssetValidator,
  reserveHoldingValidator,
  reservePricesValidator,
  reserveSolvencyValidator,
  reserveSourceValidator,
  type ReserveHealthSnapshot,
  type ReserveSnapshot,
} from "./domain";
import { brsBaseUnitsToCents } from "./health";

export const writeSnapshot = internalMutation({
  args: {
    storedValueCents: v.number(),
    fxUsdBrl: v.number(),
    fxSource: v.string(),
    fxQuotedAt: v.string(),
    assets: v.array(reserveAssetValidator),
    capturedAt: v.number(),
    solvency: v.optional(reserveSolvencyValidator),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reserveSnapshots", args);
  },
});

// Deletes every reserveSnapshots row. Used to reset dev data after a required
// schema change; also a generic ops primitive for clearing stale snapshots.
export const clearSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("reserveSnapshots").collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});

export const latestSnapshot = internalQuery({
  args: {},
  handler: async (ctx): Promise<ReserveSnapshot | null> => {
    return await ctx.db.query("reserveSnapshots").withIndex("by_capturedAt").order("desc").first();
  },
});

const DIGITS_ONLY = /^\d+$/;

/**
 * Persist one phase-1 health reading (ADR 0012). The holdings, the counted
 * balance and the prices come from the reader; the in-force cover is summed
 * here, inside the same transaction as the insert, so the stored inputs
 * describe one moment of the book.
 */
export const writeHealthSnapshot = internalMutation({
  args: {
    capturedAt: v.number(),
    source: reserveSourceValidator,
    balanceBaseUnits: v.string(),
    requiredCoverageRatioBps: v.number(),
    holdings: v.array(reserveHoldingValidator),
    prices: reservePricesValidator,
    usdStablesUncounted: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!DIGITS_ONLY.test(args.balanceBaseUnits)) {
      throw new Error("balanceBaseUnits must be an unsigned base-10 integer");
    }
    for (const holding of args.holdings) {
      if (!DIGITS_ONLY.test(holding.amountBaseUnits)) {
        throw new Error("holding amountBaseUnits must be an unsigned base-10 integer");
      }
    }
    // Seam for the offer-hold ledger: once it lands, sum the active holds here
    // and store them as `activeOfferHoldsCents`. Until then the field is absent.
    await ctx.db.insert("reserveHealthSnapshots", {
      ...args,
      balanceCents: brsBaseUnitsToCents(BigInt(args.balanceBaseUnits)),
      insuredCoverCents: await sumInsuredExposure(ctx),
    });
  },
});

export async function latestHealthSnapshot(ctx: QueryCtx): Promise<ReserveHealthSnapshot | null> {
  return await ctx.db
    .query("reserveHealthSnapshots")
    .withIndex("by_capturedAt")
    .order("desc")
    .first();
}
