import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { Result } from "../lib/result";
import { assertAgencyAccess, mutationWithAgencyScope, mutationWithMutavRole } from "../lib/auth";
import { CONTRACT_STATUS } from "../contracts/domain";
import { AUDIT_ACTION } from "../audit/domain";
import {
  DELINQUENCY_STATUS,
  assertTransition,
  NOTICE_RESOLUTION_KIND,
  NOTICE_CANCELLATION_REASON,
  NOTICE_EVIDENCE_SOURCE,
  noticeEvidenceSourceValidator,
} from "./domain";
import type { TransitionError } from "./machine";

// Reused across every state-changing mutation: the machine's guard error
// codes map 1:1 onto the mutation-level error codes for transition failures.
type TransitionErrorCode = TransitionError["code"];

// ---------------------------------------------------------------------------
// openNotice — agency files a new delinquency notice
// ---------------------------------------------------------------------------

type OpenNoticeSuccess = { publicId: string };
type OpenNoticeError = {
  code:
    | "CONTRACT_NOT_FOUND"
    | "CONTRACT_NOT_ACTIVE"
    | "DUPLICATE_NOTICE"
    | "INVALID_EVIDENCE_SOURCE";
};

/**
 * The agency-side entry point for filing a delinquency notice. Restricts
 * `evidenceSource` to `agency_reported` — higher-trust provenance
 * (`bank_attested`, `onchain_observed`, `system_scheduled`) belongs to
 * system paths and would falsely elevate the row on the transparency
 * dashboard if agencies could self-attest.
 */
export const openNotice = mutationWithAgencyScope({
  args: {
    contractPublicId: v.string(),
    rentDueDate: v.string(),
    originalAmountCents: v.number(),
    evidenceSource: v.optional(noticeEvidenceSourceValidator),
  },
  handler: async (ctx, args): Promise<Result<OpenNoticeSuccess, OpenNoticeError>> => {
    const evidenceSource = args.evidenceSource ?? NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED;
    if (evidenceSource !== NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED) {
      return {
        success: false,
        error: { code: "INVALID_EVIDENCE_SOURCE" },
        message:
          "Agency callers may only file notices with evidenceSource='agency_reported'. Higher-trust provenance is system-only.",
      };
    }

    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.contractPublicId))
      .unique();

    // Merge not-found + wrong-agency: same error surface avoids leaking
    // cross-agency existence to a caller that only has membership in a
    // different agency.
    if (!contract || contract.agencyId !== ctx.agencyId) {
      return {
        success: false,
        error: { code: "CONTRACT_NOT_FOUND" },
        message: `No active contract '${args.contractPublicId}' in this agency.`,
      };
    }

    if (contract.status !== CONTRACT_STATUS.ATIVO) {
      return {
        success: false,
        error: { code: "CONTRACT_NOT_ACTIVE" },
        message: `Contract '${contract.publicId}' is not active (current status: '${contract.status}').`,
      };
    }

    // Idempotency: one OPEN notice per (contract, dueDate). Prior notices
    // that resolved or canceled are legal — the agency may re-file if a
    // stale/withdrawn notice needs to be reopened.
    const priorForDueDate = await ctx.db
      .query("contractDelinquencyNotices")
      .withIndex("by_contract_dueDate", (q) =>
        q.eq("contractId", contract._id).eq("rentDueDate", args.rentDueDate),
      )
      .collect();

    if (priorForDueDate.some((n) => n.status === DELINQUENCY_STATUS.OPEN)) {
      return {
        success: false,
        error: { code: "DUPLICATE_NOTICE" },
        message: `An open notice already exists for contract '${contract.publicId}' on ${args.rentDueDate}.`,
      };
    }

    // publicId: DN-<contractPublicId>-<yyyy-mm>. Prior resolved/canceled
    // notices for the same month collide on this scheme; append -2, -3, ...
    // deterministic and greppable rather than random. All colliding rows are
    // already in `priorForDueDate` (same contract, same dueDate → same month),
    // so pick the first unused suffix in-memory rather than round-tripping
    // per-candidate to the DB.
    const yyyymm = args.rentDueDate.slice(0, 7);
    const basePublicId = `DN-${args.contractPublicId}-${yyyymm}`;
    const takenPublicIds = new Set(priorForDueDate.map((n) => n.publicId));
    let publicId = basePublicId;
    let suffix = 2;
    while (takenPublicIds.has(publicId)) {
      publicId = `${basePublicId}-${suffix}`;
      suffix += 1;
    }

    const openedAt = new Date().toISOString();
    // TODO(audit): emit appendAuditEntry once agency-side audit lands. Pilot
    // relies on the openedByUserId column plus staff-side entries; see
    // docs/architecture/admin.md.
    await ctx.db.insert("contractDelinquencyNotices", {
      publicId,
      contractId: contract._id,
      agencyId: ctx.agencyId,
      status: DELINQUENCY_STATUS.OPEN,
      rentDueDate: args.rentDueDate,
      originalAmountCents: args.originalAmountCents,
      updatedAmountCents: args.originalAmountCents,
      evidenceSource,
      openedAt,
      openedByUserId: ctx.user._id,
    });

    return {
      success: true,
      data: { publicId },
      message: `Delinquency notice '${publicId}' opened.`,
    };
  },
});

// ---------------------------------------------------------------------------
// markResolved — agency-triggered resolution (tenant_cured, stale)
// ---------------------------------------------------------------------------

type MarkResolvedSuccess = { publicId: string };
type MarkResolvedError = { code: "NOTICE_NOT_FOUND" | TransitionErrorCode };

/**
 * Agency-side resolution. Deliberately excludes `cover_committed` and
 * `staff_dispute` at the validator — those are staff-only dispositions.
 * Bare mutation + inline assertAgencyAccess is the resource-by-id pattern:
 * the deep-linkable noticePublicId means the agency ID comes from the row,
 * not from client args.
 */
export const markResolved = mutation({
  args: {
    noticePublicId: v.string(),
    resolution: v.object({
      kind: v.union(
        v.literal(NOTICE_RESOLUTION_KIND.TENANT_CURED),
        v.literal(NOTICE_RESOLUTION_KIND.STALE),
      ),
      note: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Result<MarkResolvedSuccess, MarkResolvedError>> => {
    const notice = await ctx.db
      .query("contractDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    // Write path: let the throw propagate on cross-agency access. Unlike
    // reads, writes should fail loudly — the caller must not silently
    // observe a null when their action was refused. `membership.userId` is
    // the authenticated caller's id — assertAgencyAccess resolved it from
    // the identity token — so no separate user re-fetch is needed.
    const membership = await assertAgencyAccess(ctx, notice.agencyId);

    const guard = assertTransition(notice.status, DELINQUENCY_STATUS.RESOLVED);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    // TODO(audit): emit appendAuditEntry once agency-side audit lands; see
    // docs/architecture/admin.md.
    await ctx.db.patch(notice._id, {
      status: DELINQUENCY_STATUS.RESOLVED,
      resolution: {
        kind: args.resolution.kind,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: membership.userId,
        note: args.resolution.note,
      },
    });

    return {
      success: true,
      data: { publicId: notice.publicId },
      message: `Delinquency notice '${notice.publicId}' resolved (${args.resolution.kind}).`,
    };
  },
});

// ---------------------------------------------------------------------------
// markCanceled — agency-triggered cancellation (agency_withdrew, duplicate,
// data_error)
// ---------------------------------------------------------------------------

type MarkCanceledSuccess = { publicId: string };
type MarkCanceledError = { code: "NOTICE_NOT_FOUND" | TransitionErrorCode };

/**
 * Agency-side cancellation. Validator excludes `staff_dismissed`, mirroring
 * the resolution/cancellation split enforced across the domain: staff-only
 * dispositions never reach an agency-facing wire type.
 */
export const markCanceled = mutation({
  args: {
    noticePublicId: v.string(),
    cancellation: v.object({
      reason: v.union(
        v.literal(NOTICE_CANCELLATION_REASON.AGENCY_WITHDREW),
        v.literal(NOTICE_CANCELLATION_REASON.DUPLICATE),
        v.literal(NOTICE_CANCELLATION_REASON.DATA_ERROR),
      ),
      note: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Result<MarkCanceledSuccess, MarkCanceledError>> => {
    const notice = await ctx.db
      .query("contractDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    // See markResolved above for why membership.userId (not a re-fetch) is
    // the authored-by id on a bare mutation.
    const membership = await assertAgencyAccess(ctx, notice.agencyId);

    const guard = assertTransition(notice.status, DELINQUENCY_STATUS.CANCELED);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    // TODO(audit): emit appendAuditEntry once agency-side audit lands; see
    // docs/architecture/admin.md.
    await ctx.db.patch(notice._id, {
      status: DELINQUENCY_STATUS.CANCELED,
      cancellation: {
        reason: args.cancellation.reason,
        canceledAt: new Date().toISOString(),
        canceledByUserId: membership.userId,
        note: args.cancellation.note,
      },
    });

    return {
      success: true,
      data: { publicId: notice.publicId },
      message: `Delinquency notice '${notice.publicId}' canceled (${args.cancellation.reason}).`,
    };
  },
});

// ---------------------------------------------------------------------------
// staffMarkResolvedByCover — cover_committed resolution, compliance+ only
// ---------------------------------------------------------------------------

type StaffResolveByCoverSuccess = { publicId: string };
type StaffResolveByCoverError = { code: "NOTICE_NOT_FOUND" | TransitionErrorCode };

/**
 * cover_committed is the money-committing resolution: Mutav has drawn from
 * the reserve to pay the landlord and a Regressive Receivable is born.
 * Compliance+ gate + hash-chained audit entry — coverOperationPublicId is
 * a free-form string until the coverOperations table lands (later slice).
 */
export const staffMarkResolvedByCover = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    noticePublicId: v.string(),
    coverOperationPublicId: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<StaffResolveByCoverSuccess, StaffResolveByCoverError>> => {
    const notice = await ctx.db
      .query("contractDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    const guard = assertTransition(notice.status, DELINQUENCY_STATUS.RESOLVED);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    const resolvedAt = new Date().toISOString();
    await ctx.db.patch(notice._id, {
      status: DELINQUENCY_STATUS.RESOLVED,
      resolution: {
        kind: NOTICE_RESOLUTION_KIND.COVER_COMMITTED,
        resolvedAt,
        resolvedByUserId: ctx.user._id,
        coverOperationPublicId: args.coverOperationPublicId,
        note: args.note,
      },
    });

    // Audit AFTER the patch: hash-chained entries should reflect committed
    // state only. If the patch throws, the audit row rolls back with the
    // rest of the transaction — no orphan entries in either direction.
    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.DELINQUENCY_RESOLVED_BY_COVER,
      resourceType: "contractDelinquencyNotices",
      resourceId: notice.publicId,
      payload: {
        noticeId: notice._id,
        contractId: notice.contractId,
        agencyId: notice.agencyId,
        coverOperationPublicId: args.coverOperationPublicId,
        originalAmountCents: notice.originalAmountCents,
        updatedAmountCents: notice.updatedAmountCents,
        resolvedAt,
        note: args.note ?? null,
      },
    });

    return {
      success: true,
      data: { publicId: notice.publicId },
      message: `Delinquency notice '${notice.publicId}' resolved by cover.`,
    };
  },
});

// ---------------------------------------------------------------------------
// staffMarkCanceledByDismissal — staff_dismissed OR staff_dispute
// ---------------------------------------------------------------------------

type StaffDismissSuccess = {
  publicId: string;
  terminalStatus: "canceled" | "resolved";
};
type StaffDismissError = { code: "NOTICE_NOT_FOUND" | TransitionErrorCode };

/**
 * The two staff-only terminal dispositions share auth gate, cross-agency
 * scope, and audit shape — collapsed into one mutation with a discriminated
 * arg. Per contract-default-scenarios.md, `staff_dispute` is a RESOLUTION on
 * the notice (not a cancellation); the contract-level `closed(dispute_reversal)`
 * that follows belongs to the contracts domain and is not this mutation's
 * responsibility.
 */
export const staffMarkCanceledByDismissal = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    noticePublicId: v.string(),
    disposition: v.object({
      kind: v.union(
        v.literal(NOTICE_CANCELLATION_REASON.STAFF_DISMISSED),
        v.literal(NOTICE_RESOLUTION_KIND.STAFF_DISPUTE),
      ),
      note: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Result<StaffDismissSuccess, StaffDismissError>> => {
    const notice = await ctx.db
      .query("contractDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    const isDispute = args.disposition.kind === NOTICE_RESOLUTION_KIND.STAFF_DISPUTE;
    const target = isDispute ? DELINQUENCY_STATUS.RESOLVED : DELINQUENCY_STATUS.CANCELED;

    const guard = assertTransition(notice.status, target);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    const now = new Date().toISOString();
    if (isDispute) {
      await ctx.db.patch(notice._id, {
        status: DELINQUENCY_STATUS.RESOLVED,
        resolution: {
          kind: NOTICE_RESOLUTION_KIND.STAFF_DISPUTE,
          resolvedAt: now,
          resolvedByUserId: ctx.user._id,
          note: args.disposition.note,
        },
      });
    } else {
      await ctx.db.patch(notice._id, {
        status: DELINQUENCY_STATUS.CANCELED,
        cancellation: {
          reason: NOTICE_CANCELLATION_REASON.STAFF_DISMISSED,
          canceledAt: now,
          canceledByUserId: ctx.user._id,
          note: args.disposition.note,
        },
      });
    }

    await ctx.appendStaffAudit({
      action: isDispute ? AUDIT_ACTION.DELINQUENCY_DISPUTED : AUDIT_ACTION.DELINQUENCY_DISMISSED,
      resourceType: "contractDelinquencyNotices",
      resourceId: notice.publicId,
      payload: {
        noticeId: notice._id,
        contractId: notice.contractId,
        agencyId: notice.agencyId,
        kind: args.disposition.kind,
        at: now,
        note: args.disposition.note ?? null,
      },
    });

    return {
      success: true,
      data: { publicId: notice.publicId, terminalStatus: target },
      message: `Delinquency notice '${notice.publicId}' ${target} by staff (${args.disposition.kind}).`,
    };
  },
});
