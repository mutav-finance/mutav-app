import { v } from "convex/values";
import { query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import type { StorageId } from "../lib/storage";
import { assertAgencyAccess, mutationWithActiveAgency } from "../lib/auth";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import {
  GUARANTEE_DOCUMENT_ERROR_CODE,
  GUARANTEE_DOCUMENT_STATUS,
  GUARANTEE_DOCUMENT_UPLOADER_KIND,
  GUARANTEE_STATE,
  DOCUMENT_KEY,
  checkUploadedFile,
  isSignedContractApproved,
  documentKeyValidator,
  type DocumentKey,
  type Guarantee,
  type GuaranteeDocument,
  type GuaranteeDocumentId,
  type GuaranteeDocumentUploader,
  type GuaranteeId,
  type UploadedFileCheckError,
} from "./domain";

// ─── Shared helpers (agency + staff surfaces) ────────────────────────────────

/** Newest-first history cap for one guarantee; a slot rarely sees more than a handful of files. */
export const GUARANTEE_DOCUMENT_HISTORY_LIMIT = 100;

export type AttachGuaranteeDocumentErrorCode =
  | typeof GUARANTEE_DOCUMENT_ERROR_CODE.GUARANTEE_NOT_FOUND
  | typeof GUARANTEE_DOCUMENT_ERROR_CODE.GUARANTEE_CLOSED
  | typeof GUARANTEE_DOCUMENT_ERROR_CODE.FILE_NOT_FOUND
  | typeof GUARANTEE_DOCUMENT_ERROR_CODE.FILE_ALREADY_ATTACHED
  | UploadedFileCheckError["code"];

export type AttachGuaranteeDocumentSuccessResult = {
  documentId: GuaranteeDocumentId;
  supersededCount: number;
};
export type AttachGuaranteeDocumentErrorResult = { code: AttachGuaranteeDocumentErrorCode };

export type GenerateGuaranteeDocumentUploadUrlSuccessResult = { url: string };
export type GenerateGuaranteeDocumentUploadUrlErrorResult = {
  code:
    | typeof GUARANTEE_DOCUMENT_ERROR_CODE.GUARANTEE_NOT_FOUND
    | typeof GUARANTEE_DOCUMENT_ERROR_CODE.GUARANTEE_CLOSED;
};

export function isClosedGuarantee(guarantee: Guarantee): boolean {
  return guarantee.status === GUARANTEE_STATE.CLOSED;
}

/**
 * `publicId` carries no DB-level uniqueness constraint, so the caller's agency
 * disambiguates: only a guarantee of that agency is ever returned.
 */
async function findGuaranteeForAgency(
  ctx: QueryCtx,
  { publicId, agencyId }: { publicId: string; agencyId: AgencyId },
): Promise<Guarantee | null> {
  const candidates = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .collect();
  return candidates.find((candidate) => candidate.agencyId === agencyId) ?? null;
}

/**
 * Records one uploaded file against a guarantee. Shared by the agency and staff
 * attach mutations; each caller has already authorized the guarantee.
 *
 * The file is judged by the `_storage` system row (size, MIME type), never by
 * what the client claimed. A refused file is left in storage rather than
 * deleted: the `storageId` arrives from the client, and deleting on its say-so
 * would let a caller destroy a blob that is not theirs. Orphans cost bytes,
 * not data.
 *
 * Earlier `pending_review` files for the same slot become `superseded` so the
 * staff queue holds only the newest one; approved and rejected rows are final
 * and kept as history.
 */
export async function attachDocumentToGuarantee(
  ctx: MutationCtx,
  {
    guarantee,
    key,
    storageId,
    fileName,
    uploadedBy,
  }: {
    guarantee: Guarantee;
    key: DocumentKey;
    storageId: StorageId;
    fileName: string;
    uploadedBy: GuaranteeDocumentUploader;
  },
): Promise<Result<AttachGuaranteeDocumentSuccessResult, AttachGuaranteeDocumentErrorResult>> {
  if (isClosedGuarantee(guarantee)) {
    return {
      success: false,
      error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.GUARANTEE_CLOSED },
      message: "Documents cannot be attached to a closed guarantee",
    };
  }

  const alreadyAttached = await ctx.db
    .query("guaranteeDocuments")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
  if (alreadyAttached) {
    return {
      success: false,
      error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.FILE_ALREADY_ATTACHED },
      message: "This file is already attached to a guarantee",
    };
  }

  const blob = await ctx.db.system.get(storageId);
  if (!blob) {
    return {
      success: false,
      error: { code: GUARANTEE_DOCUMENT_ERROR_CODE.FILE_NOT_FOUND },
      message: "Uploaded file not found",
    };
  }

  const checked = checkUploadedFile({
    contentType: blob.contentType,
    sizeBytes: blob.size,
    fileName,
  });
  if (!checked.success) {
    return { success: false, error: checked.error, message: checked.message };
  }

  const pendingForSlot = await ctx.db
    .query("guaranteeDocuments")
    .withIndex("by_guarantee_key", (q) => q.eq("guaranteeId", guarantee._id).eq("key", key))
    .collect();
  const superseded = pendingForSlot.filter(
    (document) => document.status === GUARANTEE_DOCUMENT_STATUS.PENDING_REVIEW,
  );
  for (const document of superseded) {
    await ctx.db.patch(document._id, { status: GUARANTEE_DOCUMENT_STATUS.SUPERSEDED });
  }

  const documentId = await ctx.db.insert("guaranteeDocuments", {
    guaranteeId: guarantee._id,
    agencyId: guarantee.agencyId,
    key,
    storageId,
    fileName: checked.data.fileName,
    contentType: checked.data.contentType,
    sizeBytes: blob.size,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    status: GUARANTEE_DOCUMENT_STATUS.PENDING_REVIEW,
  });

  // File name stays out of the hash-chained log: it often carries the
  // tenant's name, and audit entries can never be erased.
  await appendAuditEntry(ctx, {
    actor: { kind: "user", userId: uploadedBy.userId },
    action: AUDIT_ACTION.GUARANTEE_DOCUMENT_ATTACHED,
    resourceType: "guarantee",
    resourceId: guarantee.publicId,
    payload: {
      documentId,
      key,
      contentType: checked.data.contentType,
      sizeBytes: blob.size,
      uploaderKind: uploadedBy.kind,
      supersededDocumentIds: superseded.map((document) => document._id),
    },
  });

  return {
    success: true,
    data: { documentId, supersededCount: superseded.length },
    message: "Document attached",
  };
}

export async function listDocumentRowsForGuarantee(
  ctx: QueryCtx,
  guarantee: Guarantee,
): Promise<GuaranteeDocument[]> {
  return ctx.db
    .query("guaranteeDocuments")
    .withIndex("by_guarantee", (q) => q.eq("guaranteeId", guarantee._id))
    .order("desc")
    .take(GUARANTEE_DOCUMENT_HISTORY_LIMIT);
}

/**
 * The activation gate in one call: has staff approved a signed rental contract
 * for this guarantee? See `isSignedContractApproved` for the rule.
 */
export async function hasApprovedSignedContract(
  ctx: QueryCtx,
  guaranteeId: GuaranteeId,
): Promise<boolean> {
  const rentalContracts = await ctx.db
    .query("guaranteeDocuments")
    .withIndex("by_guarantee_key", (q) =>
      q.eq("guaranteeId", guaranteeId).eq("key", DOCUMENT_KEY.RENTAL_CONTRACT),
    )
    .collect();
  return isSignedContractApproved(rentalContracts);
}

export async function userNamesById(
  ctx: QueryCtx,
  userIds: readonly UserId[],
): Promise<Map<UserId, string>> {
  const unique = [...new Set(userIds)];
  const users = await Promise.all(unique.map((userId) => ctx.db.get(userId)));
  const names = new Map<UserId, string>();
  for (const user of users) {
    if (user) names.set(user._id, user.name);
  }
  return names;
}

/**
 * Agency-facing projection. Staff identities never reach the agency: a
 * staff upload reads as "Mutav", and the reviewer is not named. The
 * `storageId` stays server-side; downloads go through the resource-checked
 * URL query.
 */
function shapeAgencyGuaranteeDocument(document: GuaranteeDocument, names: Map<UserId, string>) {
  const uploaderName =
    document.uploadedBy.kind === GUARANTEE_DOCUMENT_UPLOADER_KIND.AGENCY_USER
      ? (names.get(document.uploadedBy.userId) ?? null)
      : null;
  return {
    id: document._id,
    key: document.key,
    fileName: document.fileName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    uploadedAt: document.uploadedAt,
    uploadedBy: { kind: document.uploadedBy.kind, name: uploaderName },
    reviewedAt: document.reviewedAt ?? null,
    rejectionReason: document.rejectionReason ?? null,
  };
}

export type AgencyGuaranteeDocumentRow = ReturnType<typeof shapeAgencyGuaranteeDocument>;

// ─── Agency surface ──────────────────────────────────────────────────────────

/**
 * Mints a File Storage upload URL for a guarantee document. Checks the
 * guarantee up front so an agency cannot use the endpoint as free storage for
 * a guarantee it does not own or that is already closed.
 */
export const generateGuaranteeDocumentUploadUrl = mutationWithActiveAgency({
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
    const guarantee = await findGuaranteeForAgency(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
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

export const attachGuaranteeDocument = mutationWithActiveAgency({
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
    const guarantee = await findGuaranteeForAgency(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
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
      uploadedBy: { kind: GUARANTEE_DOCUMENT_UPLOADER_KIND.AGENCY_USER, userId: ctx.user._id },
    });
  },
});

/**
 * Resource-by-id read: the detail route carries only the publicId. Returns
 * null on "no such guarantee" and on "not a member of the owning agency"
 * alike, so cross-agency existence never leaks.
 */
export const listGuaranteeDocuments = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .collect();

    for (const guarantee of candidates) {
      try {
        await assertAgencyAccess(ctx, guarantee.agencyId);
      } catch {
        continue;
      }
      const rows = await listDocumentRowsForGuarantee(ctx, guarantee);
      const names = await userNamesById(
        ctx,
        rows.map((row) => row.uploadedBy.userId),
      );
      return rows.map((row) => shapeAgencyGuaranteeDocument(row, names));
    }

    return null;
  },
});

/** Signed download URL for one document, or null when it is missing or not the caller's. */
export const getGuaranteeDocumentUrl = query({
  args: { documentId: v.id("guaranteeDocuments") },
  handler: async (ctx, args): Promise<string | null> => {
    const document = await ctx.db.get(args.documentId);
    if (!document) return null;
    try {
      await assertAgencyAccess(ctx, document.agencyId);
    } catch {
      return null;
    }
    return ctx.storage.getUrl(document.storageId);
  },
});
