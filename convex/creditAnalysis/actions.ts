import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashPii } from "../lib/pii";
import {
  POLICY_VERSION,
  capabilityValidator,
  deriveCreditAnalysis,
  subjectTypeValidator,
  windowKeyForDay,
  type ProviderSignal,
  type CreditAnalysisSignalId,
} from "./domain";
import { resolveCreditProviders } from "./registry";

export const runCreditAnalysis = internalAction({
  args: {
    agencyId: v.id("agencies"),
    subjectType: subjectTypeValidator,
    document: v.string(),
    capability: capabilityValidator,
  },
  handler: async (ctx, { agencyId, subjectType, document, capability }) => {
    const digits = document.replace(/\D/g, "");
    const subjectHash = await hashPii(digits);
    const now = Date.now();
    const windowKey = windowKeyForDay(now);
    const correlationId = `${subjectHash}:${windowKey}`;

    const providers = resolveCreditProviders({ document: digits });
    const settled = await Promise.allSettled(
      providers.map((p) => p.query({ subjectType, document: digits, capability })),
    );

    const signals: ProviderSignal[] = settled.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { status: "error", provider: providers[i].name, capability, error: String(r.reason) },
    );

    const signalIds: CreditAnalysisSignalId[] = [];
    for (const signal of signals) {
      const id = await ctx.runMutation(internal.creditAnalysis.useCases.recordSignal, {
        agencyId,
        subjectType,
        subjectHash,
        capability,
        provider: signal.provider,
        status: signal.status,
        normalized: signal.status === "ok" ? signal.normalized : undefined,
        error: signal.status === "error" ? signal.error : undefined,
        vendorRef: signal.status === "ok" ? signal.vendorRef : undefined,
        correlationId,
        windowKey,
        pulledAt: now,
      });
      signalIds.push(id);
    }

    const derived = deriveCreditAnalysis(signals);
    await ctx.runMutation(internal.creditAnalysis.useCases.recordAssessment, {
      agencyId,
      subjectType,
      subjectHash,
      policyVersion: POLICY_VERSION.CREDIT_ANALYSIS,
      signalIds,
      status: derived.status,
      score: derived.status === "ok" ? derived.score : undefined,
      tier: derived.status === "ok" ? derived.tier : undefined,
      assessedAt: now,
    });
  },
});
