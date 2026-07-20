import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { mutationWithMutavRole } from "../lib/auth";
import type { Result } from "../lib/result";
import { AUDIT_ACTION } from "../audit/domain";
import type { AppendAuditEntryInput } from "../audit/domain";
import {
  DELINQUENCY_ERROR_CODE,
  DELINQUENCY_RESOLUTION,
  DELINQUENCY_STATUS,
  type DelinquencyResolution,
  type DelinquencyStatus,
} from "./domain";
import { applyDelinquencyTransition, type DelinquencyTransitionError } from "./transitions";

// ─── Staff-gated delinquency transitions (docs/architecture/admin.md §A3) ────
//
// PUBLIC entry points, role-gated via `mutationWithMutavRole`. Staff act
// cross-agency: rows are resolved by publicId with NO agency filter — the
// mutavStaff row is the authority, not a membership. The agency surface
// (`useCases.ts`) keeps only `open` and `closeAsCured`.
//
// Role gates (pilot): `startReview` = compliance+; provision / markPaid /
// closeAsDenied = admin. §A3 step 4 also names `treasury` for attestation, but
// treasury is off the operational ladder (`hasExactRole` only) — treasury
// attestation arrives with the #201 workflow, not via `minRole`.

type StaffTransitionCtx = MutationCtx & {
  appendStaffAudit: (input: Omit<AppendAuditEntryInput, "actor">) => Promise<unknown>;
};

type StaffTransitionSuccessResult = { publicId: string; status: DelinquencyStatus };
type StaffTransitionErrorResult = DelinquencyTransitionError;
type StaffTransitionResult = Result<StaffTransitionSuccessResult, StaffTransitionErrorResult>;

async function transitionAsStaff(
  ctx: StaffTransitionCtx,
  {
    publicId,
    toStatus,
    resolution = null,
    allowedFromStatuses,
  }: {
    publicId: string;
    toStatus: DelinquencyStatus;
    resolution?: DelinquencyResolution | null;
    allowedFromStatuses?: readonly DelinquencyStatus[];
  },
): Promise<StaffTransitionResult> {
  const row = await ctx.db
    .query("delinquencies")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  if (!row) {
    return {
      success: false,
      error: { code: DELINQUENCY_ERROR_CODE.NOT_FOUND },
      message: "Delinquency not found",
    };
  }
  if (allowedFromStatuses !== undefined && !allowedFromStatuses.includes(row.status)) {
    return {
      success: false,
      error: { code: DELINQUENCY_ERROR_CODE.ILLEGAL_TRANSITION },
      message: `Cannot transition from ${row.status} via this operation`,
    };
  }

  const transition = await applyDelinquencyTransition(ctx, { row, toStatus, resolution });
  if (!transition.success) return transition;

  await ctx.appendStaffAudit({
    action: AUDIT_ACTION.DELINQUENCY_STATUS_UPDATED,
    resourceType: "delinquencies",
    resourceId: row.publicId,
    payload: {
      delinquencyId: row._id,
      contractId: row.contractId,
      agencyId: row.agencyId,
      previousStatus: transition.data.previousStatus,
      status: transition.data.status,
      resolution: transition.data.resolution,
      amountCents: row.amountCents,
      appliedGuaranteeDecrementCents: transition.data.appliedGuaranteeDecrementCents,
    },
  });

  return {
    success: true,
    data: { publicId: row.publicId, status: toStatus },
    message: "Delinquency status updated",
  };
}

/** open → under_review. Compliance and above. */
export const startReview = mutationWithMutavRole({ minRole: "compliance" })({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<StaffTransitionResult> =>
    transitionAsStaff(ctx, {
      publicId: args.publicId,
      toStatus: DELINQUENCY_STATUS.UNDER_REVIEW,
    }),
});

/** under_review → provisioned. Earmarks coverage against the contract guarantee. Admin only. */
export const provision = mutationWithMutavRole({ minRole: "admin" })({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<StaffTransitionResult> =>
    transitionAsStaff(ctx, {
      publicId: args.publicId,
      toStatus: DELINQUENCY_STATUS.PROVISIONED,
    }),
});

/** provisioned → paid. The payout consumed the earmark permanently. Admin only. */
export const markPaid = mutationWithMutavRole({ minRole: "admin" })({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<StaffTransitionResult> =>
    transitionAsStaff(ctx, {
      publicId: args.publicId,
      toStatus: DELINQUENCY_STATUS.PAID,
    }),
});

/**
 * open / under_review / provisioned → closed with resolution 'denied'
 * (releases the earmark when closing from provisioned). Guarded away from
 * `paid` rows: the state machine would record that closure as 'paid_out',
 * which is not a denial. Admin only.
 */
export const closeAsDenied = mutationWithMutavRole({ minRole: "admin" })({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<StaffTransitionResult> =>
    transitionAsStaff(ctx, {
      publicId: args.publicId,
      toStatus: DELINQUENCY_STATUS.CLOSED,
      resolution: DELINQUENCY_RESOLUTION.DENIED,
      allowedFromStatuses: [
        DELINQUENCY_STATUS.OPEN,
        DELINQUENCY_STATUS.UNDER_REVIEW,
        DELINQUENCY_STATUS.PROVISIONED,
      ],
    }),
});
