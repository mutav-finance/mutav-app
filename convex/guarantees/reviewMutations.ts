import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Result } from "../lib/result";
import { hashPii } from "../lib/pii";
import { mutationWithActiveAgency, mutationWithMutavRole } from "../lib/auth";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import { buildLeaseRent, ufFromCityUF } from "../leases/domain";
import { PRODUCT_ERROR_CODE } from "../products/domain";
import { resolveProduct } from "../products/useCases";
import { findFreshAssessment } from "../creditAnalysis/useCases";
import { replaceGuaranteeAggregates } from "./aggregateWrites";
import { priceGuarantee } from "./pricing";
import { agencySubmittedTenant } from "./tenantIdentity";
import { applyGuaranteeTransition, type GuaranteeTransitionError } from "./transitions";
import {
  CLOSE_REASON,
  CREDIT_ASSESSMENT_FRESHNESS_MS,
  GUARANTEE_ERROR_CODE,
  GUARANTEE_STATE,
  guaranteePlanValidator,
  tierForScore,
  type Guarantee,
  type GuaranteePlan,
  type GuaranteeTerms,
} from "./domain";
import {
  assertReviewTransition,
  isValidStaffFeeRateBps,
  MAX_REVIEW_TEXT_LENGTH,
  MAX_STAFF_FEE_RATE_BPS,
  MIN_STAFF_FEE_RATE_BPS,
  provisionalPricingTier,
  REVIEW_ERROR_CODE,
  REVIEW_STATUS,
  type ReviewStatus,
  type ReviewTransitionError,
} from "./review";

/**
 * Mutav's underwriting review of a draft (ADR 0011):
 *
 *   editing ──requestAnalysis──▶ analysis_requested ──acceptAnalysis──▶ accepted
 *      ▲ updateDraft                    │                                  │
 *      └────────────                    └─refuseAnalysis─▶ refused        sendForSignature
 *                                          (guarantee closed,              ▼ (registration.ts)
 *                                           underwriting_refused)   awaiting_signature
 *
 * The agency drafts, adjusts and asks; Mutav compliance decides. Sending for
 * signature reads the reserve (a preflight and an offer hold), so it lives
 * with the registration actions in `registration.ts` (ADR 0010).
 * Every move is gated by `assertReviewTransition` before the first write and
 * is recorded twice: a `guaranteeHistory` row for the agency timeline and a
 * hash-chained audit entry. None of these moves the lifecycle state except a
 * refusal, which closes the draft through `applyGuaranteeTransition`.
 */

type ReviewTransitionErrorCode = ReviewTransitionError["code"];

const notFound = (publicId: string) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.NOT_FOUND },
  message: `Guarantee '${publicId}' not found`,
});

const notDrafted = (guarantee: Guarantee) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.NOT_DRAFTED },
  message: `Guarantee ${guarantee.publicId} is ${guarantee.status}; the review only runs on a draft`,
});

const capacityDrift = (guarantee: Guarantee) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN },
  message: `Guarantee ${guarantee.publicId} carries ${guarantee.capacity.reservedCents} reserved cents before activation`,
});

async function findGuaranteeByPublicId(
  ctx: MutationCtx,
  publicId: string,
): Promise<Guarantee | null> {
  const rows = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .collect();
  return rows.length === 1 ? rows[0] : null;
}

/** `null` for "no such publicId" and "another agency's" alike — no existence probe. */
async function findAgencyGuarantee(
  ctx: MutationCtx,
  { publicId, agencyId }: { publicId: string; agencyId: AgencyId },
): Promise<Guarantee | null> {
  const rows = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .collect();
  const owned = rows.filter((row) => row.agencyId === agencyId);
  return owned.length === 1 ? owned[0] : null;
}

async function insertReviewHistory(
  ctx: MutationCtx,
  {
    guarantee,
    at,
    username,
    message,
  }: { guarantee: Guarantee; at: string; username: string; message: string },
): Promise<void> {
  await ctx.db.insert("guaranteeHistory", {
    agencyId: guarantee.agencyId,
    guaranteePublicId: guarantee.publicId,
    at,
    username,
    message,
  });
}

type RepriceDraftInput = {
  guarantee: Guarantee;
  rentCents: number;
  plan: GuaranteePlan;
  productSlug: string;
  at: string;
  staffFeeRateBps?: number;
};

type RepriceDraftSuccess = {
  productId: Guarantee["productId"];
  terms: GuaranteeTerms;
  capacity: Guarantee["capacity"];
};

/**
 * Re-snapshot a draft's `terms` through the same product resolution and
 * pricing `create` and `reprice` use. A draft has nothing reserved, so its
 * capacity is re-initialised from the new ceiling; `confirmRegistration` reads the
 * ceiling from `terms` again when it goes on risk.
 */
async function repriceDraft(
  ctx: MutationCtx,
  input: RepriceDraftInput,
): Promise<Result<RepriceDraftSuccess, { code: typeof PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE }>> {
  const lease = await ctx.db.get(input.guarantee.leaseId);
  if (!lease) throw new Error(`Guarantee ${input.guarantee.publicId} points at a missing lease`);

  const tier = provisionalPricingTier(input.guarantee.underwriting.tier);
  const productResult = await resolveProduct(ctx, {
    agencyId: input.guarantee.agencyId,
    uf: ufFromCityUF(lease.property.cityUF),
    tier,
    propertyKind: lease.propertyKind,
    requestedSlug: input.productSlug,
    at: input.at,
  });
  if (!productResult.success) {
    return {
      success: false,
      error: { code: PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE },
      message: productResult.message,
    };
  }
  const product = productResult.data.product;
  const priced = priceGuarantee(
    {
      rentCents: input.rentCents,
      tier,
      plan: input.plan,
      productSlug: product.slug,
      appliedAt: input.at,
      ...(input.staffFeeRateBps === undefined ? {} : { staffFeeRateBps: input.staffFeeRateBps }),
    },
    product.terms,
  );
  return {
    success: true,
    data: { productId: product._id, terms: priced.terms, capacity: priced.capacity },
    message: `Draft priced under ${product.slug}`,
  };
}

/**
 * Who hears about a decision: the agency's registered address and the member
 * who asked for the analysis. Deduplicated, blanks dropped.
 */
export async function decisionRecipients(
  ctx: MutationCtx,
  guarantee: Guarantee,
): Promise<string[]> {
  const agency = await ctx.db.get(guarantee.agencyId);
  const requesterId = guarantee.underwriting.analysisRequest?.requestedBy;
  const requester = requesterId ? await ctx.db.get(requesterId) : null;
  const addresses = [agency?.email, requester?.email]
    .map((address) => address?.trim() ?? "")
    .filter((address) => address.length > 0);
  return [...new Set(addresses)];
}

function userActor(user: { _id: UserId }) {
  return { kind: "user" as const, userId: user._id };
}

// ---------------------------------------------------------------------------
// updateDraft — agency, editing only
// ---------------------------------------------------------------------------

type UpdateDraftSuccessResult = { publicId: string; terms: GuaranteeTerms };
type UpdateDraftErrorResult = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_FOUND
    | typeof GUARANTEE_ERROR_CODE.NOT_DRAFTED
    | typeof REVIEW_ERROR_CODE.NOT_EDITING
    | typeof GUARANTEE_ERROR_CODE.INVALID_RENT
    | typeof GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN
    | typeof PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE;
};

/**
 * Adjust a draft before asking Mutav to analyse it: plan, product, rent. The
 * rent moves on the lease too, so the lease and the snapshot never disagree.
 * Once analysis is requested the draft is frozen — Mutav decides on the terms
 * it was shown.
 */
export const updateDraft = mutationWithActiveAgency({
  args: {
    publicId: v.string(),
    plan: v.optional(guaranteePlanValidator),
    productSlug: v.optional(v.string()),
    rentCents: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Result<UpdateDraftSuccessResult, UpdateDraftErrorResult>> => {
    const guarantee = await findAgencyGuarantee(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
    if (!guarantee) return notFound(args.publicId);
    if (guarantee.status !== GUARANTEE_STATE.DRAFTED) return notDrafted(guarantee);
    if (guarantee.underwriting.review !== REVIEW_STATUS.EDITING) {
      return {
        success: false,
        error: { code: REVIEW_ERROR_CODE.NOT_EDITING },
        message: `Guarantee ${guarantee.publicId} is in review (${guarantee.underwriting.review}); it can no longer be edited`,
      };
    }
    const rentCents = args.rentCents ?? guarantee.terms.rentCents;
    if (!Number.isInteger(rentCents) || rentCents <= 0) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.INVALID_RENT },
        message: "Rent must be a positive integer number of cents",
      };
    }
    if (guarantee.capacity.reservedCents !== 0) return capacityDrift(guarantee);

    const at = new Date().toISOString();
    const repriced = await repriceDraft(ctx, {
      guarantee,
      rentCents,
      plan: args.plan ?? guarantee.terms.plan,
      productSlug: args.productSlug ?? guarantee.terms.productSlug,
      at,
    });
    if (!repriced.success) {
      return { success: false, error: { code: repriced.error.code }, message: repriced.message };
    }

    await ctx.db.patch(guarantee._id, repriced.data);
    const after = await ctx.db.get(guarantee._id);
    if (!after) throw new Error("Guarantee row vanished mid-transaction");
    await replaceGuaranteeAggregates(ctx, guarantee, after);

    if (rentCents !== guarantee.terms.rentCents) {
      const lease = await ctx.db.get(guarantee.leaseId);
      if (!lease) throw new Error(`Guarantee ${guarantee.publicId} points at a missing lease`);
      await ctx.db.patch(lease._id, {
        rent: buildLeaseRent({
          rentCents,
          condoCents: lease.rent.condoCents,
          otherFeesCents: lease.rent.otherFeesCents,
        }),
      });
    }

    await insertReviewHistory(ctx, {
      guarantee,
      at,
      username: ctx.user.name,
      message: "Proposta atualizada",
    });
    await appendAuditEntry(ctx, {
      actor: userActor(ctx.user),
      action: AUDIT_ACTION.GUARANTEE_DRAFT_UPDATED,
      resourceType: "guarantees",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        agencyId: guarantee.agencyId,
        previousTerms: guarantee.terms,
        terms: repriced.data.terms,
        capacity: repriced.data.capacity,
      },
    });

    return {
      success: true,
      data: { publicId: guarantee.publicId, terms: repriced.data.terms },
      message: `Draft ${guarantee.publicId} updated`,
    };
  },
});

// ---------------------------------------------------------------------------
// requestAnalysis — agency, editing → analysis_requested
// ---------------------------------------------------------------------------

type RequestAnalysisSuccessResult = { publicId: string; review: ReviewStatus };
type RequestAnalysisErrorResult = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_FOUND
    | typeof GUARANTEE_ERROR_CODE.NOT_DRAFTED
    | typeof REVIEW_ERROR_CODE.NOT_EDITING
    | typeof GUARANTEE_ERROR_CODE.CREDIT_ASSESSMENT_REQUIRED;
};

/**
 * Hand the draft to Mutav. The score Mutav reviews is re-read from the
 * freshest assessment this agency pulled on the tenant, never the one frozen
 * at creation: a draft can sit for days, and compliance must decide on a
 * score that is still current. No fresh assessment, no request.
 */
export const requestAnalysis = mutationWithActiveAgency({
  args: { publicId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<RequestAnalysisSuccessResult, RequestAnalysisErrorResult>> => {
    const guarantee = await findAgencyGuarantee(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
    if (!guarantee) return notFound(args.publicId);
    if (guarantee.status !== GUARANTEE_STATE.DRAFTED) return notDrafted(guarantee);
    const move = assertReviewTransition(
      guarantee.underwriting.review,
      REVIEW_STATUS.ANALYSIS_REQUESTED,
    );
    if (!move.success) {
      return {
        success: false,
        error: { code: REVIEW_ERROR_CODE.NOT_EDITING },
        message: move.message,
      };
    }

    const tenant = await agencySubmittedTenant(ctx, guarantee);
    if (!tenant) {
      throw new Error(`Guarantee ${guarantee.publicId} has no tenant submission of its own`);
    }
    const assessment = await findFreshAssessment(ctx, {
      agencyId: guarantee.agencyId,
      subjectHash: await hashPii(tenant.taxId),
      notBefore: Date.now() - CREDIT_ASSESSMENT_FRESHNESS_MS,
    });
    if (!assessment || assessment.status !== "ok" || assessment.score == null) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.CREDIT_ASSESSMENT_REQUIRED },
        message:
          "No fresh credit assessment for this tenant; request one before asking for analysis",
      };
    }

    const at = new Date().toISOString();
    await ctx.db.patch(guarantee._id, {
      underwriting: {
        ...guarantee.underwriting,
        score: assessment.score,
        tier: tierForScore(assessment.score),
        assessmentId: assessment._id,
        review: REVIEW_STATUS.ANALYSIS_REQUESTED,
        analysisRequest: { requestedAt: at, requestedBy: ctx.user._id },
      },
    });

    await insertReviewHistory(ctx, {
      guarantee,
      at,
      username: ctx.user.name,
      message: "Análise Mutav solicitada",
    });
    await appendAuditEntry(ctx, {
      actor: userActor(ctx.user),
      action: AUDIT_ACTION.GUARANTEE_ANALYSIS_REQUESTED,
      resourceType: "guarantees",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        agencyId: guarantee.agencyId,
        assessmentId: assessment._id,
        from: move.data.from,
        to: move.data.to,
        at,
      },
    });

    return {
      success: true,
      data: { publicId: guarantee.publicId, review: REVIEW_STATUS.ANALYSIS_REQUESTED },
      message: `Analysis requested for ${guarantee.publicId}`,
    };
  },
});

// ---------------------------------------------------------------------------
// acceptAnalysis — compliance staff, analysis_requested → accepted
// ---------------------------------------------------------------------------

type AcceptAnalysisSuccessResult = { publicId: string; terms: GuaranteeTerms };
type AcceptAnalysisErrorResult = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_FOUND
    | typeof GUARANTEE_ERROR_CODE.NOT_DRAFTED
    | typeof GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN
    | typeof REVIEW_ERROR_CODE.INVALID_FEE_RATE
    | typeof REVIEW_ERROR_CODE.TEXT_TOO_LONG
    | typeof PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE
    | ReviewTransitionErrorCode;
};

/**
 * Mutav takes the contract, at a rate compliance sets. The terms are
 * re-snapshotted with that rate — it becomes `terms.feeRateBps` and drives
 * `taxaFeeCents` — while `underwriting.tier` keeps the bureau's band as the
 * input it was. The decision, the deciding staff member and the optional
 * working note are recorded on `underwriting.decision`.
 */
export const acceptAnalysis = mutationWithMutavRole({ minRole: "compliance" })({
  args: { publicId: v.string(), feeRateBps: v.number(), note: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<Result<AcceptAnalysisSuccessResult, AcceptAnalysisErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    if (guarantee.status !== GUARANTEE_STATE.DRAFTED) return notDrafted(guarantee);
    if (!isValidStaffFeeRateBps(args.feeRateBps)) {
      return {
        success: false,
        error: { code: REVIEW_ERROR_CODE.INVALID_FEE_RATE },
        message: `Fee rate must be a whole number of basis points between ${MIN_STAFF_FEE_RATE_BPS} and ${MAX_STAFF_FEE_RATE_BPS}`,
      };
    }
    const note = args.note?.trim();
    if (note !== undefined && note.length > MAX_REVIEW_TEXT_LENGTH) {
      return {
        success: false,
        error: { code: REVIEW_ERROR_CODE.TEXT_TOO_LONG },
        message: `Note exceeds ${MAX_REVIEW_TEXT_LENGTH} characters`,
      };
    }
    const move = assertReviewTransition(guarantee.underwriting.review, REVIEW_STATUS.ACCEPTED);
    if (!move.success) {
      return { success: false, error: { code: move.error.code }, message: move.message };
    }
    if (guarantee.capacity.reservedCents !== 0) return capacityDrift(guarantee);

    const at = new Date().toISOString();
    const repriced = await repriceDraft(ctx, {
      guarantee,
      rentCents: guarantee.terms.rentCents,
      plan: guarantee.terms.plan,
      productSlug: guarantee.terms.productSlug,
      at,
      staffFeeRateBps: args.feeRateBps,
    });
    if (!repriced.success) {
      return { success: false, error: { code: repriced.error.code }, message: repriced.message };
    }

    await ctx.db.patch(guarantee._id, {
      ...repriced.data,
      underwriting: {
        ...guarantee.underwriting,
        review: REVIEW_STATUS.ACCEPTED,
        decision: {
          outcome: "accepted",
          feeRateBps: args.feeRateBps,
          ...(note ? { note } : {}),
          decidedAt: at,
          decidedBy: ctx.user._id,
        },
      },
    });
    const after = await ctx.db.get(guarantee._id);
    if (!after) throw new Error("Guarantee row vanished mid-transaction");
    // The exit-cost cap feeds `insuredCentsPlatform`; a new snapshot is an
    // aggregate write even though a draft is not yet insured.
    await replaceGuaranteeAggregates(ctx, guarantee, after);

    await insertReviewHistory(ctx, {
      guarantee,
      at,
      username: ctx.user.name,
      message: "Análise Mutav aprovada",
    });
    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_ANALYSIS_ACCEPTED,
      resourceType: "guarantees",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        agencyId: guarantee.agencyId,
        assessmentId: guarantee.underwriting.assessmentId ?? null,
        bureauTier: guarantee.underwriting.tier,
        feeRateBps: args.feeRateBps,
        previousTerms: guarantee.terms,
        terms: repriced.data.terms,
        capacity: repriced.data.capacity,
        at,
      },
    });

    await ctx.scheduler.runAfter(0, internal.guarantees.actions.sendReviewDecisionNotification, {
      publicId: guarantee.publicId,
      recipients: await decisionRecipients(ctx, guarantee),
      decision: { outcome: "accepted", feeRateBps: args.feeRateBps },
    });

    return {
      success: true,
      data: { publicId: guarantee.publicId, terms: repriced.data.terms },
      message: `Analysis accepted for ${guarantee.publicId} at ${args.feeRateBps} bps`,
    };
  },
});

// ---------------------------------------------------------------------------
// refuseAnalysis — compliance staff, analysis_requested → refused + closed
// ---------------------------------------------------------------------------

type RefuseAnalysisSuccessResult = { publicId: string };
type RefuseAnalysisErrorResult = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_FOUND
    | typeof GUARANTEE_ERROR_CODE.NOT_DRAFTED
    | typeof REVIEW_ERROR_CODE.REFUSAL_REASON_REQUIRED
    | typeof REVIEW_ERROR_CODE.TEXT_TOO_LONG
    | ReviewTransitionErrorCode
    | GuaranteeTransitionError["code"];
};

/**
 * Mutav declines the contract. Final for this draft: the guarantee closes as
 * `underwriting_refused` in the same transaction, which also frees the lease
 * pointer, so the agency can start a new draft (a fresh analysis) straight
 * away. The reason is required — the agency has to explain it to the tenant.
 */
export const refuseAnalysis = mutationWithMutavRole({ minRole: "compliance" })({
  args: { publicId: v.string(), reason: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<RefuseAnalysisSuccessResult, RefuseAnalysisErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    if (guarantee.status !== GUARANTEE_STATE.DRAFTED) return notDrafted(guarantee);
    const reason = args.reason.trim();
    if (reason.length === 0) {
      return {
        success: false,
        error: { code: REVIEW_ERROR_CODE.REFUSAL_REASON_REQUIRED },
        message: "A refusal needs a reason",
      };
    }
    if (reason.length > MAX_REVIEW_TEXT_LENGTH) {
      return {
        success: false,
        error: { code: REVIEW_ERROR_CODE.TEXT_TOO_LONG },
        message: `Reason exceeds ${MAX_REVIEW_TEXT_LENGTH} characters`,
      };
    }
    const move = assertReviewTransition(guarantee.underwriting.review, REVIEW_STATUS.REFUSED);
    if (!move.success) {
      return { success: false, error: { code: move.error.code }, message: move.message };
    }

    // The transition helper refuses before its first write, so a refusal of
    // the close leaves the review untouched too.
    const closed = await applyGuaranteeTransition(ctx, {
      guarantee,
      to: GUARANTEE_STATE.CLOSED,
      closure: { reason: CLOSE_REASON.UNDERWRITING_REFUSED, note: reason },
      actor: { userId: ctx.user._id, username: ctx.user.name },
      message: "Análise Mutav recusada",
    });
    if (!closed.success) {
      return { success: false, error: { code: closed.error.code }, message: closed.message };
    }

    const at = new Date().toISOString();
    await ctx.db.patch(guarantee._id, {
      underwriting: {
        ...guarantee.underwriting,
        review: REVIEW_STATUS.REFUSED,
        decision: { outcome: "refused", reason, decidedAt: at, decidedBy: ctx.user._id },
      },
    });

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_ANALYSIS_REFUSED,
      resourceType: "guarantees",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        agencyId: guarantee.agencyId,
        assessmentId: guarantee.underwriting.assessmentId ?? null,
        bureauTier: guarantee.underwriting.tier,
        reason,
        closeReason: CLOSE_REASON.UNDERWRITING_REFUSED,
        at,
      },
    });

    await ctx.scheduler.runAfter(0, internal.guarantees.actions.sendReviewDecisionNotification, {
      publicId: guarantee.publicId,
      recipients: await decisionRecipients(ctx, guarantee),
      decision: { outcome: "refused", reason },
    });

    return {
      success: true,
      data: { publicId: guarantee.publicId },
      message: `Analysis refused for ${guarantee.publicId}; guarantee closed`,
    };
  },
});
