import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import type {
  ScreeningAssessment,
  ScreeningAssessmentId,
  ScreeningSignalId,
  ScreeningPurpose,
} from "./domain";
import {
  capabilityValidator,
  creditScoreNormalizedValidator,
  screeningPurposeValidator,
  subjectTypeValidator,
  tenantUnderwritingResultValidator,
} from "./domain";

export const recordSignal = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    subjectType: subjectTypeValidator,
    subjectHash: v.string(),
    capability: capabilityValidator,
    provider: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    normalized: v.optional(creditScoreNormalizedValidator),
    error: v.optional(v.string()),
    vendorRef: v.optional(v.string()),
    correlationId: v.string(),
    windowKey: v.string(),
    pulledAt: v.number(),
  },
  handler: async (ctx, args): Promise<ScreeningSignalId> => {
    const existing = await ctx.db
      .query("screeningSignals")
      .withIndex("by_idempotency", (q) =>
        q
          .eq("agencyId", args.agencyId)
          .eq("subjectHash", args.subjectHash)
          .eq("capability", args.capability)
          .eq("provider", args.provider)
          .eq("windowKey", args.windowKey),
      )
      .first();
    // First caller within the window wins; later callers (e.g. a retry with a
    // fresh correlationId) share the existing row rather than re-paying the
    // provider. correlationId is intentionally not part of the key.
    if (existing) return existing._id;
    return ctx.db.insert("screeningSignals", args);
  },
});

export const recordAssessment = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    subjectType: subjectTypeValidator,
    subjectHash: v.string(),
    purpose: screeningPurposeValidator,
    policyVersion: v.string(),
    signalIds: v.array(v.id("screeningSignals")),
    status: v.union(v.literal("ok"), v.literal("unavailable")),
    result: v.optional(tenantUnderwritingResultValidator),
    decidedAt: v.number(),
  },
  handler: async (ctx, args): Promise<ScreeningAssessmentId> => {
    return ctx.db.insert("screeningAssessments", args);
  },
});

export async function findFreshAssessment(
  ctx: QueryCtx,
  args: {
    agencyId: AgencyId;
    subjectHash: string;
    purpose: ScreeningPurpose;
    notBefore: number;
  },
): Promise<ScreeningAssessment | null> {
  return ctx.db
    .query("screeningAssessments")
    .withIndex("by_agency_subject_purpose_time", (q) =>
      q
        .eq("agencyId", args.agencyId)
        .eq("subjectHash", args.subjectHash)
        .eq("purpose", args.purpose)
        .gt("decidedAt", args.notBefore),
    )
    .order("desc")
    .first();
}

export const getFreshAssessment = internalQuery({
  args: {
    agencyId: v.id("agencies"),
    subjectHash: v.string(),
    purpose: screeningPurposeValidator,
    notBefore: v.number(),
  },
  handler: (ctx, args) => findFreshAssessment(ctx, args),
});
