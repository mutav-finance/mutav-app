import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import { scoreTierValidator } from "../contracts/domain";
import type {
  CreditAnalysisAssessment,
  CreditAnalysisAssessmentId,
  CreditAnalysisSignalId,
} from "./domain";
import {
  capabilityValidator,
  creditScoreNormalizedValidator,
  subjectTypeValidator,
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
  handler: async (ctx, args): Promise<CreditAnalysisSignalId> => {
    const existing = await ctx.db
      .query("creditAnalysisSignals")
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
    return ctx.db.insert("creditAnalysisSignals", args);
  },
});

export const recordAssessment = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    subjectType: subjectTypeValidator,
    subjectHash: v.string(),
    policyVersion: v.string(),
    signalIds: v.array(v.id("creditAnalysisSignals")),
    status: v.union(v.literal("ok"), v.literal("unavailable")),
    score: v.optional(v.number()),
    tier: v.optional(scoreTierValidator),
    assessedAt: v.number(),
  },
  handler: async (ctx, args): Promise<CreditAnalysisAssessmentId> => {
    return ctx.db.insert("creditAnalysisAssessments", args);
  },
});

export async function findFreshAssessment(
  ctx: QueryCtx,
  args: {
    agencyId: AgencyId;
    subjectHash: string;
    notBefore: number;
  },
): Promise<CreditAnalysisAssessment | null> {
  return ctx.db
    .query("creditAnalysisAssessments")
    .withIndex("by_agency_subject_time", (q) =>
      q
        .eq("agencyId", args.agencyId)
        .eq("subjectHash", args.subjectHash)
        .gt("assessedAt", args.notBefore),
    )
    .order("desc")
    .first();
}

export const getFreshAssessment = internalQuery({
  args: {
    agencyId: v.id("agencies"),
    subjectHash: v.string(),
    notBefore: v.number(),
  },
  handler: (ctx, args) => findFreshAssessment(ctx, args),
});
