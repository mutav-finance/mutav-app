import type { MutationCtx } from "../_generated/server";
import type { Guarantee } from "./domain";
import {
  ativoInsuredCentsPlatform,
  contractsByStatus,
  contractsByStatusPlatform,
} from "./aggregate";

/**
 * Central dual-write helpers for every guarantee aggregate.
 *
 * Three aggregates must stay in lockstep on every guarantee write:
 *   - `contractsByStatus` (per-agency state counts)
 *   - `contractsByStatusPlatform` (platform-wide state counts)
 *   - `ativoInsuredCentsPlatform` (platform-wide worst-case exposure)
 *
 * Every mutation that inserts/replaces/deletes a guarantee MUST go through one
 * of the helpers below — never call `.insert` / `.replace` / `.delete` directly
 * on an aggregate from outside this file.
 */

export async function insertGuaranteeAggregates(ctx: MutationCtx, doc: Guarantee): Promise<void> {
  await contractsByStatus.insert(ctx, doc);
  await contractsByStatusPlatform.insert(ctx, doc);
  await ativoInsuredCentsPlatform.insert(ctx, doc);
}

export async function replaceGuaranteeAggregates(
  ctx: MutationCtx,
  before: Guarantee,
  after: Guarantee,
): Promise<void> {
  await contractsByStatus.replace(ctx, before, after);
  await contractsByStatusPlatform.replace(ctx, before, after);
  await ativoInsuredCentsPlatform.replace(ctx, before, after);
}

export async function deleteGuaranteeAggregates(ctx: MutationCtx, doc: Guarantee): Promise<void> {
  await contractsByStatus.delete(ctx, doc);
  await contractsByStatusPlatform.delete(ctx, doc);
  await ativoInsuredCentsPlatform.delete(ctx, doc);
}

/**
 * Idempotent variant used by the backfill paths. Re-running is safe and a
 * no-op for docs already present in every aggregate.
 */
export async function insertGuaranteeAggregatesIfMissing(
  ctx: MutationCtx,
  doc: Guarantee,
): Promise<void> {
  await contractsByStatus.insertIfDoesNotExist(ctx, doc);
  await contractsByStatusPlatform.insertIfDoesNotExist(ctx, doc);
  await ativoInsuredCentsPlatform.insertIfDoesNotExist(ctx, doc);
}
