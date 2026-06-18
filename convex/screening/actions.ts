import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashPii } from "../lib/pii";
import {
  POLICY_VERSION,
  capabilityValidator,
  deriveTenantUnderwriting,
  screeningPurposeValidator,
  subjectTypeValidator,
  windowKeyForDay,
  type ProviderSignal,
  type ScreeningSignalId,
} from "./domain";
import { resolveCreditProviders } from "./registry";

export const runScreening = internalAction({
  args: {
    agencyId: v.id("agencies"),
    subjectType: subjectTypeValidator,
    document: v.string(),
    capability: capabilityValidator,
    purpose: screeningPurposeValidator,
  },
  handler: async (ctx, { agencyId, subjectType, document, capability, purpose }) => {
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

    const signalIds: ScreeningSignalId[] = [];
    for (const signal of signals) {
      const id = await ctx.runMutation(internal.screening.useCases.recordSignal, {
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

    const derived = deriveTenantUnderwriting(signals);
    await ctx.runMutation(internal.screening.useCases.recordAssessment, {
      agencyId,
      subjectType,
      subjectHash,
      purpose,
      policyVersion: POLICY_VERSION.TENANT_UNDERWRITING,
      signalIds,
      status: derived.status,
      result: derived.status === "ok" ? derived.result : undefined,
      decidedAt: now,
    });
  },
});
