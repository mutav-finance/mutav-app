import type { MutationCtx } from "../_generated/server";
import type { Contract } from "./domain";
import {
  ativoInsuredCentsPlatform,
  contractsByStatus,
  contractsByStatusPlatform,
} from "./aggregate";

/**
 * Central dual-write helpers for every contract aggregate.
 *
 * Three aggregates must stay in lockstep on every contract write:
 *   - `contractsByStatus` (per-agency status counts)
 *   - `contractsByStatusPlatform` (platform-wide status counts)
 *   - `ativoInsuredCentsPlatform` (platform-wide worst-case exposure: 30x ceiling + 6x exit)
 *
 * Every mutation that inserts/replaces/deletes a contract MUST go through one
 * of the helpers below — never call `.insert` / `.replace` / `.delete` directly
 * on an aggregate from outside this file.
 */

export async function insertContractAggregates(ctx: MutationCtx, doc: Contract): Promise<void> {
  await contractsByStatus.insert(ctx, doc);
  await contractsByStatusPlatform.insert(ctx, doc);
  await ativoInsuredCentsPlatform.insert(ctx, doc);
}

export async function replaceContractAggregates(
  ctx: MutationCtx,
  before: Contract,
  after: Contract,
): Promise<void> {
  await contractsByStatus.replace(ctx, before, after);
  await contractsByStatusPlatform.replace(ctx, before, after);
  await ativoInsuredCentsPlatform.replace(ctx, before, after);
}

export async function deleteContractAggregates(ctx: MutationCtx, doc: Contract): Promise<void> {
  await contractsByStatus.delete(ctx, doc);
  await contractsByStatusPlatform.delete(ctx, doc);
  await ativoInsuredCentsPlatform.delete(ctx, doc);
}

/**
 * Idempotent variant used by the backfill paths. Re-running is safe and a
 * no-op for docs already present in every aggregate.
 */
export async function insertContractAggregatesIfMissing(
  ctx: MutationCtx,
  doc: Contract,
): Promise<void> {
  await contractsByStatus.insertIfDoesNotExist(ctx, doc);
  await contractsByStatusPlatform.insertIfDoesNotExist(ctx, doc);
  await ativoInsuredCentsPlatform.insertIfDoesNotExist(ctx, doc);
}
