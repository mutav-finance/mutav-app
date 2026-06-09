import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import type { AgencyId } from "../agencies/domain";
import type { ContractStatus } from "./domain";

/**
 * Aggregate that counts contracts grouped by (agencyId, status).
 *
 * - Namespace: AgencyId — each agency has its own isolated B-tree for
 *   maximum write throughput.
 * - Key: ContractStatus — sort key within each namespace, so we can count
 *   contracts with a specific status in O(log n).
 *
 * Must be updated in every mutation that inserts, patches status, or deletes a
 * contract. Use the helpers exported from this module (insert / replace /
 * deleteEntry) to keep the aggregate in sync.
 */
export const contractsByStatus = new TableAggregate<{
  Namespace: AgencyId;
  Key: ContractStatus;
  DataModel: DataModel;
  TableName: "contracts";
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
  Key: ContractStatus;
  DataModel: DataModel;
  TableName: "contracts";
}>(components.contractsByStatusPlatform, {
  sortKey: (doc) => doc.status,
});

/**
 * Platform-wide sum of `availableGuaranteeCents` keyed by status. Queried with
 * `bounds: { lower: "ativo", upper: "ativo" }` to compute total insured
 * exposure in O(log n) — the denominator for the capacity panel.
 */
export const ativoInsuredCentsPlatform = new TableAggregate<{
  Namespace: undefined;
  Key: ContractStatus;
  DataModel: DataModel;
  TableName: "contracts";
}>(components.ativoInsuredCentsPlatform, {
  sortKey: (doc) => doc.status,
  sumValue: (doc) => doc.availableGuaranteeCents,
});
