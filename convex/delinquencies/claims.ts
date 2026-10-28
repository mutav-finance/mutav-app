import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import { assertActiveAgencyAccess, mutationWithMutavRole } from "../lib/auth";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { isSignedContractApproved, type Guarantee } from "../guarantees/domain";
import {
  CLAIM_DECLARATION_VERSION,
  CLAIM_EVIDENCE_STATUS,
  CLAIM_RULES_DEFAULT,
  CLAIM_STATUS,
  DELINQUENCY_STATUS,
  brazilToday,
  claimEvidenceKindValidator,
  claimableFromDate,
  missingClaimRequirements,
  type ClaimRequirement,
  type ClaimRules,
  type DelinquencyNotice,
} from "./domain";
import { listEvidenceForNotice } from "./claimEvidence";

const CLAIM_REQUEST_REASON_MAX_LENGTH = 1000;
const GUARANTEE_DOCUMENT_SCAN_LIMIT = 100;
const CLAIM_EVIDENCE_SCAN_LIMIT = 50;

async function loadNotice(ctx: QueryCtx, publicId: string): Promise<DelinquencyNotice | null> {
  return ctx.db
    .query("guaranteeDelinquencyNotices")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
}

async function loadGuarantee(ctx: QueryCtx, notice: DelinquencyNotice): Promise<Guarantee> {
  const guarantee = await ctx.db.get(notice.guaranteeId);
  if (!guarantee) {
    throw new Error(`Delinquency notice ${notice.publicId} references a missing guarantees row`);
  }
  return guarantee;
}

/** The product's claim rules, or the placeholder defaults when it sets none. */
export async function claimRulesFor(ctx: QueryCtx, guarantee: Guarantee): Promise<ClaimRules> {
  const product = await ctx.db.get(guarantee.productId);
  return product?.claimRules ?? CLAIM_RULES_DEFAULT;
}

/**
 * Everything the claim screen and `submitClaim` need to agree on: when the
 * claim opens and what is still missing. One function so the UI's "Falta: …"
 * line and the mutation's refusal can never disagree.
 */
export async function claimReadiness(
  ctx: QueryCtx,
  notice: DelinquencyNotice,
): Promise<{ claimableFrom: string; missing: ClaimRequirement[] }> {
  const guarantee = await loadGuarantee(ctx, notice);
  const rules = await claimRulesFor(ctx, guarantee);
  const evidence = await listEvidenceForNotice(ctx, notice._id);
  const documents = await ctx.db
    .query("guaranteeDocuments")
    .withIndex("by_guarantee", (q) => q.eq("guaranteeId", guarantee._id))
    .take(GUARANTEE_DOCUMENT_SCAN_LIMIT);
  return {
    claimableFrom: claimableFromDate({ rentDueDate: notice.rentDueDate, rules }),
    missing: missingClaimRequirements({
      evidence,
      signedContractApproved: isSignedContractApproved(documents),
    }),
  };
}

function historyRow(notice: DelinquencyNotice, guarantee: Guarantee, username: string) {
  return {
    agencyId: notice.agencyId,
    guaranteePublicId: guarantee.publicId,
    at: new Date().toISOString(),
    username,
  };
}

// ---------------------------------------------------------------------------
// submitClaim — the agency asks the reserve to pay
// ---------------------------------------------------------------------------

type SubmitClaimError = {
  code:
    | "NOTICE_NOT_FOUND"
    | "NOTICE_NOT_OPEN"
    | "CLAIM_ALREADY_SUBMITTED"
    | "CLAIM_NOT_YET_OPEN"
    | "CLAIM_REQUIREMENTS_MISSING"
    | "INVALID_AMOUNT";
  missing?: ClaimRequirement[];
};

export const submitClaim = mutation({
  args: {
    noticePublicId: v.string(),
    claimedAmountCents: v.number(),
    // The agency member's attestation that the rent went unpaid. A literal
    // `true` so an unchecked box cannot reach the server as a claim.
    declarationAccepted: v.literal(true),
  },
  handler: async (ctx, args): Promise<Result<{ publicId: string }, SubmitClaimError>> => {
    const notice = await loadNotice(ctx, args.noticePublicId);
    if (!notice) {
      return { success: false, error: { code: "NOTICE_NOT_FOUND" }, message: "Notice not found" };
    }
    const membership = await assertActiveAgencyAccess(ctx, notice.agencyId);

    if (notice.status !== DELINQUENCY_STATUS.OPEN) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_OPEN" },
        message: `Notice '${notice.publicId}' is '${notice.status}'.`,
      };
    }
    if (notice.claim) {
      return {
        success: false,
        error: { code: "CLAIM_ALREADY_SUBMITTED" },
        message: `Notice '${notice.publicId}' already carries a claim.`,
      };
    }
    if (
      !Number.isInteger(args.claimedAmountCents) ||
      args.claimedAmountCents <= 0 ||
      args.claimedAmountCents > notice.originalAmountCents
    ) {
      return {
        success: false,
        error: { code: "INVALID_AMOUNT" },
        message: "The claimed amount must be positive and at most the reported amount.",
      };
    }

    const readiness = await claimReadiness(ctx, notice);
    if (brazilToday(Date.now()) < readiness.claimableFrom) {
      return {
        success: false,
        error: { code: "CLAIM_NOT_YET_OPEN" },
        message: `The claim for this rent opens on ${readiness.claimableFrom}.`,
      };
    }
    if (readiness.missing.length > 0) {
      return {
        success: false,
        error: { code: "CLAIM_REQUIREMENTS_MISSING", missing: readiness.missing },
        message: `Missing: ${readiness.missing.join(", ")}.`,
      };
    }

    const submittedAt = new Date().toISOString();
    await ctx.db.patch(notice._id, {
      claim: {
        status: CLAIM_STATUS.SUBMITTED,
        claimedAmountCents: args.claimedAmountCents,
        submittedAt,
        submittedByUserId: membership.userId,
        declarationVersion: CLAIM_DECLARATION_VERSION,
        requests: [],
      },
    });

    const guarantee = await loadGuarantee(ctx, notice);
    const user = await ctx.db.get(membership.userId);
    await ctx.db.insert("guaranteeHistory", {
      ...historyRow(notice, guarantee, user?.name ?? ""),
      message: "Garantia acionada",
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: membership.userId },
      action: AUDIT_ACTION.DELINQUENCY_CLAIM_SUBMITTED,
      resourceType: "guaranteeDelinquencyNotices",
      resourceId: notice.publicId,
      payload: {
        noticeId: notice._id,
        guaranteeId: notice.guaranteeId,
        agencyId: notice.agencyId,
        claimedAmountCents: args.claimedAmountCents,
        declarationVersion: CLAIM_DECLARATION_VERSION,
        submittedAt,
      },
    });

    return { success: true, data: { publicId: notice.publicId }, message: "Claim submitted" };
  },
});

// ---------------------------------------------------------------------------
// resubmitClaim — the agency answered every information request
// ---------------------------------------------------------------------------

type ResubmitClaimError = {
  code: "NOTICE_NOT_FOUND" | "NO_INFO_REQUESTED" | "REQUESTS_UNRESOLVED";
};

export const resubmitClaim = mutation({
  args: { noticePublicId: v.string() },
  handler: async (ctx, args): Promise<Result<{ publicId: string }, ResubmitClaimError>> => {
    const notice = await loadNotice(ctx, args.noticePublicId);
    if (!notice) {
      return { success: false, error: { code: "NOTICE_NOT_FOUND" }, message: "Notice not found" };
    }
    const membership = await assertActiveAgencyAccess(ctx, notice.agencyId);

    const claim = notice.claim;
    if (
      notice.status !== DELINQUENCY_STATUS.OPEN ||
      claim?.status !== CLAIM_STATUS.INFO_REQUESTED
    ) {
      return {
        success: false,
        error: { code: "NO_INFO_REQUESTED" },
        message: "This claim is not waiting on the agency.",
      };
    }
    if (claim.requests.some((request) => request.resolvedAt === undefined)) {
      return {
        success: false,
        error: { code: "REQUESTS_UNRESOLVED" },
        message: "Answer every request before sending the claim back.",
      };
    }

    await ctx.db.patch(notice._id, { claim: { ...claim, status: CLAIM_STATUS.SUBMITTED } });

    const guarantee = await loadGuarantee(ctx, notice);
    const user = await ctx.db.get(membership.userId);
    await ctx.db.insert("guaranteeHistory", {
      ...historyRow(notice, guarantee, user?.name ?? ""),
      message: "Acionamento reenviado para análise",
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: membership.userId },
      action: AUDIT_ACTION.DELINQUENCY_CLAIM_RESUBMITTED,
      resourceType: "guaranteeDelinquencyNotices",
      resourceId: notice.publicId,
      payload: { noticeId: notice._id, guaranteeId: notice.guaranteeId, agencyId: notice.agencyId },
    });

    return { success: true, data: { publicId: notice.publicId }, message: "Claim resubmitted" };
  },
});

// ---------------------------------------------------------------------------
// staffRequestClaimInfo — staff ask for specific files again
// ---------------------------------------------------------------------------

type RequestClaimInfoError = {
  code:
    | "NOTICE_NOT_FOUND"
    | "CLAIM_NOT_SUBMITTED"
    | "NO_REQUESTS"
    | "REASON_REQUIRED"
    | "REASON_TOO_LONG"
    | "INVALID_DUE_DATE";
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Only before verification: once staff confirm the default they have accepted
 * the evidence. Each named kind's live file is rejected with its reason, and
 * the agency answers by uploading a replacement, which resolves the request.
 */
export const staffRequestClaimInfo = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    noticePublicId: v.string(),
    requests: v.array(v.object({ evidenceKind: claimEvidenceKindValidator, reason: v.string() })),
    // `YYYY-MM-DD` the agency has to answer by.
    dueAt: v.string(),
  },
  handler: async (ctx, args): Promise<Result<{ publicId: string }, RequestClaimInfoError>> => {
    const notice = await loadNotice(ctx, args.noticePublicId);
    if (!notice) {
      return { success: false, error: { code: "NOTICE_NOT_FOUND" }, message: "Notice not found" };
    }
    const claim = notice.claim;
    if (notice.status !== DELINQUENCY_STATUS.OPEN || claim?.status !== CLAIM_STATUS.SUBMITTED) {
      return {
        success: false,
        error: { code: "CLAIM_NOT_SUBMITTED" },
        message: "Only a submitted, unverified claim can be sent back to the agency.",
      };
    }
    if (args.requests.length === 0) {
      return { success: false, error: { code: "NO_REQUESTS" }, message: "Name at least one file." };
    }
    if (args.requests.some((request) => request.reason.trim().length === 0)) {
      return {
        success: false,
        error: { code: "REASON_REQUIRED" },
        message: "Every request needs a reason.",
      };
    }
    if (args.requests.some((request) => request.reason.length > CLAIM_REQUEST_REASON_MAX_LENGTH)) {
      return {
        success: false,
        error: { code: "REASON_TOO_LONG" },
        message: "A reason is too long.",
      };
    }
    if (!ISO_DATE_PATTERN.test(args.dueAt) || args.dueAt <= brazilToday(Date.now())) {
      return {
        success: false,
        error: { code: "INVALID_DUE_DATE" },
        message: "The deadline must be a future YYYY-MM-DD date.",
      };
    }

    const requestedAt = new Date().toISOString();
    const evidence = await ctx.db
      .query("claimEvidence")
      .withIndex("by_notice_kind", (q) => q.eq("noticeId", notice._id))
      .take(CLAIM_EVIDENCE_SCAN_LIMIT);
    for (const request of args.requests) {
      for (const row of evidence) {
        if (row.kind !== request.evidenceKind) continue;
        if (row.status !== CLAIM_EVIDENCE_STATUS.PENDING_REVIEW) continue;
        await ctx.db.patch(row._id, {
          status: CLAIM_EVIDENCE_STATUS.REJECTED,
          rejectionReason: request.reason.trim(),
          reviewedAt: requestedAt,
          reviewedByUserId: ctx.user._id,
        });
      }
    }

    await ctx.db.patch(notice._id, {
      claim: {
        ...claim,
        status: CLAIM_STATUS.INFO_REQUESTED,
        requests: [
          ...claim.requests,
          ...args.requests.map((request, index) => ({
            id: `${requestedAt}-${index}`,
            evidenceKind: request.evidenceKind,
            reason: request.reason.trim(),
            dueAt: args.dueAt,
            requestedAt,
            requestedByUserId: ctx.user._id,
          })),
        ],
      },
    });

    const guarantee = await loadGuarantee(ctx, notice);
    await ctx.db.insert("guaranteeHistory", {
      ...historyRow(notice, guarantee, "Análise MUTAV"),
      message: "Pendência no acionamento",
    });

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.DELINQUENCY_CLAIM_INFO_REQUESTED,
      resourceType: "guaranteeDelinquencyNotices",
      resourceId: notice.publicId,
      payload: {
        noticeId: notice._id,
        guaranteeId: notice.guaranteeId,
        agencyId: notice.agencyId,
        evidenceKinds: args.requests.map((request) => request.evidenceKind),
        dueAt: args.dueAt,
      },
    });

    return { success: true, data: { publicId: notice.publicId }, message: "Information requested" };
  },
});
