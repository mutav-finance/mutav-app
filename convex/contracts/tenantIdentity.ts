import type { QueryCtx } from "../_generated/server";
import { tenantInputFromSubmission, type TenantInput } from "../tenants/domain";
import type { Contract } from "./domain";

/**
 * The tenant identity the owning agency itself submitted, frozen on its
 * contract creation event. The registry row is shared by every agency
 * transacting with that tax ID and keeps its first writer's values, so it is
 * not what a later agency may read back (LGPD-26). `null` for contracts
 * created before the snapshot existed — those fall back to the registry.
 *
 * Lives outside `useCases.ts` because both the contracts read paths and the
 * tenants prefill lookup resolve identity through it, and `contracts/useCases`
 * already imports `tenants/useCases`.
 */
export async function agencySubmittedTenant(
  ctx: QueryCtx,
  contract: Contract,
): Promise<TenantInput | null> {
  const creation = await ctx.db
    .query("contractHistory")
    .withIndex("by_agency_contract", (q) =>
      q.eq("agencyId", contract.agencyId).eq("contractPublicId", contract.publicId),
    )
    .order("asc")
    .first();
  const snapshot = creation?.tenantSnapshot;
  return snapshot ? tenantInputFromSubmission(snapshot) : null;
}
