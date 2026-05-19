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
