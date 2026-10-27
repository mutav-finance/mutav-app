import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { Result } from "../lib/result";
import { assertActiveAgencyAccess, assertAgencyAccess, queryWithMutavRole } from "../lib/auth";
import type { UserId } from "../users/domain";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { checkUploadedFile, type UploadedFileCheckError } from "../guarantees/domain";
import {
  CLAIM_EVIDENCE_STATUS,
  CLAIM_STATUS,
  DELINQUENCY_STATUS,
  claimEvidenceKindValidator,
  type ClaimEvidenceKind,
  type ClaimEvidenceStatus,
  type DelinquencyNotice,
  type DelinquencyNoticeId,
} from "./domain";

/** Newest-first cap for one notice's files; a case sees a handful at most. */
const CLAIM_EVIDENCE_HISTORY_LIMIT = 50;

export type ClaimEvidenceErrorCode =
  | "NOTICE_NOT_FOUND"
  | "NOTICE_NOT_OPEN"
  | "CLAIM_UNDER_REVIEW"
  | "FILE_NOT_FOUND"
  | "FILE_ALREADY_ATTACHED"
  | UploadedFileCheckError["code"];

export type ClaimEvidenceRow = {
  id: Id<"claimEvidence">;
  kind: ClaimEvidenceKind;
  status: ClaimEvidenceStatus;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  rejectionReason: string | null;
};

function shapeClaimEvidenceRow(row: {
  _id: Id<"claimEvidence">;
  kind: ClaimEvidenceKind;
  status: ClaimEvidenceStatus;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  rejectionReason?: string;
}): ClaimEvidenceRow {
  return {
    id: row._id,
    kind: row.kind,
    status: row.status,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt,
    rejectionReason: row.rejectionReason ?? null,
  };
}

export async function listEvidenceForNotice(
  ctx: QueryCtx,
  noticeId: DelinquencyNoticeId,
): Promise<ClaimEvidenceRow[]> {
  const rows = await ctx.db
    .query("claimEvidence")
    .withIndex("by_notice_kind", (q) => q.eq("noticeId", noticeId))
    .order("desc")
    .take(CLAIM_EVIDENCE_HISTORY_LIMIT);
  return rows.map(shapeClaimEvidenceRow);
}

async function loadNotice(ctx: QueryCtx, publicId: string): Promise<DelinquencyNotice | null> {
  return ctx.db
    .query("guaranteeDelinquencyNotices")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
}

/**
 * Evidence can be added while the agency still owns the next move: before the
 * claim is filed, or to answer an information request. A submitted claim is
 * frozen until staff answer it.
 */
function evidenceRefusal(notice: DelinquencyNotice): ClaimEvidenceErrorCode | null {
  if (notice.status !== DELINQUENCY_STATUS.OPEN) return "NOTICE_NOT_OPEN";
  if (notice.claim?.status === CLAIM_STATUS.SUBMITTED) return "CLAIM_UNDER_REVIEW";
  return null;
}

/**
 * Staff verifying the default is what accepts the files the claim was filed
 * with; there is no separate per-file approval step.
 */
export async function acceptPendingEvidence(
  ctx: MutationCtx,
  { noticeId, at, byUserId }: { noticeId: DelinquencyNoticeId; at: string; byUserId: UserId },
): Promise<void> {
  const rows = await ctx.db
    .query("claimEvidence")
    .withIndex("by_notice_kind", (q) => q.eq("noticeId", noticeId))
    .take(CLAIM_EVIDENCE_HISTORY_LIMIT);
  for (const row of rows) {
    if (row.status !== CLAIM_EVIDENCE_STATUS.PENDING_REVIEW) continue;
    await ctx.db.patch(row._id, {
      status: CLAIM_EVIDENCE_STATUS.ACCEPTED,
      reviewedAt: at,
      reviewedByUserId: byUserId,
    });
  }
}

/** Mints an upload URL only for a notice the caller may still add evidence to. */
export const generateClaimEvidenceUploadUrl = mutation({
  args: { noticePublicId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<{ url: string }, { code: ClaimEvidenceErrorCode }>> => {
    const notice = await loadNotice(ctx, args.noticePublicId);
    if (!notice) {
      return { success: false, error: { code: "NOTICE_NOT_FOUND" }, message: "Notice not found" };
    }
    await assertActiveAgencyAccess(ctx, notice.agencyId);
    const refusal = evidenceRefusal(notice);
    if (refusal) {
      return { success: false, error: { code: refusal }, message: "Evidence is locked" };
    }
    const url = await ctx.storage.generateUploadUrl();
    return { success: true, data: { url }, message: "Upload URL minted" };
  },
});

/**
 * Records one uploaded file as evidence for a notice. As with guarantee
 * documents, the file is judged by its `_storage` row, a refused file is left
 * in storage, and an earlier pending file of the same kind is superseded.
 * Answering an information request about this kind marks that request
 * resolved in the same write.
 */
export const attachClaimEvidence = mutation({
  args: {
    noticePublicId: v.string(),
    kind: claimEvidenceKindValidator,
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<{ evidenceId: Id<"claimEvidence"> }, { code: ClaimEvidenceErrorCode }>> => {
    const notice = await loadNotice(ctx, args.noticePublicId);
    if (!notice) {
      return { success: false, error: { code: "NOTICE_NOT_FOUND" }, message: "Notice not found" };
    }
    const membership = await assertActiveAgencyAccess(ctx, notice.agencyId);
    const refusal = evidenceRefusal(notice);
    if (refusal) {
      return { success: false, error: { code: refusal }, message: "Evidence is locked" };
    }

    const alreadyAttached = await ctx.db
      .query("claimEvidence")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    if (alreadyAttached) {
      return {
        success: false,
        error: { code: "FILE_ALREADY_ATTACHED" },
        message: "This file is already attached",
      };
    }

    const blob = await ctx.db.system.get(args.storageId);
    if (!blob) {
      return {
        success: false,
        error: { code: "FILE_NOT_FOUND" },
        message: "Uploaded file not found",
      };
    }
    const checked = checkUploadedFile({
      contentType: blob.contentType,
      sizeBytes: blob.size,
      fileName: args.fileName,
    });
    if (!checked.success) {
      return { success: false, error: checked.error, message: checked.message };
    }

    const sameKind = await ctx.db
      .query("claimEvidence")
      .withIndex("by_notice_kind", (q) => q.eq("noticeId", notice._id).eq("kind", args.kind))
      .take(CLAIM_EVIDENCE_HISTORY_LIMIT);
    for (const row of sameKind) {
      if (row.status === CLAIM_EVIDENCE_STATUS.PENDING_REVIEW) {
        await ctx.db.patch(row._id, { status: CLAIM_EVIDENCE_STATUS.SUPERSEDED });
      }
    }

    const uploadedAt = new Date().toISOString();
    const evidenceId = await ctx.db.insert("claimEvidence", {
      noticeId: notice._id,
      guaranteeId: notice.guaranteeId,
      agencyId: notice.agencyId,
      kind: args.kind,
      storageId: args.storageId,
      fileName: checked.data.fileName,
      contentType: checked.data.contentType,
      sizeBytes: blob.size,
      uploadedByUserId: membership.userId,
      uploadedAt,
      status: CLAIM_EVIDENCE_STATUS.PENDING_REVIEW,
    });

    if (notice.claim) {
      await ctx.db.patch(notice._id, {
        claim: {
          ...notice.claim,
          requests: notice.claim.requests.map((request) =>
            request.evidenceKind === args.kind && request.resolvedAt === undefined
              ? { ...request, resolvedAt: uploadedAt }
              : request,
          ),
        },
      });
    }

    // File name stays out of the hash-chained log: it often carries the
    // tenant's name, and audit entries can never be erased.
    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: membership.userId },
      action: AUDIT_ACTION.DELINQUENCY_EVIDENCE_ATTACHED,
      resourceType: "guaranteeDelinquencyNotices",
      resourceId: notice.publicId,
      payload: {
        evidenceId,
        noticeId: notice._id,
        kind: args.kind,
        contentType: checked.data.contentType,
        sizeBytes: blob.size,
      },
    });

    return { success: true, data: { evidenceId }, message: "Evidence attached" };
  },
});

/**
 * Resource-by-id read. Null on not-found and on another agency's notice alike,
 * so cross-agency existence never leaks.
 */
export const listClaimEvidence = query({
  args: { noticePublicId: v.string() },
  handler: async (ctx, args): Promise<ClaimEvidenceRow[] | null> => {
    const notice = await loadNotice(ctx, args.noticePublicId);
    if (!notice) return null;
    try {
      await assertAgencyAccess(ctx, notice.agencyId);
    } catch {
      return null;
    }
    return listEvidenceForNotice(ctx, notice._id);
  },
});

/** Signed download URL for one evidence file, or null when missing or not the caller's. */
export const getClaimEvidenceUrl = query({
  args: { evidenceId: v.id("claimEvidence") },
  handler: async (ctx, args): Promise<string | null> => {
    const row = await ctx.db.get(args.evidenceId);
    if (!row) return null;
    try {
      await assertAgencyAccess(ctx, row.agencyId);
    } catch {
      return null;
    }
    return ctx.storage.getUrl(row.storageId);
  },
});

/** Staff view of the same file, for the claim review in the defaults queue. */
export const staffGetClaimEvidenceUrl = queryWithMutavRole({ minRole: "compliance" })({
  args: { evidenceId: v.id("claimEvidence") },
  handler: async (ctx, args): Promise<string | null> => {
    const row = await ctx.db.get(args.evidenceId);
    return row ? ctx.storage.getUrl(row.storageId) : null;
  },
});
