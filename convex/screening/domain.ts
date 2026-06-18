import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type ScoreTier, scoreTierValidator, tierForScore } from "../contracts/domain";

export type ScreeningSignal = Doc<"screeningSignals">;
export type ScreeningSignalId = Id<"screeningSignals">;
export type ScreeningAssessment = Doc<"screeningAssessments">;
export type ScreeningAssessmentId = Id<"screeningAssessments">;

export type Capability = "credit_score";
export const CAPABILITY = { CREDIT_SCORE: "credit_score" } as const satisfies Record<
  string,
  Capability
>;
export const capabilityValidator = v.union(v.literal(CAPABILITY.CREDIT_SCORE));

export type SubjectType = "tenant" | "agency" | "investor";
export const SUBJECT_TYPE = {
  TENANT: "tenant",
  AGENCY: "agency",
  INVESTOR: "investor",
} as const satisfies Record<Uppercase<SubjectType>, SubjectType>;
export const subjectTypeValidator = v.union(
  v.literal(SUBJECT_TYPE.TENANT),
  v.literal(SUBJECT_TYPE.AGENCY),
  v.literal(SUBJECT_TYPE.INVESTOR),
);

export type ScreeningPurpose = "tenant_underwriting";
export const SCREENING_PURPOSE = {
  TENANT_UNDERWRITING: "tenant_underwriting",
} as const satisfies Record<string, ScreeningPurpose>;
export const screeningPurposeValidator = v.literal(SCREENING_PURPOSE.TENANT_UNDERWRITING);

export const POLICY_VERSION = { TENANT_UNDERWRITING: "tenant_underwriting_v1" } as const;
export const DEFAULT_CREDIT_SCALE = 1000;

export type SignalStatus = "ok" | "error";
export type AssessmentStatus = "ok" | "unavailable";

export type CreditScoreNormalized = { score: number; scale: number };
export const creditScoreNormalizedValidator = v.object({ score: v.number(), scale: v.number() });

/** Validator for a `tenant_underwriting` assessment result. Tier is sourced
 * from contracts (the underwriting consumer owns the tier vocabulary). */
export const tenantUnderwritingResultValidator = v.object({
  score: v.number(),
  tier: scoreTierValidator,
});

export type ProviderRequest = {
  subjectType: SubjectType;
  document: string;
  capability: Capability;
};

export type ProviderSignal =
  | {
      status: "ok";
      provider: string;
      capability: Capability;
      normalized: CreditScoreNormalized;
      vendorRef?: string;
    }
  | { status: "error"; provider: string; capability: Capability; error: string };

export interface ScreeningProvider {
  readonly name: string;
  readonly capabilities: readonly Capability[];
  query(req: ProviderRequest): Promise<ProviderSignal>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Coarse idempotency bucket: signals for the same subject+capability+provider
 * within one UTC day dedupe to a single paid pull. */
export function windowKeyForDay(timestampMs: number): string {
  return `d${Math.floor(timestampMs / DAY_MS)}`;
}

export type TenantUnderwritingResult = { score: number; tier: ScoreTier };

/** Consumer (contracts/underwriting) aggregation policy — pure. Phase 1 uses a
 * single primary provider; takes the first ok signal. */
export function deriveTenantUnderwriting(
  signals: readonly ProviderSignal[],
): { status: "ok"; result: TenantUnderwritingResult } | { status: "unavailable" } {
  const ok = signals.filter(
    (s): s is Extract<ProviderSignal, { status: "ok" }> => s.status === "ok",
  );
  const primary = ok[0];
  if (!primary) return { status: "unavailable" };
  return {
    status: "ok",
    result: { score: primary.normalized.score, tier: tierForScore(primary.normalized.score) },
  };
}
