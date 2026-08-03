// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import type { ContractApplicationId } from "../contracts/domain";
import {
  registerContractAggregateComponents,
  seedAgencyWithMembership,
  setupAuthenticatedUser,
  type SeededUserId,
} from "../lib/testFixtures";
import { hashPii } from "../lib/pii";
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

async function seedApplication(
  t: ReturnType<typeof convexTest>,
  args: { agencyId: AgencyId; openedBy: SeededUserId; subjectHash: string; openedAt: number },
): Promise<ContractApplicationId> {
  return t.run(async (ctx) =>
    ctx.db.insert("contractApplications", {
      agencyId: args.agencyId,
      subjectHash: args.subjectHash,
      entityType: "pf",
      propertyKind: "residencial",
      cep: "01310100",
      rentCents: 250_000,
      openedBy: args.openedBy,
      openedAt: args.openedAt,
    }),
  );
}

test("recordSignal is idempotent within a window", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const { userId } = await setupAuthenticatedUser(t);
  const applicationId = await seedApplication(t, {
    agencyId,
    openedBy: userId,
    subjectHash: "hash-1",
    openedAt: 100 * 24 * 60 * 60 * 1000,
  });
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
    applicationId,
    legalBasis: "art7_x" as const,
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

describe("Lei 12.414 art. 15 relationship precondition", () => {
  const SUBJECT_CPF = "11144477735";
  const APPLICATION_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("dispatch is refused when no application binds the agency to the tax ID", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const result = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: SUBJECT_CPF,
    });

    expect(result.status).toBe("no_application");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const signals = await t.run((ctx) => ctx.db.query("creditAnalysisSignals").collect());
    expect(signals).toHaveLength(0);
  });

  test("dispatch is permitted once an application binds the agency to the tax ID", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const opened = await asUser.mutation(api.contracts.useCases.openContractApplication, {
      agencyId,
      document: SUBJECT_CPF,
      entityType: "pf",
      propertyKind: "residencial",
      cep: "01310-100",
      rentCents: 250_000,
    });
    expect(opened.success).toBe(true);

    const result = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: SUBJECT_CPF,
    });
    expect(result.status).toBe("fetching");
  });

  test("another agency's application does not authorise this agency's pull", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    const foreignAgencyId = await seedAgency(t);
    await seedApplication(t, {
      agencyId: foreignAgencyId,
      openedBy: userId,
      subjectHash: await hashPii(SUBJECT_CPF),
      openedAt: Date.now(),
    });

    const result = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: SUBJECT_CPF,
    });
    expect(result.status).toBe("no_application");
  });

  test("an application older than the validity window no longer authorises a pull", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedApplication(t, {
      agencyId,
      openedBy: userId,
      subjectHash: await hashPii(SUBJECT_CPF),
      openedAt: Date.now() - APPLICATION_VALIDITY_MS - 1,
    });

    const result = await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: SUBJECT_CPF,
    });
    expect(result.status).toBe("no_application");
  });

  test("the resulting signal carries the application ref and the legal basis", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    const applicationId = await seedApplication(t, {
      agencyId,
      openedBy: userId,
      subjectHash: await hashPii(SUBJECT_CPF),
      openedAt: Date.now(),
    });

    await asUser.mutation(api.contracts.useCases.requestCreditScore, {
      agencyId,
      document: SUBJECT_CPF,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const signals = await t.run((ctx) => ctx.db.query("creditAnalysisSignals").collect());
    expect(signals).toHaveLength(1);
    expect(signals[0].applicationId).toBe(applicationId);
    expect(signals[0].legalBasis).toBe("art7_x");
  });

  test("openContractApplication rejects a tax ID that is neither CPF nor CNPJ length", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const result = await asUser.mutation(api.contracts.useCases.openContractApplication, {
      agencyId,
      document: "123",
      entityType: "pf",
      propertyKind: "residencial",
      cep: "01310-100",
      rentCents: 250_000,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_TAX_ID");
    const rows = await t.run((ctx) => ctx.db.query("contractApplications").collect());
    expect(rows).toHaveLength(0);
  });

  test("openContractApplication attributes the record to the declaring member", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await asUser.mutation(api.contracts.useCases.openContractApplication, {
      agencyId,
      document: "111.444.777-35",
      entityType: "pf",
      propertyKind: "comercial",
      cep: "01310-100",
      rentCents: 250_000,
    });

    const rows = await t.run((ctx) => ctx.db.query("contractApplications").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].openedBy).toBe(userId);
    expect(rows[0].agencyId).toBe(agencyId);
    expect(rows[0].cep).toBe("01310100");
    expect(rows[0].propertyKind).toBe("comercial");
    expect(rows[0].subjectHash).toBe(await hashPii(SUBJECT_CPF));
  });
});
