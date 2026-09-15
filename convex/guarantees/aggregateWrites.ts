import type { MutationCtx } from "../_generated/server";
import type { Guarantee } from "./domain";
import { insuredCentsPlatform, guaranteesByState, guaranteesByStatePlatform } from "./aggregate";

/**
 * Central dual-write helpers for every guarantee aggregate.
 *
 * Three aggregates must stay in lockstep on every guarantee write:
 *   - `guaranteesByState` (per-agency state counts)
 *   - `guaranteesByStatePlatform` (platform-wide state counts)
 *   - `insuredCentsPlatform` (platform-wide worst-case exposure)
 *
 * Every mutation that inserts/replaces/deletes a guarantee MUST go through one
 * of the helpers below — never call `.insert` / `.replace` / `.delete` directly
 * on an aggregate from outside this file.
 */

export async function insertGuaranteeAggregates(ctx: MutationCtx, doc: Guarantee): Promise<void> {
  await guaranteesByState.insert(ctx, doc);
  await guaranteesByStatePlatform.insert(ctx, doc);
  await insuredCentsPlatform.insert(ctx, doc);
}

export async function replaceGuaranteeAggregates(
  ctx: MutationCtx,
  before: Guarantee,
  after: Guarantee,
): Promise<void> {
  await guaranteesByState.replace(ctx, before, after);
  await guaranteesByStatePlatform.replace(ctx, before, after);
  await insuredCentsPlatform.replace(ctx, before, after);
}

export async function deleteGuaranteeAggregates(ctx: MutationCtx, doc: Guarantee): Promise<void> {
  await guaranteesByState.delete(ctx, doc);
  await guaranteesByStatePlatform.delete(ctx, doc);
  await insuredCentsPlatform.delete(ctx, doc);
}

/**
 * Idempotent variant used by the backfill paths. Re-running is safe and a
 * no-op for docs already present in every aggregate.
 */
export async function insertGuaranteeAggregatesIfMissing(
  ctx: MutationCtx,
  doc: Guarantee,
): Promise<void> {
  await guaranteesByState.insertIfDoesNotExist(ctx, doc);
  await guaranteesByStatePlatform.insertIfDoesNotExist(ctx, doc);
  await insuredCentsPlatform.insertIfDoesNotExist(ctx, doc);
}
