import { v } from "convex/values";
import { internalMutation, type QueryCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import { mutationWithMutavRole, queryWithMutavRole } from "../lib/auth";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { GUARANTEE_STATE, type GuaranteeId } from "../guarantees/domain";
import { applyGuaranteeTransition } from "../guarantees/transitions";
import {
  CLAIM_EXPIRY_REASON,
  DELINQUENCY_STATUS,
  NOTICE_RESOLUTION_KIND,
  brazilToday,
  claimExpiryReason,
  type ClaimExpiryReason,
} from "./domain";
import { claimRulesFor } from "./claims";

/** One cron run's ceiling; a backlog drains over the following days. */
const EXPIRY_BATCH_LIMIT = 500;
const ARREARS_SCAN_LIMIT = 200;
const NOTICE_SCAN_LIMIT = 500;

const EXPIRY_NOTE: Record<ClaimExpiryReason, string> = {
  [CLAIM_EXPIRY_REASON.FILING_WINDOW]: "Prazo para acionar a garantia encerrado sem acionamento.",
  [CLAIM_EXPIRY_REASON.REQUEST_DEADLINE]: "Pendência não respondida dentro do prazo.",
};

/**
 * Daily: close every open notice whose claim lapsed (see `claimExpiryReason`)
 * as `resolved(stale)`. The guarantee is deliberately left where it is — an
 * expired case does not prove the tenant paid — and staff see it in
 * `listArrearsWithoutClaim`, where a person decides whether it returns to
 * `active`.
 */
export const expireLapsedClaims = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ expired: number }> => {
    const today = brazilToday(Date.now());
    const open = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_status_openedAt", (q) => q.eq("status", DELINQUENCY_STATUS.OPEN))
      .take(EXPIRY_BATCH_LIMIT);

    let expired = 0;
    for (const notice of open) {
      const guarantee = await ctx.db.get(notice.guaranteeId);
      if (!guarantee) continue;
      const reason = claimExpiryReason({
        notice,
        rules: await claimRulesFor(ctx, guarantee),
        today,
      });
      if (reason === null) continue;

      const resolvedAt = new Date().toISOString();
      await ctx.db.patch(notice._id, {
        status: DELINQUENCY_STATUS.RESOLVED,
        resolution: {
          kind: NOTICE_RESOLUTION_KIND.STALE,
          resolvedAt,
          note: EXPIRY_NOTE[reason],
        },
      });
      await ctx.db.insert("guaranteeHistory", {
        agencyId: notice.agencyId,
        guaranteePublicId: guarantee.publicId,
        at: resolvedAt,
        username: "Sistema",
        message: "Acionamento expirado",
      });
      await appendAuditEntry(ctx, {
        actor: { kind: "system", source: "cron_claim_expiry" },
        action: AUDIT_ACTION.DELINQUENCY_EXPIRED,
        resourceType: "guaranteeDelinquencyNotices",
        resourceId: notice.publicId,
        payload: {
          noticeId: notice._id,
          guaranteeId: notice.guaranteeId,
          agencyId: notice.agencyId,
          reason,
          resolvedAt,
        },
      });
      expired += 1;
    }
    return { expired };
  },
});

async function hasOutstandingNotice(ctx: QueryCtx, guaranteeId: GuaranteeId): Promise<boolean> {
  const notices = await ctx.db
    .query("guaranteeDelinquencyNotices")
    .withIndex("by_guarantee_dueDate", (q) => q.eq("guaranteeId", guaranteeId))
    .take(NOTICE_SCAN_LIMIT);
  return notices.some(
    (notice) =>
      notice.status === DELINQUENCY_STATUS.OPEN || notice.status === DELINQUENCY_STATUS.VERIFIED,
  );
}

export type ArrearsWithoutClaimRow = {
  guaranteeId: GuaranteeId;
  guaranteePublicId: string;
  agencyName: string;
  /** Registry name: staff are platform-scoped, as in the defaults queue. */
  tenantName: string | null;
  lastRentDueDate: string | null;
  lastClosedAt: string | null;
};

/**
 * Guarantees still `in_arrears` with nothing outstanding — in practice, the
 * ones whose case expired. Nobody is chasing them, so staff decide: return the
 * guarantee to `active`, or leave it for the agency to report again.
 */
export const listArrearsWithoutClaim = queryWithMutavRole({ minRole: "compliance" })({
  args: {},
  handler: async (ctx): Promise<ArrearsWithoutClaimRow[]> => {
    const inArrears = await ctx.db
      .query("guarantees")
      .withIndex("by_status", (q) => q.eq("status", GUARANTEE_STATE.IN_ARREARS))
      .take(ARREARS_SCAN_LIMIT);

    const rows: ArrearsWithoutClaimRow[] = [];
    for (const guarantee of inArrears) {
      if (await hasOutstandingNotice(ctx, guarantee._id)) continue;
      const notices = await ctx.db
        .query("guaranteeDelinquencyNotices")
        .withIndex("by_guarantee_dueDate", (q) => q.eq("guaranteeId", guarantee._id))
        .order("desc")
        .take(1);
      const last = notices[0];
      const agency = await ctx.db.get(guarantee.agencyId);
      const lease = await ctx.db.get(guarantee.leaseId);
      const tenant = lease ? await ctx.db.get(lease.tenantId) : null;
      rows.push({
        guaranteeId: guarantee._id,
        guaranteePublicId: guarantee.publicId,
        agencyName: agency?.name ?? "",
        tenantName: tenant?.fullName ?? null,
        lastRentDueDate: last?.rentDueDate ?? null,
        lastClosedAt: last?.resolution?.resolvedAt ?? last?.cancellation?.canceledAt ?? null,
      });
    }
    return rows;
  },
});

type ClearArrearsError = {
  code:
    | "GUARANTEE_NOT_FOUND"
    | "NOT_IN_ARREARS"
    | "NOTICE_OUTSTANDING"
    | "GUARANTEE_TRANSITION_REFUSED";
};

/**
 * Staff's decision that an arrears nobody is pursuing is over: the guarantee
 * goes back to `active`. Refused while any notice is still open or verified —
 * those close through their own dispositions.
 */
export const staffReturnToActive = mutationWithMutavRole({ minRole: "compliance" })({
  args: { guaranteeId: v.id("guarantees"), note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Result<{ guaranteePublicId: string }, ClearArrearsError>> => {
    const guarantee = await ctx.db.get(args.guaranteeId);
    if (!guarantee) {
      return {
        success: false,
        error: { code: "GUARANTEE_NOT_FOUND" },
        message: "Guarantee not found",
      };
    }
    if (guarantee.status !== GUARANTEE_STATE.IN_ARREARS) {
      return {
        success: false,
        error: { code: "NOT_IN_ARREARS" },
        message: `Guarantee '${guarantee.publicId}' is '${guarantee.status}'.`,
      };
    }
    if (await hasOutstandingNotice(ctx, guarantee._id)) {
      return {
        success: false,
        error: { code: "NOTICE_OUTSTANDING" },
        message: "Close the outstanding notice first.",
      };
    }

    const applied = await applyGuaranteeTransition(ctx, {
      guarantee,
      to: GUARANTEE_STATE.ACTIVE,
      actor: { userId: ctx.user._id, username: "Análise MUTAV" },
      message: "Atraso encerrado pela MUTAV",
    });
    if (!applied.success) {
      return {
        success: false,
        error: { code: "GUARANTEE_TRANSITION_REFUSED" },
        message: applied.message,
      };
    }

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_ARREARS_CLEARED,
      resourceType: "guarantee",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        agencyId: guarantee.agencyId,
        note: args.note?.trim() || null,
      },
    });

    return {
      success: true,
      data: { guaranteePublicId: guarantee.publicId },
      message: "Guarantee returned to active",
    };
  },
});
