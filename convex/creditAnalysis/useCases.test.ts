// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import schema from "../schema";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64"); // hook-ok: test fixture — direct env mutation is the only way to seed PII keys for convex-test
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64"); // hook-ok: test fixture — direct env mutation is the only way to seed PII keys for convex-test
});

async function seedAgency(t: ReturnType<typeof convexTest>): Promise<AgencyId> {
  return t.run(async (ctx) =>
    ctx.db.insert("agencies", {
      name: "Acme",
      cnpj: "12345678000190",
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    }),
  );
}

test("recordSignal is idempotent within a window", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const base = {
    agencyId,
    subjectType: "tenant" as const,
    subjectHash: "hash-1",
    capability: "credit_score" as const,
    provider: "mock",
    status: "ok" as const,
    normalized: { score: 700, scale: 1000 },
    correlationId: "corr-1",
    windowKey: "d100",
    pulledAt: 100 * 24 * 60 * 60 * 1000,
  };
  const first = await t.mutation(internal.creditAnalysis.useCases.recordSignal, base);
  const second = await t.mutation(internal.creditAnalysis.useCases.recordSignal, {
    ...base,
    correlationId: "corr-2",
  });
  expect(second).toBe(first);
  const rows = await t.run((ctx) => ctx.db.query("creditAnalysisSignals").collect());
  expect(rows).toHaveLength(1);
});

test("getFreshAssessment respects the TTL window", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const now = 1_000_000_000_000;
  await t.run((ctx) =>
    ctx.db.insert("creditAnalysisAssessments", {
      agencyId,
      subjectType: "tenant",
      subjectHash: "hash-2",
      policyVersion: "credit_analysis_v1",
      signalIds: [],
      status: "ok",
      score: 800,
      tier: "bom",
      assessedAt: now - 1000,
    }),
  );
  const fresh = await t.query(internal.creditAnalysis.useCases.getFreshAssessment, {
    agencyId,
    subjectHash: "hash-2",
    notBefore: now - 5000,
  });
  expect(fresh?.tier).toBe("bom");
  const stale = await t.query(internal.creditAnalysis.useCases.getFreshAssessment, {
    agencyId,
    subjectHash: "hash-2",
    notBefore: now,
  });
  expect(stale).toBeNull();
});

test("recordAssessment accepts an unavailable result with no score payload", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const now = 1_000_000_000_000;
  await t.mutation(internal.creditAnalysis.useCases.recordAssessment, {
    agencyId,
    subjectType: "tenant",
    subjectHash: "hash-3",
    policyVersion: "credit_analysis_v1",
    signalIds: [],
    status: "unavailable",
    assessedAt: now,
  });
  const fresh = await t.query(internal.creditAnalysis.useCases.getFreshAssessment, {
    agencyId,
    subjectHash: "hash-3",
    notBefore: now - 1,
  });
  expect(fresh?.status).toBe("unavailable");
  expect(fresh?.score).toBeUndefined();
  expect(fresh?.tier).toBeUndefined();
});
