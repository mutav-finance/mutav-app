import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashPii } from "../lib/pii";
import { AGENCY_TYPE, ONBOARDING_STATE } from "./domain";
import type { AgencyDocumentKind, AgencyId } from "./domain";

// ─── KYC / KYB review ─────────────────────────────────────────────────────────
//
// The reusable logic lives in plain helpers (`collectPendingReviews`,
// `resolveDocumentDownloadUrl`, `applyOnboardingReview`) so it is shared by:
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

export type ReviewOnboardingResult =
  | {
      success: true;
      data: { agencyId: AgencyId; decision: "approved" | "rejected"; reviewedAt: string };
    }
  | { success: false; error: { code: "NOT_FOUND" | "NOT_REVIEWABLE" } };

/**
 * Approve/reject an onboarding submission. Pure logic; staff gating happens at
 * the public wrapper. Accepts agencies in `submitted` or `under_review`.
 */
export async function applyOnboardingReview(
  ctx: MutationCtx,
  {
    agencyId,
    decision,
    rejectionReason,
  }: { agencyId: AgencyId; decision: "approved" | "rejected"; rejectionReason?: string },
): Promise<ReviewOnboardingResult> {
  const agency = await ctx.db.get(agencyId);
  if (!agency) return { success: false, error: { code: "NOT_FOUND" } };

  const isReviewable =
    agency.onboardingState === ONBOARDING_STATE.SUBMITTED ||
    agency.onboardingState === ONBOARDING_STATE.UNDER_REVIEW;
  if (!isReviewable) return { success: false, error: { code: "NOT_REVIEWABLE" } };

  const reviewedAt = new Date().toISOString();

  if (decision === "approved") {
    await ctx.db.patch(agencyId, { onboardingState: ONBOARDING_STATE.ACTIVE });
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
      onboardingRejectionReason: rejectionReason,
    });
  }

  return { success: true, data: { agencyId, decision, reviewedAt } };
}

export const reviewOnboarding = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => applyOnboardingReview(ctx, args),
});
