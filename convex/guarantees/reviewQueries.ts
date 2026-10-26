import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { QueryCtx } from "../_generated/server";
import { queryWithMutavRole } from "../lib/auth";
import { MOCK_CREDIT_PROVIDER } from "../creditAnalysis/domain";
import type { CreditAnalysisAssessment } from "../creditAnalysis/domain";
import { latestOfferHold } from "../reserve/offerHolds";
import { offerHoldStatus } from "../reserve/registration";
import { agencySubmittedTenant } from "./tenantIdentity";
import { shapeGuaranteeReview } from "./useCases";
import { GUARANTEE_STATE, type Guarantee, type ScoreTier } from "./domain";
import { REVIEW_STATUS, type ReviewStatus } from "./review";

/**
 * Mutav's underwriting queue and the case file behind each entry. Gated at
 * `compliance`, not at any-staff: these reads put a tenant's credit score and
 * identity in front of the reader, and `support` is the KYC rung — the same
 * line `delinquencies.listOpenAdminQueue` draws. The decisions they feed
 * (`reviewMutations.ts`) are compliance-only too.
 */

export type AnalysisQueueRow = {
  publicId: string;
  agencyName: string;
  tenantName: string | null;
  rentCents: number;
  score: number;
  tier: ScoreTier;
  bureauProvider: string | null;
  isMockScore: boolean;
  requestedAt: string | null;
  provisionalFeeRateBps: number;
};

const MAX_AWAITING_DISPATCH_ROWS = 50;
const MAX_DETAIL_HISTORY_ROWS = 100;

type BureauProvenance = { provider: string | null; isMock: boolean };

async function bureauProvenance(
  ctx: QueryCtx,
  assessment: CreditAnalysisAssessment | null,
): Promise<BureauProvenance> {
  const firstSignalId = assessment?.signalIds[0];
  const signal = firstSignalId ? await ctx.db.get(firstSignalId) : null;
  const provider = signal?.provider ?? null;
  return { provider, isMock: provider === MOCK_CREDIT_PROVIDER };
}

async function assessmentOf(
  ctx: QueryCtx,
  guarantee: Guarantee,
): Promise<CreditAnalysisAssessment | null> {
  const id = guarantee.underwriting.assessmentId;
  return id ? ctx.db.get(id) : null;
}

async function shapeAnalysisQueueRow(
  ctx: QueryCtx,
  guarantee: Guarantee,
): Promise<AnalysisQueueRow> {
  const agency = await ctx.db.get(guarantee.agencyId);
  if (!agency) throw new Error(`Guarantee ${guarantee.publicId} references a missing agency`);
  const tenant = await agencySubmittedTenant(ctx, guarantee);
  const provenance = await bureauProvenance(ctx, await assessmentOf(ctx, guarantee));
  return {
    publicId: guarantee.publicId,
    agencyName: agency.name,
    tenantName: tenant?.fullName ?? null,
    rentCents: guarantee.terms.rentCents,
    score: guarantee.underwriting.score,
    tier: guarantee.underwriting.tier,
    bureauProvider: provenance.provider,
    isMockScore: provenance.isMock,
    requestedAt: guarantee.underwriting.analysisRequest?.requestedAt ?? null,
    provisionalFeeRateBps: guarantee.terms.feeRateBps,
  };
}

/**
 * Drafts awaiting Mutav's decision across every agency, oldest request first.
 * `by_review_status_requestedAt` pins both the review status and `drafted`,
 * so a draft the agency canceled while it waited never reaches the queue.
 */
export const listAnalysisQueue = queryWithMutavRole({ minRole: "compliance" })({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: AnalysisQueueRow[]; isDone: boolean; continueCursor: string }> => {
    const result = await ctx.db
      .query("guarantees")
      .withIndex("by_review_status_requestedAt", (q) =>
        q
          .eq("underwriting.review", REVIEW_STATUS.ANALYSIS_REQUESTED)
          .eq("status", GUARANTEE_STATE.DRAFTED),
      )
      .order("asc")
      .paginate(args.paginationOpts);

    return {
      page: await Promise.all(result.page.map((row) => shapeAnalysisQueueRow(ctx, row))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Accepted drafts whose contract compliance has not sent yet — the second leg
 * of the screen, so an acceptance never strands without its follow-up.
 */
export const listAwaitingDispatch = queryWithMutavRole({ minRole: "compliance" })({
  args: {},
  handler: async (ctx): Promise<AnalysisQueueRow[]> => {
    const rows = await ctx.db
      .query("guarantees")
      .withIndex("by_review_status_requestedAt", (q) =>
        q.eq("underwriting.review", REVIEW_STATUS.ACCEPTED).eq("status", GUARANTEE_STATE.DRAFTED),
      )
      .order("asc")
      .take(MAX_AWAITING_DISPATCH_ROWS);
    return Promise.all(rows.map((row) => shapeAnalysisQueueRow(ctx, row)));
  },
});

/**
 * The case file for one draft: what the agency submitted, what the bureau
 * returned (every signal behind the assessment, not just the score), the
 * terms on the table and the timeline. `null` for an unknown or ambiguous
 * publicId — staff act across agencies, so there is no membership to probe.
 */
export const getAnalysisDetail = queryWithMutavRole({ minRole: "compliance" })({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .collect();
    if (candidates.length !== 1) return null;
    const guarantee = candidates[0];

    const agency = await ctx.db.get(guarantee.agencyId);
    if (!agency) throw new Error(`Guarantee ${guarantee.publicId} references a missing agency`);
    const lease = await ctx.db.get(guarantee.leaseId);
    if (!lease) throw new Error(`Guarantee ${guarantee.publicId} references a missing lease`);
    const tenant = await agencySubmittedTenant(ctx, guarantee);

    const assessment = await assessmentOf(ctx, guarantee);
    const signals = assessment
      ? await Promise.all(assessment.signalIds.map((id) => ctx.db.get(id)))
      : [];
    const provenance = await bureauProvenance(ctx, assessment);

    const decision = guarantee.underwriting.decision;
    const decidedBy = decision ? await ctx.db.get(decision.decidedBy) : null;

    const history = await ctx.db
      .query("guaranteeHistory")
      .withIndex("by_agency_guarantee", (q) =>
        q.eq("agencyId", guarantee.agencyId).eq("guaranteePublicId", guarantee.publicId),
      )
      .order("desc")
      .take(MAX_DETAIL_HISTORY_ROWS);

    const reviewStatus: ReviewStatus = guarantee.underwriting.review;
    return {
      publicId: guarantee.publicId,
      status: guarantee.status,
      closure: guarantee.closure ?? null,
      agency: { name: agency.name },
      review: {
        ...shapeGuaranteeReview(guarantee),
        status: reviewStatus,
        decisionNote: decision?.outcome === "accepted" ? (decision.note ?? null) : null,
        decidedByName: decidedBy?.name ?? null,
        // Whether the offer still holds reserve capital: a lapsed hold is
        // what makes a re-send available (ADR 0010).
        offerHold: offerHoldStatus(await latestOfferHold(ctx, guarantee._id), Date.now()),
      },
      tenant: tenant
        ? {
            entityType: tenant.entityType,
            taxId: tenant.taxId,
            fullName: tenant.fullName,
            email: tenant.email,
            phone: tenant.phone,
          }
        : null,
      lease: {
        propertyKind: lease.propertyKind,
        property: lease.property,
        rent: lease.rent,
      },
      credit: {
        score: guarantee.underwriting.score,
        tier: guarantee.underwriting.tier,
        provider: provenance.provider,
        isMock: provenance.isMock,
        assessedAt: assessment?.assessedAt ?? null,
        assessmentStatus: assessment?.status ?? null,
        policyVersion: assessment?.policyVersion ?? null,
        signals: signals
          .filter((signal) => signal !== null)
          .map((signal) => ({
            provider: signal.provider,
            status: signal.status,
            score: signal.normalized?.score ?? null,
            scale: signal.normalized?.scale ?? null,
            pulledAt: signal.pulledAt,
          })),
      },
      terms: guarantee.terms,
      history: history.map((entry) => ({
        at: entry.at,
        username: entry.username,
        message: entry.message,
      })),
    };
  },
});
