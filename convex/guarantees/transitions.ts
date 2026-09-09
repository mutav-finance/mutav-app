import type { MutationCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import type { UserId } from "../users/domain";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { replaceGuaranteeAggregates } from "./aggregateWrites";
import {
  assertClose,
  assertTransition,
  GUARANTEE_ERROR_CODE,
  GUARANTEE_STATE,
  type CloseError,
  type CloseReason,
  type Guarantee,
  type GuaranteeCapacity,
  type GuaranteeState,
  type TransitionError,
} from "./domain";

/**
 * Internal write helpers shared by every mutation that moves a guarantee.
 * Nothing here is a Convex function: callers are `guarantees/mutations.ts`,
 * `guarantees/useCases.ts` and the delinquency mutations, which compose these
 * in the SAME transaction as their own machine guard — the atomicity of the
 * two `assertTransition` calls is the point, so never reach for the scheduler.
 *
 * Contract every helper below honours: an error `Result` is returned before
 * the first write, so a refused call leaves the transaction untouched. Once a
 * write has happened, a failure throws and the whole transaction rolls back.
 */

export type GuaranteeActor = { userId: UserId; username: string };

/** The `closed` payload, minus the timestamp the helper stamps itself. */
export type GuaranteeClosureInput = { reason: CloseReason; note?: string };

export type ApplyGuaranteeTransitionInput = {
  guarantee: Guarantee;
  to: GuaranteeState;
  /** Required when `to` is `closed`, rejected otherwise. */
  closure?: GuaranteeClosureInput;
  /** Included in the same patch as the status — used by `activate`. */
  capacity?: GuaranteeCapacity;
  actor: GuaranteeActor;
  /** Human sentence for the history timeline; the structured twin is derived. */
  message: string;
};

export type GuaranteeTransitionSuccess = {
  from: GuaranteeState;
  to: GuaranteeState;
  closeReason: CloseReason | null;
  guarantee: Guarantee;
};

export type GuaranteeTransitionError = {
  code:
    | TransitionError["code"]
    | CloseError["code"]
    | typeof GUARANTEE_ERROR_CODE.CLOSURE_REQUIRED
    | typeof GUARANTEE_ERROR_CODE.CLOSURE_NOT_ALLOWED
    | typeof GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN;
};

/**
 * `available + reserved = ceiling`, and neither leg is negative. Checked on
 * the row BEFORE any capacity write and on any capacity a caller supplies:
 * a drifted row is refused rather than repaired, because repairing it would
 * silently invent or destroy coverage.
 */
function isValidCapacity(capacity: GuaranteeCapacity): boolean {
  if (capacity.availableCents < 0 || capacity.reservedCents < 0) return false;
  return capacity.availableCents + capacity.reservedCents === capacity.ceilingCents;
}

/**
 * The one guarded status change. Order is fixed: machine guards → patch →
 * aggregate rewrite → history row (human `message` plus its structured
 * `transition` twin) → audit entry → lease pointer upkeep.
 */
export async function applyGuaranteeTransition(
  ctx: MutationCtx,
  { guarantee, to, closure, capacity, actor, message }: ApplyGuaranteeTransitionInput,
): Promise<Result<GuaranteeTransitionSuccess, GuaranteeTransitionError>> {
  const transition = assertTransition(guarantee.status, to);
  if (!transition.success) {
    return { success: false, error: { code: transition.error.code }, message: transition.message };
  }

  const isClosing = to === GUARANTEE_STATE.CLOSED;
  if (isClosing && !closure) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.CLOSURE_REQUIRED },
      message: "Closing a guarantee requires a close reason.",
    };
  }
  if (!isClosing && closure) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.CLOSURE_NOT_ALLOWED },
      message: `A closure payload is only valid when transitioning to "closed", not to "${to}".`,
    };
  }
  if (closure) {
    const closing = assertClose(guarantee.status, closure.reason);
    if (!closing.success) {
      return { success: false, error: { code: closing.error.code }, message: closing.message };
    }
  }
  if (capacity && !isValidCapacity(capacity)) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN },
      message: "Refusing a capacity that does not satisfy available + reserved = ceiling.",
    };
  }

  const at = new Date().toISOString();
  const closeReason = closure?.reason ?? null;

  await ctx.db.patch(guarantee._id, {
    status: to,
    ...(closure
      ? {
          closure: {
            reason: closure.reason,
            closedAt: at,
            ...(closure.note === undefined ? {} : { note: closure.note }),
          },
        }
      : {}),
    // First entry into `active` is what dates the guarantee; a later return
    // from arrears or cover must not move the anniversary.
    ...(to === GUARANTEE_STATE.ACTIVE && guarantee.activatedAt === null ? { activatedAt: at } : {}),
    ...(capacity ? { capacity } : {}),
  });

  const after = await ctx.db.get(guarantee._id);
  if (!after) throw new Error("Guarantee row vanished mid-transaction");
  await replaceGuaranteeAggregates(ctx, guarantee, after);

  await ctx.db.insert("guaranteeHistory", {
    agencyId: guarantee.agencyId,
    guaranteePublicId: guarantee.publicId,
    at,
    username: actor.username,
    message,
    transition: {
      from: guarantee.status,
      to,
      ...(closeReason === null ? {} : { closeReason }),
    },
  });

  await appendAuditEntry(ctx, {
    actor: { kind: "user", userId: actor.userId },
    action: AUDIT_ACTION.GUARANTEE_TRANSITIONED,
    resourceType: "guarantees",
    resourceId: guarantee.publicId,
    payload: {
      guaranteeId: guarantee._id,
      leaseId: guarantee.leaseId,
      agencyId: guarantee.agencyId,
      from: guarantee.status,
      to,
      reason: closeReason,
      capacity: after.capacity,
      at,
    },
  });

  // A lease carries at most one non-closed guarantee; releasing the pointer
  // here is what lets the lease take a new one immediately.
  if (isClosing) {
    const lease = await ctx.db.get(guarantee.leaseId);
    if (lease && lease.openGuaranteeId === guarantee._id) {
      await ctx.db.patch(lease._id, { openGuaranteeId: null });
    }
  }

  return {
    success: true,
    data: { from: guarantee.status, to, closeReason, guarantee: after },
    message: `Guarantee ${guarantee.publicId} moved ${guarantee.status} -> ${to}.`,
  };
}

export type CoverCapacitySuccess = { appliedCents: number; capacity: GuaranteeCapacity };

export type CoverCapacityError = {
  code:
    | typeof GUARANTEE_ERROR_CODE.INVALID_AMOUNT
    | typeof GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN
    | typeof GUARANTEE_ERROR_CODE.RELEASE_EXCEEDS_RESERVED;
};

/**
 * Capacity policy C, reserve side: committing cover moves cents from
 * `available` to `reserved` on the guarantee's own ceiling. The draw is
 * CLAMPED to what is still available — a notice worth more than the remaining
 * coverage reserves the remainder and no more — and the applied figure is
 * returned so the caller can store it on the notice and reverse exactly that
 * number later. `ceiling` never moves, so `available + reserved` cannot drift.
 */
export async function reserveCoverCapacity(
  ctx: MutationCtx,
  {
    guarantee,
    amountCents,
    actor,
  }: { guarantee: Guarantee; amountCents: number; actor: GuaranteeActor },
): Promise<Result<CoverCapacitySuccess, CoverCapacityError>> {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.INVALID_AMOUNT },
      message: "Cover amount must be a non-negative integer number of cents.",
    };
  }
  if (!isValidCapacity(guarantee.capacity)) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN },
      message: `Guarantee ${guarantee.publicId} capacity does not satisfy available + reserved = ceiling.`,
    };
  }

  const appliedCents = Math.min(guarantee.capacity.availableCents, amountCents);
  const capacity: GuaranteeCapacity = {
    ceilingCents: guarantee.capacity.ceilingCents,
    availableCents: guarantee.capacity.availableCents - appliedCents,
    reservedCents: guarantee.capacity.reservedCents + appliedCents,
  };

  const after = await writeCapacity(ctx, guarantee, capacity);
  await appendAuditEntry(ctx, {
    actor: { kind: "user", userId: actor.userId },
    action: AUDIT_ACTION.GUARANTEE_CAPACITY_RESERVED,
    resourceType: "guarantees",
    resourceId: guarantee.publicId,
    payload: {
      guaranteeId: guarantee._id,
      leaseId: guarantee.leaseId,
      agencyId: guarantee.agencyId,
      requestedCents: amountCents,
      appliedCents,
      capacity: after.capacity,
    },
  });

  return {
    success: true,
    data: { appliedCents, capacity: after.capacity },
    message: `Reserved ${appliedCents} of ${amountCents} requested cents on ${guarantee.publicId}.`,
  };
}

/**
 * The exact inverse of `reserveCoverCapacity`: give back the figure the notice
 * recorded as applied, never the notice's face amount. Releasing more than is
 * currently reserved is refused rather than floored, because the excess would
 * have to come from somewhere and there is nowhere honest for it to come from.
 */
export async function releaseCoverCapacity(
  ctx: MutationCtx,
  {
    guarantee,
    appliedCents,
    actor,
  }: { guarantee: Guarantee; appliedCents: number; actor: GuaranteeActor },
): Promise<Result<CoverCapacitySuccess, CoverCapacityError>> {
  if (!Number.isInteger(appliedCents) || appliedCents < 0) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.INVALID_AMOUNT },
      message: "Released amount must be a non-negative integer number of cents.",
    };
  }
  if (!isValidCapacity(guarantee.capacity)) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN },
      message: `Guarantee ${guarantee.publicId} capacity does not satisfy available + reserved = ceiling.`,
    };
  }
  if (appliedCents > guarantee.capacity.reservedCents) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.RELEASE_EXCEEDS_RESERVED },
      message: `Cannot release ${appliedCents} cents; only ${guarantee.capacity.reservedCents} are reserved.`,
    };
  }

  const capacity: GuaranteeCapacity = {
    ceilingCents: guarantee.capacity.ceilingCents,
    availableCents: guarantee.capacity.availableCents + appliedCents,
    reservedCents: guarantee.capacity.reservedCents - appliedCents,
  };

  const after = await writeCapacity(ctx, guarantee, capacity);
  await appendAuditEntry(ctx, {
    actor: { kind: "user", userId: actor.userId },
    action: AUDIT_ACTION.GUARANTEE_CAPACITY_RELEASED,
    resourceType: "guarantees",
    resourceId: guarantee.publicId,
    payload: {
      guaranteeId: guarantee._id,
      leaseId: guarantee.leaseId,
      agencyId: guarantee.agencyId,
      releasedCents: appliedCents,
      capacity: after.capacity,
    },
  });

  return {
    success: true,
    data: { appliedCents, capacity: after.capacity },
    message: `Released ${appliedCents} cents on ${guarantee.publicId}.`,
  };
}

/**
 * `ativoInsuredCentsPlatform` sums `capacity.availableCents`, so a capacity
 * patch is an aggregate write too — the two must not be separable.
 */
async function writeCapacity(
  ctx: MutationCtx,
  guarantee: Guarantee,
  capacity: GuaranteeCapacity,
): Promise<Guarantee> {
  await ctx.db.patch(guarantee._id, { capacity });
  const after = await ctx.db.get(guarantee._id);
  if (!after) throw new Error("Guarantee row vanished mid-transaction");
  await replaceGuaranteeAggregates(ctx, guarantee, after);
  return after;
}
