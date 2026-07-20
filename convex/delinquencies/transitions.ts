import type { MutationCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import { replaceContractAggregates } from "../contracts/aggregateWrites";
import type { Contract } from "../contracts/domain";
import {
  canTransition,
  DELINQUENCY_ERROR_CODE,
  DELINQUENCY_RESOLUTION,
  DELINQUENCY_STATUS,
  type Delinquency,
  type DelinquencyResolution,
  type DelinquencyStatus,
} from "./domain";

async function adjustContractGuarantee(
  ctx: MutationCtx,
  contract: Contract,
  deltaCents: number,
): Promise<void> {
  await ctx.db.patch(contract._id, {
    availableGuaranteeCents: Math.max(0, contract.availableGuaranteeCents + deltaCents),
  });
  const after = await ctx.db.get(contract._id);
  if (!after) throw new Error("Contract row vanished mid-transaction");
  await replaceContractAggregates(ctx, contract, after);
}

export type DelinquencyTransitionData = {
  previousStatus: DelinquencyStatus;
  status: DelinquencyStatus;
  resolution: DelinquencyResolution | null;
  appliedGuaranteeDecrementCents: number | null;
};

export type DelinquencyTransitionError = {
  code: typeof DELINQUENCY_ERROR_CODE.NOT_FOUND | typeof DELINQUENCY_ERROR_CODE.ILLEGAL_TRANSITION;
};

/**
 * Shared state machine for both the agency surface (`useCases.ts`) and the
 * staff surface (`adminUseCases.ts`). Money flow: `provisioned` earmarks
 * coverage (decrement, floored at 0); `paid` consumes it permanently (no
 * balance effect — the payout drew the reserve); closing FROM `provisioned`
 * releases the earmark. Error Results only occur before the first write;
 * post-write failures throw so the transaction rolls back.
 */
export async function applyDelinquencyTransition(
  ctx: MutationCtx,
  {
    row,
    toStatus,
    resolution = null,
  }: {
    row: Delinquency;
    toStatus: DelinquencyStatus;
    resolution?: DelinquencyResolution | null;
  },
): Promise<Result<DelinquencyTransitionData, DelinquencyTransitionError>> {
  if (!canTransition(row.status, toStatus)) {
    return {
      success: false,
      error: { code: DELINQUENCY_ERROR_CODE.ILLEGAL_TRANSITION },
      message: `Cannot transition from ${row.status} to ${toStatus}`,
    };
  }

  let effectiveResolution: DelinquencyResolution | null = null;
  if (toStatus === DELINQUENCY_STATUS.CLOSED) {
    if (row.status === DELINQUENCY_STATUS.PROVISIONED) {
      effectiveResolution = DELINQUENCY_RESOLUTION.DENIED;
    } else if (row.status === DELINQUENCY_STATUS.PAID) {
      effectiveResolution = DELINQUENCY_RESOLUTION.PAID_OUT;
    } else if (
      resolution === DELINQUENCY_RESOLUTION.CURED ||
      resolution === DELINQUENCY_RESOLUTION.DENIED
    ) {
      effectiveResolution = resolution;
    } else {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.ILLEGAL_TRANSITION },
        message: "Closing from open/under_review requires a 'cured' or 'denied' resolution",
      };
    }
  }

  let appliedGuaranteeDecrementCents = row.appliedGuaranteeDecrementCents;
  if (toStatus === DELINQUENCY_STATUS.PROVISIONED) {
    const contract = await ctx.db.get(row.contractId);
    if (!contract) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.NOT_FOUND },
        message: "Contract not found",
      };
    }
    appliedGuaranteeDecrementCents = Math.min(contract.availableGuaranteeCents, row.amountCents);
    await adjustContractGuarantee(ctx, contract, -appliedGuaranteeDecrementCents);
  } else if (
    row.status === DELINQUENCY_STATUS.PROVISIONED &&
    toStatus === DELINQUENCY_STATUS.CLOSED
  ) {
    const contract = await ctx.db.get(row.contractId);
    if (!contract) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.NOT_FOUND },
        message: "Contract not found",
      };
    }
    await adjustContractGuarantee(ctx, contract, row.appliedGuaranteeDecrementCents ?? 0);
  }

  await ctx.db.patch(row._id, {
    status: toStatus,
    appliedGuaranteeDecrementCents,
    ...(toStatus === DELINQUENCY_STATUS.CLOSED
      ? { closedAt: new Date().toISOString(), resolution: effectiveResolution }
      : {}),
  });

  return {
    success: true,
    data: {
      previousStatus: row.status,
      status: toStatus,
      resolution: effectiveResolution,
      appliedGuaranteeDecrementCents,
    },
    message: "Delinquency status updated",
  };
}
