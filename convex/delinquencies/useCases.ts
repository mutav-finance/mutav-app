import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { QueryCtx } from "../_generated/server";
import { mutationWithAgencyScope, queryWithAgencyScope } from "../lib/auth";
import type { Result } from "../lib/result";
import { CONTRACT_STATUS } from "../contracts/domain";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import {
  DELINQUENCY_ERROR_CODE,
  DELINQUENCY_STATUS,
  delinquencyResolutionValidator,
  delinquencyStatusValidator,
  type Delinquency,
  type DelinquencyStatus,
} from "./domain";
import { applyDelinquencyTransition, type DelinquencyTransitionError } from "./transitions";

function generatePublicId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "DLQ-";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

type OpenDelinquencySuccessResult = { publicId: string; status: DelinquencyStatus };
type OpenDelinquencyErrorResult = {
  code:
    | typeof DELINQUENCY_ERROR_CODE.NOT_FOUND
    | typeof DELINQUENCY_ERROR_CODE.CONTRACT_NOT_ACTIVE
    | typeof DELINQUENCY_ERROR_CODE.INVALID_AMOUNT
    | typeof DELINQUENCY_ERROR_CODE.DELINQUENCY_ALREADY_OPEN
    | typeof DELINQUENCY_ERROR_CODE.AMOUNT_EXCEEDS_GUARANTEE;
};

export const open = mutationWithAgencyScope({
  args: { contractPublicId: v.string(), amountCents: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<OpenDelinquencySuccessResult, OpenDelinquencyErrorResult>> => {
    // `.collect()` + agency match instead of `.unique()`: contract publicIds
    // carry no DB-level uniqueness constraint (seed re-runs can collide
    // across agencies). NOT_FOUND covers both "no such publicId" and
    // "publicId exists but in a different agency" — no existence leak.
    const candidates = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.contractPublicId))
      .collect();
    const contract = candidates.find((c) => c.agencyId === ctx.agencyId);

    if (!contract) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.NOT_FOUND },
        message: "Contract not found",
      };
    }
    if (contract.status !== CONTRACT_STATUS.ATIVO) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.CONTRACT_NOT_ACTIVE },
        message: "Delinquencies can only be opened on active contracts",
      };
    }
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.INVALID_AMOUNT },
        message: "Amount must be a positive integer number of cents",
      };
    }

    // Check-then-insert is race-safe under Convex OCC serialization:
    // concurrent opens conflict on this index read set and retry, so two
    // non-closed rows can never land on the same contract.
    const existing = await ctx.db
      .query("delinquencies")
      .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
      .collect();
    if (existing.some((row) => row.status !== DELINQUENCY_STATUS.CLOSED)) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.DELINQUENCY_ALREADY_OPEN },
        message: "A non-closed delinquency already exists for this contract",
      };
    }
    if (args.amountCents > contract.availableGuaranteeCents) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.AMOUNT_EXCEEDS_GUARANTEE },
        message: "Amount exceeds the contract's available guarantee",
      };
    }

    const publicId = generatePublicId();
    const delinquencyId = await ctx.db.insert("delinquencies", {
      contractId: contract._id,
      agencyId: ctx.agencyId,
      publicId,
      status: DELINQUENCY_STATUS.OPEN,
      amountCents: args.amountCents,
      openedAt: new Date().toISOString(),
      closedAt: null,
      appliedGuaranteeDecrementCents: null,
      resolution: null,
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.DELINQUENCY_OPENED,
      resourceType: "delinquencies",
      resourceId: publicId,
      payload: {
        delinquencyId,
        contractId: contract._id,
        contractPublicId: contract.publicId,
        agencyId: ctx.agencyId,
        amountCents: args.amountCents,
      },
    });

    return {
      success: true,
      data: { publicId, status: DELINQUENCY_STATUS.OPEN },
      message: "Delinquency opened",
    };
  },
});

type UpdateDelinquencyStatusSuccessResult = { publicId: string; status: DelinquencyStatus };
type UpdateDelinquencyStatusErrorResult = DelinquencyTransitionError;

export const updateStatus = mutationWithAgencyScope({
  args: {
    publicId: v.string(),
    status: delinquencyStatusValidator,
    resolution: v.optional(delinquencyResolutionValidator),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<UpdateDelinquencyStatusSuccessResult, UpdateDelinquencyStatusErrorResult>> => {
    const row = await ctx.db
      .query("delinquencies")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    // NOT_FOUND covers both "no such publicId" and "publicId exists but in a
    // different agency" — no cross-agency existence leak.
    if (!row || row.agencyId !== ctx.agencyId) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.NOT_FOUND },
        message: "Delinquency not found",
      };
    }

    const transition = await applyDelinquencyTransition(ctx, {
      row,
      toStatus: args.status,
      resolution: args.resolution ?? null,
    });
    if (!transition.success) return transition;

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.DELINQUENCY_STATUS_UPDATED,
      resourceType: "delinquencies",
      resourceId: row.publicId,
      payload: {
        delinquencyId: row._id,
        contractId: row.contractId,
        agencyId: ctx.agencyId,
        previousStatus: transition.data.previousStatus,
        status: transition.data.status,
        resolution: transition.data.resolution,
        amountCents: row.amountCents,
        appliedGuaranteeDecrementCents: transition.data.appliedGuaranteeDecrementCents,
      },
    });

    return {
      success: true,
      data: { publicId: row.publicId, status: args.status },
      message: "Delinquency status updated",
    };
  },
});

async function shapeDelinquencySummary(ctx: QueryCtx, doc: Delinquency) {
  const contract = await ctx.db.get(doc.contractId);
  return {
    publicId: doc.publicId,
    status: doc.status,
    amountCents: doc.amountCents,
    openedAt: doc.openedAt,
    closedAt: doc.closedAt,
    contractPublicId: contract?.publicId ?? "",
    tenantFullName: contract?.tenant.fullName ?? "",
  };
}

export const listByAgency = queryWithAgencyScope({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(delinquencyStatusValidator),
  },
  handler: async (ctx, args) => {
    const status = args.status;
    const result = await (
      status === undefined
        ? ctx.db
            .query("delinquencies")
            .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId))
        : ctx.db
            .query("delinquencies")
            .withIndex("by_agency_status", (q) =>
              q.eq("agencyId", ctx.agencyId).eq("status", status),
            )
    )
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(result.page.map((doc) => shapeDelinquencySummary(ctx, doc)));
    return { ...result, page };
  },
});
