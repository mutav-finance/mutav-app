import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
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
  },
});
