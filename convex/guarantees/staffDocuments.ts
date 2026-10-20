import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Result } from "../lib/result";
import { mutationWithMutavRole, queryWithMutavRole } from "../lib/auth";
import { AUDIT_ACTION, type AppendAuditEntryInput } from "../audit/domain";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import {
  DOCUMENT_KEY,
  GUARANTEE_DOCUMENT_ERROR_CODE,
  GUARANTEE_DOCUMENT_MAX_REJECTION_REASON_LENGTH,
  GUARANTEE_DOCUMENT_STATUS,
  GUARANTEE_DOCUMENT_UPLOADER_KIND,
  GUARANTEE_STATE,
  documentKeyValidator,
  type Guarantee,
  type GuaranteeDocument,
  type GuaranteeDocumentId,
} from "./domain";
import {
  attachDocumentToGuarantee,
  isClosedGuarantee,
  listDocumentRowsForGuarantee,
  userNamesById,
  type AttachGuaranteeDocumentErrorResult,
  type AttachGuaranteeDocumentSuccessResult,
  type GenerateGuaranteeDocumentUploadUrlErrorResult,
  type GenerateGuaranteeDocumentUploadUrlSuccessResult,
} from "./documents";
import { assertReviewTransition, REVIEW_STATUS } from "./review";

// Role split: `support` handles the paperwork (attaches and reads documents
// for an agency that emailed them in); deciding whether a contract is
// acceptable is a compliance judgement, so review and the review queue sit
// at `compliance`. The ladder makes `admin` satisfy both.
const VIEW_AND_UPLOAD_ROLE = "support";
const REVIEW_ROLE = "compliance";

/** Oldest-first page of the review queue; the backlog is expected to stay small. */
export const PENDING_REVIEW_QUEUE_LIMIT = 100;

/**
 * Staff act across agencies with only a publicId in hand. `publicId` carries
 * no DB-level uniqueness, so on a collision the first row wins — collisions
 * exist only in reseeded demo data, where the random space is shared.
 */
async function findGuaranteeByPublicId(ctx: QueryCtx, publicId: string): Promise<Guarantee | null> {
  return ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .first();
}

function shapeStaffGuaranteeDocument(document: GuaranteeDocument, names: Map<UserId, string>) {
  return {
    id: document._id,
    key: document.key,
    fileName: document.fileName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    uploadedAt: document.uploadedAt,
    uploadedBy: {
      kind: document.uploadedBy.kind,
      name: names.get(document.uploadedBy.userId) ?? null,
    },
    reviewedAt: document.reviewedAt ?? null,
    reviewedByName: document.reviewedBy ? (names.get(document.reviewedBy) ?? null) : null,
    rejectionReason: document.rejectionReason ?? null,
  };
}

export type StaffGuaranteeDocumentRow = ReturnType<typeof shapeStaffGuaranteeDocument>;

function namedUserIds(documents: readonly GuaranteeDocument[]): UserId[] {
  return documents.flatMap((document) =>
    document.reviewedBy
      ? [document.uploadedBy.userId, document.reviewedBy]
      : [document.uploadedBy.userId],
  );
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

export const staffGenerateUploadUrl = mutationWithMutavRole({ minRole: VIEW_AND_UPLOAD_ROLE })({
  args: { publicId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    Result<
      GenerateGuaranteeDocumentUploadUrlSuccessResult,
      GenerateGuaranteeDocumentUploadUrlErrorResult
    >
  > => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) {
      return {
        success: false,
        error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.GUARANTEE_NOT_FOUND },
        message: "Guarantee not found",
      };
    }
    if (isClosedGuarantee(guarantee)) {
      return {
        success: false,
        error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.GUARANTEE_CLOSED },
        message: "Documents cannot be attached to a closed guarantee",
      };
    }
    const url = await ctx.storage.generateUploadUrl();
    return { success: true, data: { url }, message: "Upload URL minted" };
  },
});

/**
 * Staff attach a file on the agency's behalf (e.g. a contract sent by email).
 * It enters the same `pending_review` queue as an agency upload: attaching
 * and approving stay two separate acts.
 */
export const staffAttachGuaranteeDocument = mutationWithMutavRole({
  minRole: VIEW_AND_UPLOAD_ROLE,
})({
  args: {
    publicId: v.string(),
    key: documentKeyValidator,
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<AttachGuaranteeDocumentSuccessResult, AttachGuaranteeDocumentErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) {
      return {
        success: false,
        error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.GUARANTEE_NOT_FOUND },
        message: "Guarantee not found",
      };
    }
    return attachDocumentToGuarantee(ctx, {
      guarantee,
      key: args.key,
      storageId: args.storageId,
      fileName: args.fileName,
      uploadedBy: { kind: GUARANTEE_DOCUMENT_UPLOADER_KIND.STAFF, userId: ctx.user._id },
    });
  },
});

// ─── Review ──────────────────────────────────────────────────────────────────

type ReviewGuaranteeDocumentSuccessResult = {
  documentId: GuaranteeDocumentId;
  status: GuaranteeDocument["status"];
};
type ReviewGuaranteeDocumentErrorCode =
  | typeof GUARANTEE_DOCUMENT_ERROR_CODE.DOCUMENT_NOT_FOUND
  | typeof GUARANTEE_DOCUMENT_ERROR_CODE.NOT_PENDING_REVIEW;
type ApproveGuaranteeDocumentSuccessResult = ReviewGuaranteeDocumentSuccessResult & {
  /** True when this approval moved the draft's review `awaiting_signature → signed`. */
  reviewSigned: boolean;
};
type ApproveGuaranteeDocumentErrorResult = { code: ReviewGuaranteeDocumentErrorCode };
type RejectGuaranteeDocumentErrorResult = {
  code:
    | ReviewGuaranteeDocumentErrorCode
    | typeof GUARANTEE_DOCUMENT_ERROR_CODE.REJECTION_REASON_REQUIRED
    | typeof GUARANTEE_DOCUMENT_ERROR_CODE.REJECTION_REASON_TOO_LONG;
};

type LoadReviewableResult = Result<
  { document: GuaranteeDocument; guarantee: Guarantee },
  ApproveGuaranteeDocumentErrorResult
>;

/**
 * Only a `pending_review` file may be decided. A decided file is final; a
 * superseded one was replaced before review, and approving it would bless a
 * file the agency itself withdrew.
 */
async function loadReviewableDocument(
  ctx: MutationCtx,
  documentId: GuaranteeDocumentId,
): Promise<LoadReviewableResult> {
  const document = await ctx.db.get(documentId);
  if (!document) {
    return {
      success: false,
      error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.DOCUMENT_NOT_FOUND },
      message: "Document not found",
    };
  }
  const guarantee = await ctx.db.get(document.guaranteeId);
  if (!guarantee) {
    throw new Error(`Guarantee document ${documentId} references a missing guarantee`);
  }
  if (document.status !== GUARANTEE_DOCUMENT_STATUS.PENDING_REVIEW) {
    return {
      success: false,
      error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.NOT_PENDING_REVIEW },
      message: `Document is ${document.status}, not pending review`,
    };
  }
  return { success: true, data: { document, guarantee }, message: "Document reviewable" };
}

type StaffAuditAppender = (input: Omit<AppendAuditEntryInput, "actor">) => Promise<unknown>;

/**
 * Approving the signed rental contract is the moment Mutav registers the
 * signature, so a draft that was `awaiting_signature` moves to `signed` in the
 * same transaction. From any other review status nothing moves: an approval
 * while the review is still `accepted` is kept, and `staffActivate`'s
 * `REVIEW_NOT_SIGNED` precondition is what holds the draft back. Returns
 * whether the review moved.
 */
async function markReviewSignedOnContractApproval(
  ctx: MutationCtx,
  {
    guarantee,
    document,
    username,
    appendStaffAudit,
  }: {
    guarantee: Guarantee;
    document: GuaranteeDocument;
    username: string;
    appendStaffAudit: StaffAuditAppender;
  },
): Promise<boolean> {
  if (document.key !== DOCUMENT_KEY.RENTAL_CONTRACT) return false;
  if (guarantee.status !== GUARANTEE_STATE.DRAFTED) return false;
  if (guarantee.underwriting.review !== REVIEW_STATUS.AWAITING_SIGNATURE) return false;
  const move = assertReviewTransition(guarantee.underwriting.review, REVIEW_STATUS.SIGNED);
  if (!move.success) return false;

  const at = new Date().toISOString();
  await ctx.db.patch(guarantee._id, {
    underwriting: { ...guarantee.underwriting, review: REVIEW_STATUS.SIGNED },
  });
  await ctx.db.insert("guaranteeHistory", {
    agencyId: guarantee.agencyId,
    guaranteePublicId: guarantee.publicId,
    at,
    username,
    message: "Contrato assinado registrado",
  });
  await appendStaffAudit({
    action: AUDIT_ACTION.GUARANTEE_SIGNED,
    resourceType: "guarantees",
    resourceId: guarantee.publicId,
    payload: {
      guaranteeId: guarantee._id,
      agencyId: guarantee.agencyId,
      documentId: document._id,
      at,
    },
  });
  return true;
}

export const approveGuaranteeDocument = mutationWithMutavRole({ minRole: REVIEW_ROLE })({
  args: { documentId: v.id("guaranteeDocuments") },
  handler: async (
    ctx,
    args,
  ): Promise<
    Result<ApproveGuaranteeDocumentSuccessResult, ApproveGuaranteeDocumentErrorResult>
  > => {
    const loaded = await loadReviewableDocument(ctx, args.documentId);
    if (!loaded.success) return loaded;
    const { document, guarantee } = loaded.data;

    await ctx.db.patch(document._id, {
      status: GUARANTEE_DOCUMENT_STATUS.APPROVED,
      reviewedBy: ctx.user._id,
      reviewedAt: new Date().toISOString(),
    });
    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_DOCUMENT_APPROVED,
      resourceType: "guarantee",
      resourceId: guarantee.publicId,
      payload: { documentId: document._id, key: document.key },
    });

    const reviewSigned = await markReviewSignedOnContractApproval(ctx, {
      guarantee,
      document,
      username: ctx.user.name,
      appendStaffAudit: ctx.appendStaffAudit,
    });

    return {
      success: true,
      data: {
        documentId: document._id,
        status: GUARANTEE_DOCUMENT_STATUS.APPROVED,
        reviewSigned,
      },
      message: "Document approved",
    };
  },
});

/**
 * Rejects a pending file with a reason the agency sees on the guarantee page
 * and receives by email. The reason stays on the row only: it is free text
 * and the audit chain is permanent, so the audit entry links the row instead.
 */
export const rejectGuaranteeDocument = mutationWithMutavRole({ minRole: REVIEW_ROLE })({
  args: { documentId: v.id("guaranteeDocuments"), reason: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<ReviewGuaranteeDocumentSuccessResult, RejectGuaranteeDocumentErrorResult>> => {
    const reason = args.reason.trim();
    if (reason.length === 0) {
      return {
        success: false,
        error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.REJECTION_REASON_REQUIRED },
        message: "A rejection reason is required",
      };
    }
    if (reason.length > GUARANTEE_DOCUMENT_MAX_REJECTION_REASON_LENGTH) {
      return {
        success: false,
        error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.REJECTION_REASON_TOO_LONG },
        message: "Rejection reason is too long",
      };
    }

    const loaded = await loadReviewableDocument(ctx, args.documentId);
    if (!loaded.success) return loaded;
    const { document, guarantee } = loaded.data;

    await ctx.db.patch(document._id, {
      status: GUARANTEE_DOCUMENT_STATUS.REJECTED,
      reviewedBy: ctx.user._id,
      reviewedAt: new Date().toISOString(),
      rejectionReason: reason,
    });
    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_DOCUMENT_REJECTED,
      resourceType: "guarantee",
      resourceId: guarantee.publicId,
      payload: { documentId: document._id, key: document.key },
    });

    const agency = await ctx.db.get(guarantee.agencyId);
    if (agency?.email) {
      await ctx.scheduler.runAfter(0, internal.guarantees.actions.sendDocumentRejectedEmail, {
        to: agency.email,
        guaranteePublicId: guarantee.publicId,
        documentKey: document.key,
        rejectionReason: reason,
      });
    }

    return {
      success: true,
      data: { documentId: document._id, status: GUARANTEE_DOCUMENT_STATUS.REJECTED },
      message: "Document rejected",
    };
  },
});

// ─── Reads ───────────────────────────────────────────────────────────────────

export const listDocumentsForGuarantee = queryWithMutavRole({ minRole: VIEW_AND_UPLOAD_ROLE })({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return null;
    const rows = await listDocumentRowsForGuarantee(ctx, guarantee);
    const names = await userNamesById(ctx, namedUserIds(rows));
    return {
      guaranteeStatus: guarantee.status,
      documents: rows.map((row) => shapeStaffGuaranteeDocument(row, names)),
    };
  },
});

/**
 * The compliance review queue: every file still awaiting a decision across all
 * agencies, oldest upload first. `by_status` orders by creation time within a
 * status, which is upload order.
 */
export const listDocumentsPendingReview = queryWithMutavRole({ minRole: REVIEW_ROLE })({
  args: {},
  handler: async (ctx) => {
    const page = await ctx.db
      .query("guaranteeDocuments")
      .withIndex("by_status", (q) => q.eq("status", GUARANTEE_DOCUMENT_STATUS.PENDING_REVIEW))
      .order("asc")
      .take(PENDING_REVIEW_QUEUE_LIMIT + 1);
    const rows = page.slice(0, PENDING_REVIEW_QUEUE_LIMIT);

    const names = await userNamesById(ctx, namedUserIds(rows));
    const agencyIds = [...new Set(rows.map((row) => row.agencyId))];
    const agencies = await Promise.all(agencyIds.map((agencyId) => ctx.db.get(agencyId)));
    const agencyNames = new Map<AgencyId, string>();
    for (const agency of agencies) {
      if (agency) agencyNames.set(agency._id, agency.name);
    }

    const shaped = await Promise.all(
      rows.map(async (row) => {
        const guarantee = await ctx.db.get(row.guaranteeId);
        return {
          ...shapeStaffGuaranteeDocument(row, names),
          agencyName: agencyNames.get(row.agencyId) ?? null,
          guaranteePublicId: guarantee?.publicId ?? null,
          guaranteeStatus: guarantee?.status ?? null,
        };
      }),
    );

    return { rows: shaped, hasMore: page.length > PENDING_REVIEW_QUEUE_LIMIT };
  },
});

export const getStaffGuaranteeDocumentUrl = queryWithMutavRole({
  minRole: VIEW_AND_UPLOAD_ROLE,
})({
  args: { documentId: v.id("guaranteeDocuments") },
  handler: async (ctx, args): Promise<string | null> => {
    const document = await ctx.db.get(args.documentId);
    if (!document) return null;
    return ctx.storage.getUrl(document.storageId);
  },
});
