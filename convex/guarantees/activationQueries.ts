import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { queryWithMutavRole } from "../lib/auth";
import { ONBOARDING_STATE } from "../agencies/domain";
import { agencySubmittedTenant } from "./tenantIdentity";
import { shapeGuaranteeReview } from "./useCases";
import {
  DOCUMENT_KEY,
  GUARANTEE_STATE,
  signedContractStatus,
  type Guarantee,
  type SignedContractStatus,
} from "./domain";
import { activationBlockers, REVIEW_STATUS, type ActivationBlocker } from "./review";

/**
 * Staff reads behind the admin activation screens: the drafts that are ready
 * (or nearly ready) to go on risk, and everything compliance needs on one page
 * to decide to activate one. Gated at `compliance`, the rung `staffActivate`
 * itself requires.
 */

const MAX_ACTIVATION_QUEUE_ROWS = 100;
const MAX_ACTIVATION_HISTORY_ROWS = 50;

export const activationQueueReviewValidator = v.union(
  v.literal(REVIEW_STATUS.SIGNED),
  v.literal(REVIEW_STATUS.AWAITING_SIGNATURE),
);

async function rentalContractStatus(
  ctx: QueryCtx,
  guarantee: Guarantee,
): Promise<SignedContractStatus> {
  const rentalContracts = await ctx.db
    .query("guaranteeDocuments")
    .withIndex("by_guarantee_key", (q) =>
      q.eq("guaranteeId", guarantee._id).eq("key", DOCUMENT_KEY.RENTAL_CONTRACT),
    )
    .order("desc")
    .collect();
  return signedContractStatus(rentalContracts);
}

export type ActivationQueueRow = {
  publicId: string;
  agencyName: string;
  agencyActive: boolean;
  tenantName: string | null;
  rentCents: number;
  feeRateBps: number;
  review: Guarantee["underwriting"]["review"];
  sentForSignatureAt: string | null;
  signedContract: SignedContractStatus;
  blockers: ActivationBlocker[];
};

async function shapeActivationQueueRow(
  ctx: QueryCtx,
  guarantee: Guarantee,
): Promise<ActivationQueueRow> {
  const agency = await ctx.db.get(guarantee.agencyId);
  if (!agency) throw new Error(`Guarantee ${guarantee.publicId} references a missing agency`);
  const tenant = await agencySubmittedTenant(ctx, guarantee);
  const signedContract = await rentalContractStatus(ctx, guarantee);
  const agencyActive = agency.onboardingState === ONBOARDING_STATE.ACTIVE;
  return {
    publicId: guarantee.publicId,
    agencyName: agency.name,
    agencyActive,
    tenantName: tenant?.fullName ?? null,
    rentCents: guarantee.terms.rentCents,
    feeRateBps: guarantee.terms.feeRateBps,
    review: guarantee.underwriting.review,
    sentForSignatureAt: guarantee.underwriting.signatureRequest?.sentAt ?? null,
    signedContract,
    blockers: activationBlockers({
      status: guarantee.status,
      review: guarantee.underwriting.review,
      signedContractApproved: signedContract === "approved",
      agencyActive,
    }),
  };
}

/**
 * Drafts across every agency at one late review stage: `signed` (ready to
 * activate once the remaining preconditions hold) or `awaiting_signature`
 * (contract out with the tenant). Reuses the underwriting queue's index,
 * pinned to `drafted`, so an activated or canceled guarantee drops out.
 */
export const listActivationQueue = queryWithMutavRole({ minRole: "compliance" })({
  args: { review: activationQueueReviewValidator },
  handler: async (ctx, args): Promise<{ rows: ActivationQueueRow[]; hasMore: boolean }> => {
    const page = await ctx.db
      .query("guarantees")
      .withIndex("by_review_status_requestedAt", (q) =>
        q.eq("underwriting.review", args.review).eq("status", GUARANTEE_STATE.DRAFTED),
      )
      .order("asc")
      .take(MAX_ACTIVATION_QUEUE_ROWS + 1);
    const rows = page.slice(0, MAX_ACTIVATION_QUEUE_ROWS);
    return {
      rows: await Promise.all(rows.map((row) => shapeActivationQueueRow(ctx, row))),
      hasMore: page.length > MAX_ACTIVATION_QUEUE_ROWS,
    };
  },
});

/**
 * One guarantee as the activation page shows it. `null` for an unknown or
 * ambiguous publicId. `blockers` is the same list `staffActivate` checks, so
 * the console can say why the Activate button is disabled.
 */
export const getActivationDetail = queryWithMutavRole({ minRole: "compliance" })({
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
    const signedContract = await rentalContractStatus(ctx, guarantee);
    const agencyActive = agency.onboardingState === ONBOARDING_STATE.ACTIVE;

    const history = await ctx.db
      .query("guaranteeHistory")
      .withIndex("by_agency_guarantee", (q) =>
        q.eq("agencyId", guarantee.agencyId).eq("guaranteePublicId", guarantee.publicId),
      )
      .order("desc")
      .take(MAX_ACTIVATION_HISTORY_ROWS);

    return {
      publicId: guarantee.publicId,
      status: guarantee.status,
      activatedAt: guarantee.activatedAt,
      closure: guarantee.closure ?? null,
      agency: { name: agency.name, active: agencyActive },
      tenant: tenant ? { fullName: tenant.fullName, entityType: tenant.entityType } : null,
      lease: { propertyKind: lease.propertyKind, property: lease.property, rent: lease.rent },
      terms: guarantee.terms,
      capacity: guarantee.capacity,
      review: shapeGuaranteeReview(guarantee.underwriting),
      signedContract,
      blockers: activationBlockers({
        status: guarantee.status,
        review: guarantee.underwriting.review,
        signedContractApproved: signedContract === "approved",
        agencyActive,
      }),
      history: history.map((entry) => ({
        at: entry.at,
        username: entry.username,
        message: entry.message,
      })),
    };
  },
});
