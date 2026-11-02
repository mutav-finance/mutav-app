import { v } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Result } from "../lib/result";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import type { ReserveBalanceSnapshotId } from "./domain";
import {
  COVERAGE_RATIO_BPS_DEFAULT,
  isReserveBalanceFresh,
  isValidBalanceCents,
  isValidCoverageRatioBps,
  RESERVE_CAPACITY_ERROR_CODE,
  type ReserveBalanceReading,
} from "./capacity";

/**
 * The cached reading of the phase-1 reserve — the Squads vault's BRS balance —
 * that the activation gate measures free capital against (issue #427/#428).
 * Activation reads this snapshot instead of the chain so the capacity check
 * and the drafted → active move commit in ONE mutation.
 *
 * WRITE PORT — `recordReserveBalance({ balanceCents, takenAt })`. Issue #428's
 * Squads reader action (built separately) calls it from the existing
 * 15-minute reserve cron after each successful vault read:
 *   - `balanceCents`: the vault's BRS balance in BRL cents (BRS is 1:1 BRL),
 *     a non-negative safe integer;
 *   - `takenAt`: when the balance was read, unix ms, not in the future.
 * A failed read writes nothing. A reading older than
 * `RESERVE_BALANCE_MAX_AGE_MS` (30 minutes) is treated as no reading: every
 * capacity check fails closed until a fresh one lands. Each write also starts
 * the sweep that retries the guarantees waiting for reserve capacity.
 */

const SETTINGS_SOURCE = "internal_coverage_ratio_setting";

type RecordReserveBalanceError = {
  code: typeof RESERVE_CAPACITY_ERROR_CODE.INVALID_RESERVE_BALANCE;
};

export const recordReserveBalance = internalMutation({
  args: { balanceCents: v.number(), takenAt: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<{ snapshotId: ReserveBalanceSnapshotId }, RecordReserveBalanceError>> => {
    if (
      !isValidBalanceCents(args.balanceCents) ||
      !Number.isSafeInteger(args.takenAt) ||
      args.takenAt > Date.now()
    ) {
      return {
        success: false,
        error: { code: RESERVE_CAPACITY_ERROR_CODE.INVALID_RESERVE_BALANCE },
        message: "A reserve balance must be whole non-negative cents read at a past instant",
      };
    }
    const snapshotId = await ctx.db.insert("reserveBalanceSnapshots", {
      balanceCents: args.balanceCents,
      takenAt: args.takenAt,
      source: "squads_vault",
    });
    await ctx.scheduler.runAfter(0, internal.guarantees.activation.retryAwaitingCapacity, {
      cursor: null,
    });
    return { success: true, data: { snapshotId }, message: "Reserve balance recorded" };
  },
});

export type LatestReserveBalance =
  | { available: true; reading: ReserveBalanceReading }
  | { available: false };

/** The newest vault balance, or unavailable when there is none or it is stale. */
export async function latestReserveBalance(
  ctx: QueryCtx | MutationCtx,
  now: number,
): Promise<LatestReserveBalance> {
  const newest = await ctx.db
    .query("reserveBalanceSnapshots")
    .withIndex("by_takenAt")
    .order("desc")
    .first();
  if (!newest) return { available: false };
  const reading = { balanceCents: newest.balanceCents, takenAt: newest.takenAt };
  return isReserveBalanceFresh(reading, now) ? { available: true, reading } : { available: false };
}

/** The coverage ratio `c` in basis points: the platform setting, else the pilot 25%. */
export async function platformCoverageRatioBps(ctx: QueryCtx | MutationCtx): Promise<number> {
  const settings = await ctx.db
    .query("platformSettings")
    .withIndex("by_key", (q) => q.eq("key", "platform"))
    .unique();
  return settings?.coverageRatioBps ?? COVERAGE_RATIO_BPS_DEFAULT;
}

type SetCoverageRatioError = { code: typeof RESERVE_CAPACITY_ERROR_CODE.INVALID_COVERAGE_RATIO };

/** Override `c`; `null` clears it back to `COVERAGE_RATIO_BPS_DEFAULT`. Run from the CLI. */
export const setCoverageRatioBps = internalMutation({
  args: { coverageRatioBps: v.union(v.number(), v.null()) },
  handler: async (
    ctx,
    args,
  ): Promise<Result<{ coverageRatioBps: number }, SetCoverageRatioError>> => {
    if (args.coverageRatioBps !== null && !isValidCoverageRatioBps(args.coverageRatioBps)) {
      return {
        success: false,
        error: { code: RESERVE_CAPACITY_ERROR_CODE.INVALID_COVERAGE_RATIO },
        message: `Coverage ratio must be whole basis points in (0, 10000]; got ${args.coverageRatioBps}`,
      };
    }
    const coverageRatioBps = args.coverageRatioBps ?? undefined;
    const existing = await ctx.db
      .query("platformSettings")
      .withIndex("by_key", (q) => q.eq("key", "platform"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { coverageRatioBps });
    } else {
      await ctx.db.insert("platformSettings", { key: "platform", coverageRatioBps });
    }
    const effective = coverageRatioBps ?? COVERAGE_RATIO_BPS_DEFAULT;
    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: SETTINGS_SOURCE },
      action: AUDIT_ACTION.COVERAGE_RATIO_UPDATED,
      resourceType: "platformSettings",
      resourceId: "platform",
      payload: { coverageRatioBps: args.coverageRatioBps, effective },
    });
    return {
      success: true,
      data: { coverageRatioBps: effective },
      message: "Coverage ratio updated",
    };
  },
});
