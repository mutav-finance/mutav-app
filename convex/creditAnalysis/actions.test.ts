// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import type { ContractApplicationId } from "../contracts/domain";
import schema from "../schema";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64"); // hook-ok: test fixture — direct env mutation is the only way to seed PII keys for convex-test
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64"); // hook-ok: test fixture — direct env mutation is the only way to seed PII keys for convex-test
});
afterEach(() => {
  delete process.env.SCORE_PROVIDER; // hook-ok: test fixture — resets getScoreProvider() to its mock default between cases
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

async function seedApplication(
  t: ReturnType<typeof convexTest>,
  agencyId: AgencyId,
): Promise<ContractApplicationId> {
  return t.run(async (ctx) => {
    const openedBy = await ctx.db.insert("users", {
      publicId: "user-application-opener",
      subject: "auth0|application-opener",
      name: "Application Opener",
      email: "opener@mutav.test",
      createdAt: new Date().toISOString(),
    });
    return ctx.db.insert("contractApplications", {
      agencyId,
      subjectHash: "hash-application",
      entityType: "pf",
      propertyKind: "residencial",
      cep: "01310100",
      rentCents: 250_000,
      openedBy,
      openedAt: Date.now(),
    });
  });
}

test("runCreditAnalysis (mock provider) writes one signal + an ok assessment", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const applicationId = await seedApplication(t, agencyId);
  await t.action(internal.creditAnalysis.actions.runCreditAnalysis, {
    agencyId,
    subjectType: "tenant",
    document: "12345678901",
    capability: "credit_score",
    applicationId,
  });
  const signals = await t.run((ctx) => ctx.db.query("creditAnalysisSignals").collect());
  const assessments = await t.run((ctx) => ctx.db.query("creditAnalysisAssessments").collect());
  expect(signals).toHaveLength(1);
  expect(signals[0].provider).toBe("mock");
  expect(signals[0].status).toBe("ok");
  expect(assessments).toHaveLength(1);
  expect(assessments[0].status).toBe("ok");
  expect(assessments[0].tier).toBeDefined();
  expect(assessments[0].signalIds).toHaveLength(1);
});

test("runCreditAnalysis is idempotent on signals within a day window", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const args = {
    agencyId,
    subjectType: "tenant" as const,
    document: "12345678901",
    capability: "credit_score" as const,
    applicationId: await seedApplication(t, agencyId),
  };
  await t.action(internal.creditAnalysis.actions.runCreditAnalysis, args);
  await t.action(internal.creditAnalysis.actions.runCreditAnalysis, args);
  const signals = await t.run((ctx) => ctx.db.query("creditAnalysisSignals").collect());
  expect(signals).toHaveLength(1);
  // Signals dedupe within the window; assessments are append-only snapshots.
  const assessments = await t.run((ctx) => ctx.db.query("creditAnalysisAssessments").collect());
  expect(assessments).toHaveLength(2);
});
