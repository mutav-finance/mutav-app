import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import type { StorageId } from "../lib/storage";
import type { UserId } from "../users/domain";
import type { AgencyId } from "../agencies/domain";
import { AUDIT_ACTION } from "../audit/domain";
import { meetsMinRole } from "../mutavStaff/domain";
import { appendAuditEntry } from "../audit/useCases";
import {
  mutationWithAgencyScope,
  mutationWithMutavRole,
  queryWithAgencyScope,
  queryWithMutavStaff,
} from "../lib/auth";
import {
  checkSignedContractFile,
  GUARANTEE_ERROR_CODE,
  GUARANTEE_STATE,
  SIGNED_CONTRACT_UPLOADER,
  type Guarantee,
  type GuaranteeId,
  type GuaranteeState,
  type SignedContract,
  type SignedContractFileErrorCode,
  type SignedContractUploaderKind,
} from "./domain";

/**
 * The fiança contract is signed offline and its PDF is put on file against the
 * guarantee — by the agency that sold it or by Mutav staff. One row per
 * guarantee. While the guarantee is `drafted` either side may replace the file
 * (the superseded blob is deleted; the audit entry keeps its name, size and
 * sha256). Once the guarantee leaves `drafted` the file is locked. `activate`
 * refuses a draft without one (`SIGNED_CONTRACT_REQUIRED`).
 *
 * The file's type and size are read from the `_storage` system row the upload
 * endpoint wrote, never from the caller's args.
 */

type Uploader = { kind: SignedContractUploaderKind; userId: UserId; name: string };

type UploadUrlSuccessResult = { uploadUrl: string };
type UploadUrlErrorResult = {
  code: typeof GUARANTEE_ERROR_CODE.NOT_FOUND | typeof GUARANTEE_ERROR_CODE.SIGNED_CONTRACT_LOCKED;
};

type AttachSuccessResult = { publicId: string; replaced: boolean };
type AttachErrorResult = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_FOUND
    | typeof GUARANTEE_ERROR_CODE.SIGNED_CONTRACT_LOCKED
    | typeof GUARANTEE_ERROR_CODE.FILE_NOT_FOUND
    | typeof GUARANTEE_ERROR_CODE.FILE_ALREADY_ATTACHED
    | SignedContractFileErrorCode;
};

const notFound = (publicId: string) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.NOT_FOUND },
  message: `Guarantee '${publicId}' not found`,
});

const locked = (publicId: string, status: GuaranteeState) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.SIGNED_CONTRACT_LOCKED },
  message: `Guarantee '${publicId}' is ${status}; its signed contract is locked`,
});

/** `null` covers both "no such publicId" and "another agency's" — no existence probe. */
async function findAgencyGuarantee(
  ctx: QueryCtx,
  { publicId, agencyId }: { publicId: string; agencyId: AgencyId },
): Promise<Guarantee | null> {
  const rows = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .collect();
  const owned = rows.filter((row) => row.agencyId === agencyId);
  return owned.length === 1 ? owned[0] : null;
}

/** Staff act across agencies; a publicId that is not unique is refused, not guessed. */
async function findGuaranteeByPublicId(ctx: QueryCtx, publicId: string): Promise<Guarantee | null> {
  const rows = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .collect();
  return rows.length === 1 ? rows[0] : null;
}

export async function findSignedContract(
  ctx: QueryCtx,
  guaranteeId: GuaranteeId,
): Promise<SignedContract | null> {
  return ctx.db
    .query("guaranteeSignedContracts")
    .withIndex("by_guarantee", (q) => q.eq("guaranteeId", guaranteeId))
    .unique();
}

async function isReferenced(ctx: QueryCtx, storageId: StorageId): Promise<boolean> {
  const row = await ctx.db
    .query("guaranteeSignedContracts")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  return row !== null;
}

/**
 * Put `storageId` on file as the guarantee's signed contract, replacing any
 * earlier file. A refused upload's blob is deleted so it does not linger as an
 * orphan — except when another row already points at it, which this call must
 * never destroy.
 */
async function attachSignedContract(
  ctx: MutationCtx,
  {
    guarantee,
    storageId,
    fileName,
    uploader,
  }: { guarantee: Guarantee; storageId: StorageId; fileName: string; uploader: Uploader },
): Promise<Result<AttachSuccessResult, AttachErrorResult>> {
  const file = await ctx.db.system.get("_storage", storageId);
  if (!file) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.FILE_NOT_FOUND },
      message: "Uploaded file not found in storage",
    };
  }
  if (await isReferenced(ctx, storageId)) {
    return {
      success: false,
      error: { code: GUARANTEE_ERROR_CODE.FILE_ALREADY_ATTACHED },
      message: "This file is already on file for a guarantee",
    };
  }

  if (guarantee.status !== GUARANTEE_STATE.DRAFTED) {
    await ctx.storage.delete(storageId);
    return locked(guarantee.publicId, guarantee.status);
  }

  const checked = checkSignedContractFile({
    contentType: file.contentType,
    sizeBytes: file.size,
    fileName,
  });
  if (!checked.success) {
    await ctx.storage.delete(storageId);
    return { success: false, error: { code: checked.error.code }, message: checked.message };
  }

  const previous = await findSignedContract(ctx, guarantee._id);
  const row = {
    agencyId: guarantee.agencyId,
    guaranteeId: guarantee._id,
    guaranteePublicId: guarantee.publicId,
    storageId,
    fileName: checked.data.fileName,
    sizeBytes: file.size,
    sha256: file.sha256,
    uploadedAt: new Date().toISOString(),
    uploadedBy: uploader,
  };

  if (previous) {
    await ctx.storage.delete(previous.storageId);
    await ctx.db.replace(previous._id, row);
  } else {
    await ctx.db.insert("guaranteeSignedContracts", row);
  }

  await appendAuditEntry(ctx, {
    actor: { kind: "user", userId: uploader.userId },
    action: previous
      ? AUDIT_ACTION.GUARANTEE_SIGNED_CONTRACT_REPLACED
      : AUDIT_ACTION.GUARANTEE_SIGNED_CONTRACT_UPLOADED,
    resourceType: "guarantees",
    resourceId: guarantee.publicId,
    payload: {
      guaranteeId: guarantee._id,
      agencyId: guarantee.agencyId,
      uploaderKind: uploader.kind,
      file: {
        storageId,
        fileName: row.fileName,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
      },
      previous: previous
        ? {
            storageId: previous.storageId,
            fileName: previous.fileName,
            sizeBytes: previous.sizeBytes,
            sha256: previous.sha256,
            uploadedAt: previous.uploadedAt,
            uploaderKind: previous.uploadedBy.kind,
          }
        : null,
    },
  });

  return {
    success: true,
    data: { publicId: guarantee.publicId, replaced: previous !== null },
    message: previous ? "Signed contract replaced" : "Signed contract uploaded",
  };
}

async function mintUploadUrl(
  ctx: MutationCtx,
  guarantee: Guarantee,
): Promise<Result<UploadUrlSuccessResult, UploadUrlErrorResult>> {
  if (guarantee.status !== GUARANTEE_STATE.DRAFTED) {
    return locked(guarantee.publicId, guarantee.status);
  }
  const uploadUrl = await ctx.storage.generateUploadUrl();
  return { success: true, data: { uploadUrl }, message: "Upload URL minted" };
}

/**
 * What a reader sees. The agency never learns which staff member uploaded —
 * only that Mutav did; staff see the name.
 */
async function shapeSignedContract(
  ctx: QueryCtx,
  { row, revealStaffName }: { row: SignedContract; revealStaffName: boolean },
) {
  const isStaff = row.uploadedBy.kind === SIGNED_CONTRACT_UPLOADER.STAFF;
  return {
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt,
    uploadedBy: {
      kind: row.uploadedBy.kind,
      name: isStaff && !revealStaffName ? null : row.uploadedBy.name,
    },
    downloadUrl: await ctx.storage.getUrl(row.storageId),
  };
}

// ---------------------------------------------------------------------------
// Agency
// ---------------------------------------------------------------------------

export const generateUploadUrl = mutationWithAgencyScope({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<Result<UploadUrlSuccessResult, UploadUrlErrorResult>> => {
    const guarantee = await findAgencyGuarantee(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
    if (!guarantee) return notFound(args.publicId);
    return mintUploadUrl(ctx, guarantee);
  },
});

export const attach = mutationWithAgencyScope({
  args: { publicId: v.string(), storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, args): Promise<Result<AttachSuccessResult, AttachErrorResult>> => {
    const guarantee = await findAgencyGuarantee(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
    if (!guarantee) return notFound(args.publicId);
    return attachSignedContract(ctx, {
      guarantee,
      storageId: args.storageId,
      fileName: args.fileName,
      uploader: {
        kind: SIGNED_CONTRACT_UPLOADER.AGENCY,
        userId: ctx.user._id,
        name: ctx.user.name,
      },
    });
  },
});

/** `null` when the guarantee is not this agency's or nothing is on file yet. */
export const get = queryWithAgencyScope({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const guarantee = await findAgencyGuarantee(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
    if (!guarantee) return null;
    const row = await findSignedContract(ctx, guarantee._id);
    if (!row) return null;
    return shapeSignedContract(ctx, { row, revealStaffName: false });
  },
});

// ---------------------------------------------------------------------------
// Mutav staff — upload and replace on any agency's guarantee; never activate
// ---------------------------------------------------------------------------

const STAFF_UPLOAD_MIN_ROLE = "compliance";

export const staffGenerateUploadUrl = mutationWithMutavRole({ minRole: STAFF_UPLOAD_MIN_ROLE })({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<Result<UploadUrlSuccessResult, UploadUrlErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    return mintUploadUrl(ctx, guarantee);
  },
});

export const staffAttach = mutationWithMutavRole({ minRole: STAFF_UPLOAD_MIN_ROLE })({
  args: { publicId: v.string(), storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, args): Promise<Result<AttachSuccessResult, AttachErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    return attachSignedContract(ctx, {
      guarantee,
      storageId: args.storageId,
      fileName: args.fileName,
      uploader: { kind: SIGNED_CONTRACT_UPLOADER.STAFF, userId: ctx.user._id, name: ctx.user.name },
    });
  },
});

/**
 * The admin guarantee view: enough to know which guarantee this is and whether
 * its contract is on file. No tenant personal data. `viewerCanUpload` mirrors
 * the upload mutations' role gate so the UI hides what the server would refuse.
 */
export const staffGetGuarantee = queryWithMutavStaff({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return null;
    const agency = await ctx.db.get(guarantee.agencyId);
    const row = await findSignedContract(ctx, guarantee._id);
    return {
      publicId: guarantee.publicId,
      status: guarantee.status,
      agencyName: agency?.name ?? null,
      activatedAt: guarantee.activatedAt,
      rentCents: guarantee.terms.rentCents,
      coverageCeilingCents: guarantee.terms.coverageCeilingCents,
      signedContract: row ? await shapeSignedContract(ctx, { row, revealStaffName: true }) : null,
      viewerCanUpload: meetsMinRole(ctx.mutavStaffRoles, STAFF_UPLOAD_MIN_ROLE),
    };
  },
});
