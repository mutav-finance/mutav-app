// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
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

test("runCreditAnalysis (mock provider) writes one signal + an ok assessment", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  await t.action(internal.creditRisk.actions.runCreditAnalysis, {
    agencyId,
    subjectType: "tenant",
    document: "12345678901",
    capability: "credit_score",
  });
  const signals = await t.run((ctx) => ctx.db.query("creditRiskSignals").collect());
  const assessments = await t.run((ctx) => ctx.db.query("creditRiskAssessments").collect());
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
  };
  await t.action(internal.creditRisk.actions.runCreditAnalysis, args);
  await t.action(internal.creditRisk.actions.runCreditAnalysis, args);
  const signals = await t.run((ctx) => ctx.db.query("creditRiskSignals").collect());
  expect(signals).toHaveLength(1);
  // Signals dedupe within the window; assessments are append-only snapshots.
  const assessments = await t.run((ctx) => ctx.db.query("creditRiskAssessments").collect());
  expect(assessments).toHaveLength(2);
});
