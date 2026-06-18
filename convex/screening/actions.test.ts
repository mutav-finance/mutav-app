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
  delete process.env.SCORE_PROVIDER; // defaults to mock
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

test("runScreening (mock provider) writes one signal + an ok assessment", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  await t.action(internal.screening.actions.runScreening, {
    agencyId,
    subjectType: "tenant",
    document: "12345678901",
    capability: "credit_score",
    purpose: "tenant_underwriting",
  });
  const signals = await t.run((ctx) => ctx.db.query("screeningSignals").collect());
  const assessments = await t.run((ctx) => ctx.db.query("screeningAssessments").collect());
  expect(signals).toHaveLength(1);
  expect(signals[0].provider).toBe("mock");
  expect(signals[0].status).toBe("ok");
  expect(assessments).toHaveLength(1);
  expect(assessments[0].status).toBe("ok");
  expect(assessments[0].result?.tier).toBeDefined();
  expect(assessments[0].signalIds).toHaveLength(1);
});

test("runScreening is idempotent on signals within a day window", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const args = {
    agencyId,
    subjectType: "tenant" as const,
    document: "12345678901",
    capability: "credit_score" as const,
    purpose: "tenant_underwriting" as const,
  };
  await t.action(internal.screening.actions.runScreening, args);
  await t.action(internal.screening.actions.runScreening, args);
  const signals = await t.run((ctx) => ctx.db.query("screeningSignals").collect());
  expect(signals).toHaveLength(1);
  // Signals dedupe within the window; assessments are append-only snapshots.
  const assessments = await t.run((ctx) => ctx.db.query("screeningAssessments").collect());
  expect(assessments).toHaveLength(2);
});
