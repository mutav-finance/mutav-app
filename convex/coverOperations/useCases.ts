import { paginationOptsValidator } from "convex/server";
import type { QueryCtx } from "../_generated/server";
import { queryWithMutavRole } from "../lib/auth";
import { COVER_OPERATION_STATUS, type CoverOperation } from "./domain";

/**
 * A payout compliance has recorded and nobody has yet confirmed as paid. The
 * joined references are what an operator matches against the bank statement;
 * the tenant is deliberately absent — the landlord is paid against the
 * guarantee, and the notice reference already leads to the rest.
 */
export type CoverPayoutRow = {
  publicId: string;
  batchId: string | null;
  noticePublicId: string;
  agencyName: string;
  guaranteePublicId: string;
  coveragePeriod: string;
  requestedCents: number;
  appliedCents: number;
  recordedAt: string;
  note: string | null;
};

/**
 * `noticeId`, `agencyId` and `guaranteeId` are required columns whose rows
 * are never deleted outside a demo reseed, so a miss is corrupted data rather
 * than an access case — it throws.
 */
async function shapeCoverPayoutRow(
  ctx: QueryCtx,
  operation: CoverOperation,
): Promise<CoverPayoutRow> {
  const [notice, agency, guarantee] = await Promise.all([
    ctx.db.get(operation.noticeId),
    ctx.db.get(operation.agencyId),
    ctx.db.get(operation.guaranteeId),
  ]);
  if (!notice || !agency || !guarantee) {
    throw new Error(`Cover operation ${operation.publicId} references a missing row`);
  }
  return {
    publicId: operation.publicId,
    batchId: operation.batchId ?? null,
    noticePublicId: notice.publicId,
    agencyName: agency.name,
    guaranteePublicId: guarantee.publicId,
    coveragePeriod: operation.coveragePeriod,
    requestedCents: operation.requestedCents,
    appliedCents: operation.appliedCents,
    recordedAt: operation.recordedAt,
    note: operation.note ?? null,
  };
}

/**
 * Cross-agency list of recorded covers still awaiting their off-chain payout,
 * oldest first — the money Mutav owes and has not yet confirmed sending.
 * Same `compliance` rung as the mutation that clears a row off it.
 */
export const listAwaitingPayout = queryWithMutavRole({ minRole: "compliance" })({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: CoverPayoutRow[]; isDone: boolean; continueCursor: string }> => {
    const result = await ctx.db
      .query("coverOperations")
      .withIndex("by_status_recordedAt", (q) => q.eq("status", COVER_OPERATION_STATUS.RECORDED))
      .order("asc")
      .paginate(args.paginationOpts);
    return {
      page: await Promise.all(result.page.map((row) => shapeCoverPayoutRow(ctx, row))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
