import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import { AUDIT_ACTION, auditActorValidator, type AuditActor } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { queryWithAgencyScope } from "../lib/auth";
import { digitsOnly } from "../lib/taxId";
import {
  tenantInputValidator,
  validateTaxId,
  type Tenant,
  type TenantErrorCode,
  type TenantId,
  type TenantInput,
} from "./domain";

export type GetOrCreateTenantSuccessResult = { tenantId: TenantId; created: boolean };
export type GetOrCreateTenantErrorResult = { code: TenantErrorCode };
export type GetOrCreateTenantResult = Result<
  GetOrCreateTenantSuccessResult,
  GetOrCreateTenantErrorResult
>;

type FieldConflict = { existing: string; incoming: string };

function identityConflicts(existing: Tenant, input: TenantInput): Record<string, FieldConflict> {
  const conflicts: Record<string, FieldConflict> = {};
  if (input.fullName !== existing.fullName) {
    conflicts.fullName = { existing: existing.fullName, incoming: input.fullName };
  }
  if (
    input.entityType === "pf" &&
    existing.entityType === "pf" &&
    input.birthDate !== existing.birthDate
  ) {
    conflicts.birthDate = { existing: existing.birthDate, incoming: input.birthDate };
  }
  return conflicts;
}

/**
 * Resolve the registry row for a tax ID, inserting it on first encounter.
 * Plain `MutationCtx` helper on purpose: `contracts.create` and the
 * backfill migration both call it inside their own transaction (MutationCtx
 * has no `runMutation`, and scheduling would break atomicity). The
 * `getOrCreate` internalMutation below is a thin wrapper for external
 * callers.
 *
 * Check-then-insert is race-safe: concurrent mutations for the same tax ID
 * conflict on the `by_taxId` read set, Convex OCC retries the loser, and
 * on retry it observes the winner's row.
 *
 * Re-encounter policy: email/phone are last-write-wins (a new contract
 * refreshes contact data); fullName / pf birthDate mismatches are NOT
 * overwritten — one audit entry records the divergence for staff review.
 *
 * The tax-id checksum rejection is the only error Result and happens
 * before any write.
 */
export async function getOrCreateTenant(
  ctx: MutationCtx,
  args: { input: TenantInput; actor: AuditActor },
): Promise<GetOrCreateTenantResult> {
  const validated = validateTaxId({ entityType: args.input.entityType, taxId: args.input.taxId });
  if (!validated.valid) {
    return {
      success: false,
      error: { code: validated.code },
      message: "Tax ID failed checksum validation",
    };
  }
  const taxId = validated.taxId;
  const input = { ...args.input, taxId };

  const existing = await ctx.db
    .query("tenants")
    .withIndex("by_taxId", (q) => q.eq("taxId", taxId))
    .unique();

  if (!existing) {
    const tenantId = await ctx.db.insert("tenants", input);
    return { success: true, data: { tenantId, created: true }, message: "Tenant registered" };
  }

  const contactPatch: { email?: string; phone?: string } = {};
  if (input.email !== existing.email) contactPatch.email = input.email;
  if (input.phone !== existing.phone) contactPatch.phone = input.phone;
  if (Object.keys(contactPatch).length > 0) {
    await ctx.db.patch(existing._id, contactPatch);
  }

  const conflicts = identityConflicts(existing, input);
  if (Object.keys(conflicts).length > 0) {
    await appendAuditEntry(ctx, {
      actor: args.actor,
      action: AUDIT_ACTION.TENANT_DATA_CONFLICT,
      resourceType: "tenants",
      resourceId: existing._id,
      payload: { taxId, conflicts },
    });
  }

  return {
    success: true,
    data: { tenantId: existing._id, created: false },
    message: "Tenant found",
  };
}

export const getOrCreate = internalMutation({
  args: { input: tenantInputValidator, actor: auditActorValidator },
  handler: async (ctx, args): Promise<GetOrCreateTenantResult> => getOrCreateTenant(ctx, args),
});

/**
 * Registry row by id for actions (no `ctx.db` in ActionCtx). Callers own
 * whatever authorization is appropriate at their entry point.
 */
export const getByIdInternal = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => ctx.db.get(tenantId),
});

/**
 * Relationship-gated prefill lookup (spec § Domain rules): an agency reads
 * tenant data only when it has (or had) a contract with that tenant.
 * Unknown-to-the-platform and known-but-unrelated tax IDs both return
 * `null` — indistinguishable by design, so there is no existence leak.
 * `contactCpf` is deliberately NOT an identity key: a pj tenant's contact
 * CPF never resolves company data into a pf flow.
 */
export const lookupTenantByTaxId = queryWithAgencyScope({
  args: { taxId: v.string() },
  handler: async (ctx, { taxId }) => {
    const digits = digitsOnly(taxId);
    if (digits.length === 0) return null;

    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_taxId", (q) => q.eq("taxId", digits))
      .unique();
    if (!tenant) return null;

    const relatedContract = await ctx.db
      .query("contracts")
      .withIndex("by_agency_tenant", (q) =>
        q.eq("agencyId", ctx.agencyId).eq("tenantId", tenant._id),
      )
      .first();
    if (!relatedContract) return null;

    return { fullName: tenant.fullName, email: tenant.email };
  },
});
