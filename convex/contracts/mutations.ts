import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { contractsByStatus } from "./aggregate";
import { contractStatusValidator } from "./domain";

/**
 * Update the status of an existing contract and keep the aggregate in sync.
 *
 * Only the `status` field is changed; all other fields remain untouched.
 */
export const updateStatus = internalMutation({
  args: {
    contractId: v.id("contracts"),
    status: contractStatusValidator,
  },
  handler: async (ctx, { contractId, status }) => {
    const before = await ctx.db.get(contractId);
    if (!before) throw new Error(`Contract ${contractId} not found`);

    if (before.status === status) return; // no-op

    const patch: { status: typeof status; activatedAt?: string; deactivatedAt?: string } = {
      status,
    };
    if (status === "ativo" && before.activatedAt === null) {
      patch.activatedAt = new Date().toISOString();
    }
    if (before.status === "ativo" && status !== "ativo" && !before.deactivatedAt) {
      patch.deactivatedAt = new Date().toISOString();
    }

    await ctx.db.patch(contractId, patch);
    const after = await ctx.db.get(contractId);
    if (!after) throw new Error("Contract disappeared mid-mutation");

    // Replace updates the aggregate: removes the old (namespace, key) entry
    // and inserts the new one atomically.
    await contractsByStatus.replace(ctx, before, after);

    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: "contract_status_update" },
      action: AUDIT_ACTION.CONTRACT_STATUS_UPDATED,
      resourceType: "contracts",
      resourceId: before.publicId,
      payload: {
        contractId,
        agencyId: before.agencyId,
        previousStatus: before.status,
        newStatus: status,
        activatedAt: patch.activatedAt ?? null,
        deactivatedAt: patch.deactivatedAt ?? null,
      },
    });
  },
});
