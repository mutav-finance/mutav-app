import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type ScoreTier, tierForScore } from "../contracts/domain";

export type CreditAnalysisSignal = Doc<"creditAnalysisSignals">;
export type CreditAnalysisSignalId = Id<"creditAnalysisSignals">;
export type CreditAnalysisAssessment = Doc<"creditAnalysisAssessments">;
export type CreditAnalysisAssessmentId = Id<"creditAnalysisAssessments">;

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

export const POLICY_VERSION = { CREDIT_ANALYSIS: "credit_analysis_v1" } as const;
export const DEFAULT_CREDIT_SCALE = 1000;

export type SignalStatus = "ok" | "error";
export type AssessmentStatus = "ok" | "unavailable";

export type CreditScoreNormalized = { score: number; scale: number };
export const creditScoreNormalizedValidator = v.object({ score: v.number(), scale: v.number() });

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

export interface CreditAnalysisProvider {
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

export type CreditAnalysisResult = { score: number; tier: ScoreTier };

/** Pure credit-analysis derivation. Phase: single primary provider — first ok
 * signal wins. */
export function deriveCreditAnalysis(
  signals: readonly ProviderSignal[],
): { status: "ok"; score: number; tier: ScoreTier } | { status: "unavailable" } {
  const ok = signals.filter(
    (s): s is Extract<ProviderSignal, { status: "ok" }> => s.status === "ok",
  );
  const primary = ok[0];
  if (!primary) return { status: "unavailable" };
  return {
    status: "ok",
    score: primary.normalized.score,
    tier: tierForScore(primary.normalized.score),
  };
}
