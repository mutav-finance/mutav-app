import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import { mutationWithMutavRole } from "../lib/auth";
import { generateCoverBatchId, generateCoverOperationPublicId } from "../lib/randomId";
import { AUDIT_ACTION, type AppendAuditEntryInput, type AuditEntryId } from "../audit/domain";
import type { User } from "../users/domain";
import {
  GUARANTEE_ERROR_CODE,
  GUARANTEE_STATE,
  type Guarantee,
  type GuaranteeId,
} from "../guarantees/domain";
import {
  applyGuaranteeTransition,
  isValidCapacity,
  reserveCoverCapacity,
  type GuaranteeActor,
} from "../guarantees/transitions";
import {
  DELINQUENCY_STATUS,
  GUARANTEE_REFUSED_ERROR_CODE,
  NOTICE_NOT_VERIFIED_ERROR_CODE,
  NOTICE_RESOLUTION_KIND,
  assertTransition,
  type DelinquencyNotice,
  type GuaranteeRefusedErrorCode,
  type NoticeNotVerifiedErrorCode,
  type TransitionError,
} from "../delinquencies/domain";
import {
  COVER_OPERATION_ERROR_CODE,
  COVER_OPERATION_STATUS,
  MAX_COVER_BATCH_SIZE,
  coveragePeriodOf,
  isExecuted,
} from "./domain";

/**
 * What the staff wrappers inject on top of `MutationCtx`. The ledger writes
 * are shared by the single and the batch entry points, so they take this
 * narrowed ctx instead of living inside one handler.
 */
type StaffMutationCtx = MutationCtx & {
  user: User;
  appendStaffAudit: (input: Omit<AppendAuditEntryInput, "actor">) => Promise<AuditEntryId>;
};

type RecordCoverErrorCode =
  | "NOTICE_NOT_FOUND"
  | TransitionError["code"]
  | NoticeNotVerifiedErrorCode
  | GuaranteeRefusedErrorCode
  | typeof GUARANTEE_ERROR_CODE.INVALID_AMOUNT
  | typeof GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN
  | typeof COVER_OPERATION_ERROR_CODE.COVER_ALREADY_RECORDED;

type CoverPlan = { notice: DelinquencyNotice; coveragePeriod: string };

type RecordedCover = {
  operationPublicId: string;
  noticePublicId: string;
  appliedCoverCents: number;
};

async function loadGuarantee(ctx: MutationCtx, guaranteeId: GuaranteeId): Promise<Guarantee> {
  const guarantee = await ctx.db.get(guaranteeId);
  if (!guarantee) throw new Error(`Notice points at a missing guarantee ${guaranteeId}`);
  return guarantee;
}

function idempotencyKey({
  guaranteeId,
  coveragePeriod,
}: {
  guaranteeId: GuaranteeId;
  coveragePeriod: string;
}): string {
  return `${guaranteeId}:${coveragePeriod}`;
}

/**
 * Every refusal a cover can earn, decided with reads only. Recording is split
 * into this read-only plan and a write-only commit so a batch can plan EVERY
 * notice before it writes ANY of them: a typed refusal returned after the
 * first notice had already reserved capacity would commit that half of the
 * batch, because only a throw rolls a Convex mutation back.
 */
async function planCover(
  ctx: MutationCtx,
  noticePublicId: string,
): Promise<Result<CoverPlan, { code: RecordCoverErrorCode }>> {
  const notice = await ctx.db
    .query("guaranteeDelinquencyNotices")
    .withIndex("by_publicId", (q) => q.eq("publicId", noticePublicId))
    .unique();
  if (!notice) {
    return {
      success: false,
      error: { code: "NOTICE_NOT_FOUND" },
      message: `No delinquency notice '${noticePublicId}'.`,
    };
  }

  const guard = assertTransition(notice.status, DELINQUENCY_STATUS.RESOLVED);
  if (!guard.success) {
    return { success: false, error: { code: guard.error.code }, message: guard.message };
  }

  // Cover draws against THIS notice, so THIS notice must be the one
  // compliance verified — a sibling notice's verification is what may have
  // put the guarantee in `default_verified`.
  if (notice.status !== DELINQUENCY_STATUS.VERIFIED) {
    return {
      success: false,
      error: { code: NOTICE_NOT_VERIFIED_ERROR_CODE },
      message: `Delinquency notice '${notice.publicId}' is '${notice.status}'; only a staff-verified default may draw cover.`,
    };
  }

  const guarantee = await loadGuarantee(ctx, notice.guaranteeId);
  if (
    guarantee.status !== GUARANTEE_STATE.DEFAULT_VERIFIED &&
    guarantee.status !== GUARANTEE_STATE.COVER_COMMITTED
  ) {
    return {
      success: false,
      error: { code: GUARANTEE_REFUSED_ERROR_CODE },
      message: `Guarantee '${guarantee.publicId}' is '${guarantee.status}'; cover may only be committed against a verified default.`,
    };
  }
  if (!isValidCapacity(guarantee.capacity)) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN },
      message: `Guarantee ${guarantee.publicId} capacity does not satisfy available + reserved = ceiling.`,
    };
  }
  if (!Number.isInteger(notice.updatedAmountCents) || notice.updatedAmountCents < 0) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.INVALID_AMOUNT },
      message: `Delinquency notice '${notice.publicId}' carries a non-integer or negative amount.`,
    };
  }

  // `openNotice` refuses any rentDueDate that is not YYYY-MM-DD, so a miss
  // here is corrupted data, not a caller mistake.
  const coveragePeriod = coveragePeriodOf(notice.rentDueDate);
  if (coveragePeriod === null) {
    throw new Error(`Notice ${notice.publicId} has an unreadable rentDueDate.`);
  }

  // ADR 0004: one draw per guarantee per billing month. The notice machine
  // already stops the same notice twice; this stops a second notice for the
  // same month from minting a second payout.
  const prior = await ctx.db
    .query("coverOperations")
    .withIndex("by_guarantee_period", (q) =>
      q.eq("guaranteeId", notice.guaranteeId).eq("coveragePeriod", coveragePeriod),
    )
    .first();
  if (prior) {
    return {
      success: false,
      error: { code: COVER_OPERATION_ERROR_CODE.COVER_ALREADY_RECORDED },
      message: `Cover for guarantee '${guarantee.publicId}' in ${coveragePeriod} is already recorded as '${prior.publicId}'.`,
    };
  }

  return { success: true, data: { notice, coveragePeriod }, message: "Cover can be recorded." };
}

async function mintOperationPublicId(ctx: MutationCtx): Promise<string> {
  // 40 random bits make a collision vanishingly rare, but `by_publicId` is
  // read with `.unique()`, which throws on a duplicate — so check anyway.
  for (;;) {
    const candidate = generateCoverOperationPublicId();
    const taken = await ctx.db
      .query("coverOperations")
      .withIndex("by_publicId", (q) => q.eq("publicId", candidate))
      .first();
    if (!taken) return candidate;
  }
}

/**
 * The writes for one planned cover. Every refusal was decided in `planCover`,
 * so anything that fails here is an invariant break and THROWS, taking the
 * whole transaction — every other notice of the batch included — back with it.
 */
async function commitCover(
  ctx: StaffMutationCtx,
  {
    plan,
    batchId,
    note,
    recordedAt,
  }: { plan: CoverPlan; batchId: string | undefined; note: string | undefined; recordedAt: string },
): Promise<RecordedCover> {
  const { notice, coveragePeriod } = plan;
  const actor: GuaranteeActor = { userId: ctx.user._id, username: ctx.user.name };

  // Re-read: an earlier notice of the same batch may already have drawn
  // against this guarantee and moved it to `cover_committed`. The hop happens
  // once per episode; every further notice draws against the same ceiling.
  const guarantee = await loadGuarantee(ctx, notice.guaranteeId);
  const isFirstDraw = guarantee.status === GUARANTEE_STATE.DEFAULT_VERIFIED;

  // Draw the UPDATED amount: what the tenant owes the landlord at cover time,
  // original plus accrued juros and multa, is the figure Mutav pays out.
  const reserved = await reserveCoverCapacity(ctx, {
    guarantee,
    amountCents: notice.updatedAmountCents,
    actor,
  });
  if (!reserved.success) throw new Error(reserved.message);

  if (isFirstDraw) {
    const applied = await applyGuaranteeTransition(ctx, {
      guarantee: await loadGuarantee(ctx, notice.guaranteeId),
      to: GUARANTEE_STATE.COVER_COMMITTED,
      actor,
      message: "Cobertura acionada pela Mutav",
    });
    if (!applied.success) throw new Error(applied.message);
  }

  const operationPublicId = await mintOperationPublicId(ctx);
  const operationId = await ctx.db.insert("coverOperations", {
    publicId: operationPublicId,
    status: COVER_OPERATION_STATUS.RECORDED,
    noticeId: notice._id,
    guaranteeId: notice.guaranteeId,
    agencyId: notice.agencyId,
    coveragePeriod,
    batchId,
    requestedCents: notice.updatedAmountCents,
    appliedCents: reserved.data.appliedCents,
    recordedAt,
    recordedByUserId: ctx.user._id,
    note,
  });

  await ctx.db.patch(notice._id, {
    status: DELINQUENCY_STATUS.RESOLVED,
    resolution: {
      kind: NOTICE_RESOLUTION_KIND.COVER_COMMITTED,
      resolvedAt: recordedAt,
      resolvedByUserId: ctx.user._id,
      coverOperationId: operationId,
      coverOperationPublicId: operationPublicId,
      // The clamped figure, never the face amount: a later dispute reversal
      // releases exactly this many cents.
      appliedCoverCents: reserved.data.appliedCents,
      note,
    },
  });

  // Audit AFTER the writes: hash-chained entries reflect committed state, and
  // a later throw rolls these rows back with everything else.
  await ctx.appendStaffAudit({
    action: AUDIT_ACTION.DELINQUENCY_RESOLVED_BY_COVER,
    resourceType: "guaranteeDelinquencyNotices",
    resourceId: notice.publicId,
    payload: {
      noticeId: notice._id,
      guaranteeId: notice.guaranteeId,
      agencyId: notice.agencyId,
      coverOperationPublicId: operationPublicId,
      originalAmountCents: notice.originalAmountCents,
      updatedAmountCents: notice.updatedAmountCents,
      appliedCoverCents: reserved.data.appliedCents,
      capacity: reserved.data.capacity,
      resolvedAt: recordedAt,
      note: note ?? null,
    },
  });
  await ctx.appendStaffAudit({
    action: AUDIT_ACTION.COVER_OPERATION_RECORDED,
    resourceType: "coverOperations",
    resourceId: operationPublicId,
    payload: {
      operationId,
      noticeId: notice._id,
      guaranteeId: notice.guaranteeId,
      agencyId: notice.agencyId,
      coveragePeriod,
      batchId: batchId ?? null,
      requestedCents: notice.updatedAmountCents,
      appliedCents: reserved.data.appliedCents,
      recordedAt,
      note: note ?? null,
    },
  });

  return {
    operationPublicId,
    noticePublicId: notice.publicId,
    appliedCoverCents: reserved.data.appliedCents,
  };
}

function trimToOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// staffRecordCover — one verified notice
// ---------------------------------------------------------------------------

/**
 * cover_committed is the money-committing resolution: Mutav owes the landlord
 * and a regressive receivable is born. Recording writes the ledger row in
 * `recorded`; the payout itself is off-chain and confirmed separately by
 * `staffMarkCoverExecuted`.
 */
export const staffRecordCover = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    noticePublicId: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result<RecordedCover, { code: RecordCoverErrorCode }>> => {
    const planned = await planCover(ctx, args.noticePublicId);
    if (!planned.success) return planned;

    const recorded = await commitCover(ctx, {
      plan: planned.data,
      batchId: undefined,
      note: trimToOptional(args.note),
      recordedAt: new Date().toISOString(),
    });
    return {
      success: true,
      data: recorded,
      message: `Cover '${recorded.operationPublicId}' recorded for notice '${recorded.noticePublicId}' (${recorded.appliedCoverCents} cents).`,
    };
  },
});

// ---------------------------------------------------------------------------
// staffRecordCoverBatch — many verified notices, all or nothing
// ---------------------------------------------------------------------------

type RecordCoverBatchSuccess = { batchId: string; operations: RecordedCover[] };
type RecordCoverBatchError = {
  code:
    | RecordCoverErrorCode
    | typeof COVER_OPERATION_ERROR_CODE.EMPTY_BATCH
    | typeof COVER_OPERATION_ERROR_CODE.BATCH_TOO_LARGE
    | typeof COVER_OPERATION_ERROR_CODE.DUPLICATE_NOTICE_IN_BATCH;
  /** The notice that refused the batch, so the operator knows which row to fix. */
  noticePublicId?: string;
};

/**
 * One row per notice under a shared `batchId`, written in one transaction.
 * Any notice that would be refused on its own refuses the whole batch before
 * a single write: a partially recorded batch would leave the operator
 * reconciling which payouts the ledger now owes.
 */
export const staffRecordCoverBatch = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    noticePublicIds: v.array(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result<RecordCoverBatchSuccess, RecordCoverBatchError>> => {
    if (args.noticePublicIds.length === 0) {
      return {
        success: false,
        error: { code: COVER_OPERATION_ERROR_CODE.EMPTY_BATCH },
        message: "A cover batch needs at least one notice.",
      };
    }
    if (args.noticePublicIds.length > MAX_COVER_BATCH_SIZE) {
      return {
        success: false,
        error: { code: COVER_OPERATION_ERROR_CODE.BATCH_TOO_LARGE },
        message: `A cover batch takes at most ${MAX_COVER_BATCH_SIZE} notices (got ${args.noticePublicIds.length}).`,
      };
    }

    const seenNotices = new Set<string>();
    const seenKeys = new Set<string>();
    const plans: CoverPlan[] = [];
    for (const noticePublicId of args.noticePublicIds) {
      if (seenNotices.has(noticePublicId)) {
        return {
          success: false,
          error: { code: COVER_OPERATION_ERROR_CODE.DUPLICATE_NOTICE_IN_BATCH, noticePublicId },
          message: `Notice '${noticePublicId}' appears more than once in the batch.`,
        };
      }
      seenNotices.add(noticePublicId);

      const planned = await planCover(ctx, noticePublicId);
      if (!planned.success) {
        return {
          success: false,
          error: { code: planned.error.code, noticePublicId },
          message: planned.message,
        };
      }

      // The ledger check in `planCover` only sees committed rows; two notices
      // of one guarantee in the same month inside this batch would both pass
      // it, so the key is checked against the batch itself too.
      const key = idempotencyKey({
        guaranteeId: planned.data.notice.guaranteeId,
        coveragePeriod: planned.data.coveragePeriod,
      });
      if (seenKeys.has(key)) {
        return {
          success: false,
          error: { code: COVER_OPERATION_ERROR_CODE.COVER_ALREADY_RECORDED, noticePublicId },
          message: `Notice '${noticePublicId}' repeats a guarantee and billing month already in the batch.`,
        };
      }
      seenKeys.add(key);
      plans.push(planned.data);
    }

    const batchId = generateCoverBatchId();
    const note = trimToOptional(args.note);
    const recordedAt = new Date().toISOString();
    const operations: RecordedCover[] = [];
    for (const plan of plans) {
      operations.push(await commitCover(ctx, { plan, batchId, note, recordedAt }));
    }

    return {
      success: true,
      data: { batchId, operations },
      message: `Cover batch '${batchId}' recorded ${operations.length} operations.`,
    };
  },
});

// ---------------------------------------------------------------------------
// staffMarkCoverExecuted — recorded → executed
// ---------------------------------------------------------------------------

type MarkCoverExecutedSuccess = { operationPublicId: string; executedAt: string };
type MarkCoverExecutedError = {
  code:
    | typeof COVER_OPERATION_ERROR_CODE.COVER_OPERATION_NOT_FOUND
    | typeof COVER_OPERATION_ERROR_CODE.COVER_ALREADY_EXECUTED
    | typeof COVER_OPERATION_ERROR_CODE.PAYMENT_REFERENCE_REQUIRED;
};

/**
 * Confirms the off-chain payout to the landlord has left. The payment
 * reference is required because it is the only evidence tying the ledger row
 * to money that actually moved — an `executed` row without one would be
 * indistinguishable from a click.
 */
export const staffMarkCoverExecuted = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    operationPublicId: v.string(),
    paymentReference: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result<MarkCoverExecutedSuccess, MarkCoverExecutedError>> => {
    const paymentReference = args.paymentReference.trim();
    if (!paymentReference) {
      return {
        success: false,
        error: { code: COVER_OPERATION_ERROR_CODE.PAYMENT_REFERENCE_REQUIRED },
        message: "An executed payout needs its off-chain payment reference.",
      };
    }

    const operation = await ctx.db
      .query("coverOperations")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.operationPublicId))
      .unique();
    if (!operation) {
      return {
        success: false,
        error: { code: COVER_OPERATION_ERROR_CODE.COVER_OPERATION_NOT_FOUND },
        message: `No cover operation '${args.operationPublicId}'.`,
      };
    }
    if (isExecuted(operation.status)) {
      return {
        success: false,
        error: { code: COVER_OPERATION_ERROR_CODE.COVER_ALREADY_EXECUTED },
        message: `Cover operation '${operation.publicId}' is already executed.`,
      };
    }

    const executedAt = new Date().toISOString();
    const note = trimToOptional(args.note);
    await ctx.db.patch(operation._id, {
      status: COVER_OPERATION_STATUS.EXECUTED,
      execution: { executedAt, executedByUserId: ctx.user._id, paymentReference, note },
    });

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.COVER_OPERATION_EXECUTED,
      resourceType: "coverOperations",
      resourceId: operation.publicId,
      payload: {
        operationId: operation._id,
        noticeId: operation.noticeId,
        guaranteeId: operation.guaranteeId,
        agencyId: operation.agencyId,
        appliedCents: operation.appliedCents,
        paymentReference,
        executedAt,
        note: note ?? null,
      },
    });

    return {
      success: true,
      data: { operationPublicId: operation.publicId, executedAt },
      message: `Cover operation '${operation.publicId}' marked executed.`,
    };
  },
});
