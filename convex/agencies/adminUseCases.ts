import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashPii } from "../lib/pii";
import type { Result } from "../lib/result";
import {
  AGENCY_TYPE,
  MEMBER_ROLE,
  ONBOARDING_STATE,
  canTransitionOnboarding,
  onboardingDecisionValidator,
} from "./domain";
import type { AgencyDocumentKind, AgencyId, OnboardingDecision } from "./domain";

// ─── KYC / KYB review ─────────────────────────────────────────────────────────
//
// The reusable logic lives in plain helpers (`collectPendingReviews`,
// `resolveDocumentDownloadUrl`, `applyOnboardingReview`,
// `applyStartOnboardingReview`) so it is shared by:
//   - the `internal*` functions below (tests / scheduled paths), and
//   - the staff-gated PUBLIC functions in `convex/mutavStaff/useCases.ts`.
// Convex queries cannot `runQuery` an internalQuery, so sharing is via helpers,
// not function-to-function calls. Gating (staff role) is applied by the wrapper
// at the public boundary, never here.

/** All agencies awaiting review (submitted + under_review), enriched with documents. */
export async function collectPendingReviews(ctx: QueryCtx) {
  const [submitted, underReview] = await Promise.all([
    ctx.db
      .query("agencies")
      .withIndex("by_onboardingState", (q) => q.eq("onboardingState", ONBOARDING_STATE.SUBMITTED))
      .collect(),
    ctx.db
      .query("agencies")
      .withIndex("by_onboardingState", (q) =>
        q.eq("onboardingState", ONBOARDING_STATE.UNDER_REVIEW),
      )
      .collect(),
  ]);

  const agencies = [...submitted, ...underReview];

  return Promise.all(
    agencies.map(async (agency) => {
      const documents = await ctx.db
        .query("agencyDocuments")
        .withIndex("by_agency", (q) => q.eq("agencyId", agency._id))
        .collect();
      return { ...agency, documents };
    }),
  );
}

export const getPendingReviews = internalQuery({
  args: {},
  handler: async (ctx) => collectPendingReviews(ctx),
});

/**
 * Resource-aware document URL resolver. Takes `(agencyId, kind)`, looks up the
 * OWNING `agencyDocuments` row, and only then resolves a storage URL — so a
 * staff caller can never pass an arbitrary `storageId` for a document outside
 * the agency under review. Returns null when the document doesn't exist.
 */
export async function resolveDocumentDownloadUrl(
  ctx: QueryCtx,
  { agencyId, kind }: { agencyId: AgencyId; kind: AgencyDocumentKind },
): Promise<string | null> {
  const documents = await ctx.db
    .query("agencyDocuments")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .collect();
  const match = documents.find((doc) => doc.kind === kind);
  if (!match) return null;
  return ctx.storage.getUrl(match.storageId);
}

/**
 * Raw internal URL generator — takes any `storageId` on faith. Internal-only;
 * the public path goes through `resolveDocumentDownloadUrl` (resource-aware).
 */
export const generateDocumentDownloadUrl = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => ctx.storage.getUrl(storageId),
});

type ReviewOnboardingSuccessResult = {
  agencyId: AgencyId;
  decision: OnboardingDecision;
  reviewedAt: string;
};
type ReviewOnboardingErrorResult = {
  code: "NOT_FOUND" | "NOT_REVIEWABLE" | "REJECTION_REASON_REQUIRED";
};
export type ReviewOnboardingResult = Result<
  ReviewOnboardingSuccessResult,
  ReviewOnboardingErrorResult
>;

/**
 * Approve/reject an onboarding submission. Pure logic; staff gating happens at
 * the public wrapper. Accepts agencies in `submitted` or `under_review`. A
 * rejection must carry a reason: it is what the agency reads on the rejected
 * page and in the decision email, and what they fix before resubmitting.
 * Schedules the decision email on success.
 */
export async function applyOnboardingReview(
  ctx: MutationCtx,
  {
    agencyId,
    decision,
    rejectionReason,
  }: { agencyId: AgencyId; decision: OnboardingDecision; rejectionReason?: string },
): Promise<ReviewOnboardingResult> {
  const agency = await ctx.db.get(agencyId);
  if (!agency) {
    return { success: false, error: { code: "NOT_FOUND" }, message: "Agency not found" };
  }

  const from = agency.onboardingState ?? ONBOARDING_STATE.NOT_STARTED;
  const to = decision === "approved" ? ONBOARDING_STATE.ACTIVE : ONBOARDING_STATE.REJECTED;
  if (!canTransitionOnboarding({ from, to })) {
    return {
      success: false,
      error: { code: "NOT_REVIEWABLE" },
      message: `Onboarding in state '${from}' cannot be reviewed`,
    };
  }

  const trimmedReason = rejectionReason?.trim();
  if (decision === "rejected" && !trimmedReason) {
    return {
      success: false,
      error: { code: "REJECTION_REASON_REQUIRED" },
      message: "A rejection needs a reason the agency can act on",
    };
  }

  const reviewedAt = new Date().toISOString();

  if (decision === "approved") {
    await ctx.db.patch(agencyId, {
      onboardingState: ONBOARDING_STATE.ACTIVE,
      onboardingRejectionReason: undefined,
    });
  } else {
    // Free the claimedDocuments row so the rejected document is available for a
    // fresh registration. Approved agencies retain their claim — that's what
    // blocks re-use after activation.
    const document = agency.agencyType === AGENCY_TYPE.AUTONOMO ? agency.cpf : agency.cnpj;
    if (document) {
      const documentHash = await hashPii(document);
      const claim = await ctx.db
        .query("claimedDocuments")
        .withIndex("by_documentHash", (q) => q.eq("documentHash", documentHash))
        .first();
      if (claim && claim.agencyId === agencyId) {
        await ctx.db.delete(claim._id);
      }
    }

    await ctx.db.patch(agencyId, {
      onboardingState: ONBOARDING_STATE.REJECTED,
      onboardingRejectionReason: trimmedReason,
    });
  }

  await ctx.scheduler.runAfter(0, internal.agencies.actions.sendOnboardingDecisionEmail, {
    agencyId,
    decision,
  });

  return {
    success: true,
    data: { agencyId, decision, reviewedAt },
    message: decision === "approved" ? "Onboarding approved" : "Onboarding rejected",
  };
}

export const reviewOnboarding = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    decision: onboardingDecisionValidator,
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => applyOnboardingReview(ctx, args),
});

type StartOnboardingReviewSuccessResult = { agencyId: AgencyId; alreadyUnderReview: boolean };
type StartOnboardingReviewErrorResult = { code: "NOT_FOUND" | "NOT_REVIEWABLE" };
export type StartOnboardingReviewResult = Result<
  StartOnboardingReviewSuccessResult,
  StartOnboardingReviewErrorResult
>;

/**
 * Move a submission into `under_review` so the agency's status page shows a
 * person has picked it up. Idempotent: an agency already under review returns
 * `alreadyUnderReview: true` and writes nothing, so the caller audits only a
 * real transition.
 */
export async function applyStartOnboardingReview(
  ctx: MutationCtx,
  { agencyId }: { agencyId: AgencyId },
): Promise<StartOnboardingReviewResult> {
  const agency = await ctx.db.get(agencyId);
  if (!agency) {
    return { success: false, error: { code: "NOT_FOUND" }, message: "Agency not found" };
  }

  if (agency.onboardingState === ONBOARDING_STATE.UNDER_REVIEW) {
    return {
      success: true,
      data: { agencyId, alreadyUnderReview: true },
      message: "Already under review",
    };
  }

  const from = agency.onboardingState ?? ONBOARDING_STATE.NOT_STARTED;
  if (!canTransitionOnboarding({ from, to: ONBOARDING_STATE.UNDER_REVIEW })) {
    return {
      success: false,
      error: { code: "NOT_REVIEWABLE" },
      message: `Onboarding in state '${from}' cannot enter review`,
    };
  }

  await ctx.db.patch(agencyId, { onboardingState: ONBOARDING_STATE.UNDER_REVIEW });
  return {
    success: true,
    data: { agencyId, alreadyUnderReview: false },
    message: "Review started",
  };
}

/**
 * Recipient + content for the onboarding decision email. Resolved inside the
 * action rather than passed as scheduled-function args, so the address never
 * lands on the persisted `_scheduled_functions` record or the function log.
 * Falls back to the owner's user email when the agency has no contact email.
 */
export const getOnboardingDecisionDeliveryInternal = internalQuery({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    const agency = await ctx.db.get(agencyId);
    if (!agency) return null;

    const contactEmail = agency.email?.trim() || (await findOwnerEmail(ctx, agencyId));
    if (!contactEmail) return null;

    return {
      email: contactEmail,
      agencyName: agency.name,
      onboardingState: agency.onboardingState ?? ONBOARDING_STATE.NOT_STARTED,
      rejectionReason: agency.onboardingRejectionReason ?? null,
    };
  },
});

async function findOwnerEmail(ctx: QueryCtx, agencyId: AgencyId): Promise<string | null> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .collect();
  const owner = memberships.find((membership) => membership.role === MEMBER_ROLE.OWNER);
  if (!owner) return null;
  const user = await ctx.db.get(owner.userId);
  return user?.email?.trim() || null;
}
