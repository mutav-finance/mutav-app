import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { mutationWithAgencyScope, queryWithAgencyScope } from "../lib/auth";
import type { Result } from "../lib/result";
import { replaceContractAggregates } from "../contracts/aggregateWrites";
import { CONTRACT_STATUS } from "../contracts/domain";
import type { ContractId } from "../contracts/domain";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import {
  canTransition,
  DELINQUENCY_ERROR_CODE,
  DELINQUENCY_STATUS,
  delinquencyStatusValidator,
  type Delinquency,
  type DelinquencyStatus,
} from "./domain";

function generatePublicId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "DLQ-";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

async function adjustContractGuarantee(
  ctx: MutationCtx,
  contractId: ContractId,
  deltaCents: number,
): Promise<boolean> {
  const contract = await ctx.db.get(contractId);
  if (!contract) return false;

  await ctx.db.patch(contract._id, {
    availableGuaranteeCents: Math.max(0, contract.availableGuaranteeCents + deltaCents),
  });
  const after = await ctx.db.get(contract._id);
  if (after) await replaceContractAggregates(ctx, contract, after);
  return true;
}

type OpenDelinquencySuccessResult = { publicId: string; status: DelinquencyStatus };
type OpenDelinquencyErrorResult = {
  code:
    | typeof DELINQUENCY_ERROR_CODE.NOT_FOUND
    | typeof DELINQUENCY_ERROR_CODE.CONTRACT_NOT_ACTIVE
    | typeof DELINQUENCY_ERROR_CODE.INVALID_AMOUNT;
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
type UpdateDelinquencyStatusErrorResult = {
  code: typeof DELINQUENCY_ERROR_CODE.NOT_FOUND | typeof DELINQUENCY_ERROR_CODE.ILLEGAL_TRANSITION;
};

export const updateStatus = mutationWithAgencyScope({
  args: { publicId: v.string(), status: delinquencyStatusValidator },
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
    if (!canTransition(row.status, args.status)) {
      return {
        success: false,
        error: { code: DELINQUENCY_ERROR_CODE.ILLEGAL_TRANSITION },
        message: `Cannot transition from ${row.status} to ${args.status}`,
      };
    }

    // Guarantee impact — assumption pending Draau confirmation: provisioning
    // decrements the contract's availableGuaranteeCents by amountCents
    // (floored at 0); provisioned → paid restores exactly the applied
    // decrement. Other transitions have no balance effect.
    let appliedGuaranteeDecrementCents = row.appliedGuaranteeDecrementCents;
    if (args.status === DELINQUENCY_STATUS.PROVISIONED) {
      const contract = await ctx.db.get(row.contractId);
      if (!contract) {
        return {
          success: false,
          error: { code: DELINQUENCY_ERROR_CODE.NOT_FOUND },
          message: "Contract not found",
        };
      }
      appliedGuaranteeDecrementCents = Math.min(contract.availableGuaranteeCents, row.amountCents);
      await adjustContractGuarantee(ctx, row.contractId, -appliedGuaranteeDecrementCents);
    } else if (
      row.status === DELINQUENCY_STATUS.PROVISIONED &&
      args.status === DELINQUENCY_STATUS.PAID
    ) {
      const restored = await adjustContractGuarantee(
        ctx,
        row.contractId,
        row.appliedGuaranteeDecrementCents ?? 0,
      );
      if (!restored) {
        return {
          success: false,
          error: { code: DELINQUENCY_ERROR_CODE.NOT_FOUND },
          message: "Contract not found",
        };
      }
    }

    await ctx.db.patch(row._id, {
      status: args.status,
      appliedGuaranteeDecrementCents,
      ...(args.status === DELINQUENCY_STATUS.CLOSED ? { closedAt: new Date().toISOString() } : {}),
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.DELINQUENCY_STATUS_UPDATED,
      resourceType: "delinquencies",
      resourceId: row.publicId,
      payload: {
        delinquencyId: row._id,
        contractId: row.contractId,
        agencyId: ctx.agencyId,
        previousStatus: row.status,
        status: args.status,
        amountCents: row.amountCents,
        appliedGuaranteeDecrementCents,
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
