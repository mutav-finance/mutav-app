import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import { INSURED_STATES, type GuaranteeState } from "./domain";

/**
 * Aggregate that counts guarantees grouped by (agencyId, status).
 *
 * - Namespace: AgencyId — each agency has its own isolated B-tree for
 *   maximum write throughput.
 * - Key: GuaranteeState — sort key within each namespace, so we can count
 *   guarantees in a specific state in O(log n).
 *
 * Must be updated in every mutation that inserts, patches status, or deletes a
 * guarantee. Use the helpers exported from `aggregateWrites.ts` (insert /
 * replace / delete) to keep the aggregate in sync.
 *
 * Component names still say `contracts…` / `ativo…`: they are bound in
 * `convex.config.ts` and renaming them is a separate migration of the
 * component tables. Only the binding changed here.
 */
export const contractsByStatus = new TableAggregate<{
  Namespace: AgencyId;
  Key: GuaranteeState;
  DataModel: DataModel;
  TableName: "guarantees";
}>(components.contractsByStatus, {
  namespace: (doc) => doc.agencyId,
  sortKey: (doc) => doc.status,
});

/**
 * Un-namespaced sibling of `contractsByStatus` for platform-wide reads.
 *
 * `@convex-dev/aggregate`'s `Namespace` type is invariant, so we cannot widen
 * the per-agency aggregate to also serve platform queries — two separate
 * aggregates is the only way. Every mutation must keep both in lockstep via
 * the helpers in `aggregateWrites.ts`.
 */
export const contractsByStatusPlatform = new TableAggregate<{
  Namespace: undefined;
  Key: GuaranteeState;
  DataModel: DataModel;
  TableName: "guarantees";
}>(components.contractsByStatusPlatform, {
  sortKey: (doc) => doc.status,
});

/**
 * Platform-wide worst-case exposure keyed by state. Read through
 * `sumInsuredExposure` — the insured states are not lexically contiguous, so
 * a single key range would silently include `closed` and `drafted`.
 *
 * Per guarantee the exposure is the sum of the two separate, separately-
 * disclosed coverage limits: what is still available under the rent-coverage
 * ceiling PLUS the exit-cost sublimit, both taken from the guarantee's own
 * `terms`/`capacity` snapshot (no product lookup).
 */
export const ativoInsuredCentsPlatform = new TableAggregate<{
  Namespace: undefined;
  Key: GuaranteeState;
  DataModel: DataModel;
  TableName: "guarantees";
}>(components.ativoInsuredCentsPlatform, {
  sortKey: (doc) => doc.status,
  sumValue: (doc) => doc.capacity.availableCents + doc.terms.exitCostCapCents,
});

function singleKeyBounds(state: GuaranteeState) {
  return {
    lower: { key: state, inclusive: true },
    upper: { key: state, inclusive: true },
  };
}

/** Platform-wide worst-case exposure over every in-force guarantee. */
export async function sumInsuredExposure(ctx: QueryCtx): Promise<number> {
  let total = 0;
  for (const state of INSURED_STATES) {
    total += await ativoInsuredCentsPlatform.sum(ctx, { bounds: singleKeyBounds(state) });
  }
  return total;
}

/** Platform-wide number of in-force guarantees. */
export async function countInsured(ctx: QueryCtx): Promise<number> {
  const counts = await contractsByStatusPlatform.countBatch(
    ctx,
    INSURED_STATES.map((state) => ({ bounds: singleKeyBounds(state) })),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

/** Per-agency number of in-force guarantees. */
export async function countInsuredForAgency(ctx: QueryCtx, agencyId: AgencyId): Promise<number> {
  const counts = await contractsByStatus.countBatch(
    ctx,
    INSURED_STATES.map((state) => ({ namespace: agencyId, bounds: singleKeyBounds(state) })),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}
