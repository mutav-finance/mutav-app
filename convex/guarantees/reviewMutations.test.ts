// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import type { MutavStaffRole } from "../mutavStaff/domain";
import {
  registerGuaranteeAggregateComponents,
  seedDefaultProduct,
  seedFreshCreditAssessment,
} from "../lib/testFixtures";
import type { Guarantee } from "./domain";
import schema from "../schema";

type T = TestConvex<typeof schema>;

const VALID_CPF = "52998224725";
const OTHER_CPF = "11144477735";
const THIRD_CPF = "39053344705";
const RENT_CENTS = 300_000;
const START = "2026-10-01T12:00:00.000Z";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64"); // hook-ok: test-only env fixture
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64"); // hook-ok: test-only env fixture
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(): T {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

type Actor = { subject: string; userId: UserId };

async function insertUser(t: T, suffix: string): Promise<Actor> {
  const subject = `auth0|${suffix}`;
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: `user-${suffix}`,
      subject,
      name: `User ${suffix}`,
      email: `${suffix}@test.br`,
      createdAt: START,
    }),
  );
  return { subject, userId };
}

async function insertAgency(
  t: T,
  {
    owner,
    suffix,
    state = "active",
  }: { owner: Actor; suffix: string; state?: "active" | "under_review" },
): Promise<AgencyId> {
  return t.run(async (ctx) => {
    const agencyId = await ctx.db.insert("agencies", {
      name: `Agency ${suffix}`,
      cnpj: `0000000000${suffix}`.padStart(14, "0").slice(-14),
      agencyType: "empresa",
      onboardingState: state,
      email: `agency-${suffix}@test.br`,
      createdAt: START,
    });
    await ctx.db.insert("memberships", {
      userId: owner.userId,
      agencyId,
      role: "owner",
      joinedAt: START,
    });
    return agencyId;
  });
}

async function grant(t: T, actor: Actor, role: MutavStaffRole): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("mutavStaff", { userId: actor.userId, role, createdAt: START }),
  );
}

type World = {
  t: T;
  owner: Actor;
  agencyId: AgencyId;
  compliance: Actor;
  support: Actor;
  foreignOwner: Actor;
  foreignAgencyId: AgencyId;
};

async function world(): Promise<World> {
  const t = setup();
  await seedDefaultProduct(t);
  const owner = await insertUser(t, "owner");
  const agencyId = await insertAgency(t, { owner, suffix: "1" });
  const foreignOwner = await insertUser(t, "foreign");
  const foreignAgencyId = await insertAgency(t, { owner: foreignOwner, suffix: "2" });
  const compliance = await insertUser(t, "compliance");
  await grant(t, compliance, "compliance");
  const support = await insertUser(t, "support");
  await grant(t, support, "support");
  return { t, owner, agencyId, compliance, support, foreignOwner, foreignAgencyId };
}

function createArgs(cpf = VALID_CPF) {
  return {
    lease: {
      propertyKind: "residential" as const,
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo / SP",
        complement: "",
      },
      tag: "",
      description: "",
      rent: { rentCents: RENT_CENTS, condoCents: 50_000, otherFeesCents: 0 },
    },
    plan: "basic" as const,
    tenant: {
      entityType: "pf" as const,
      fullName: "Maria Silva Santos",
      cpf,
      cnpj: undefined,
      birthDate: "1990-05-12",
      email: "maria@example.com",
      phone: "11900000001",
    },
  };
}

async function createDraft(
  w: World,
  { score = 750, cpf = VALID_CPF }: { score?: number; cpf?: string } = {},
): Promise<string> {
  await seedFreshCreditAssessment(w.t, { agencyId: w.agencyId, document: cpf, score });
  const result = await w.t
    .withIdentity({ subject: w.owner.subject })
    .mutation(api.guarantees.useCases.create, { agencyId: w.agencyId, ...createArgs(cpf) });
  if (!result.success) throw new Error(`create failed: ${result.error.code}`);
  return result.data.publicId;
}

async function requestAnalysisFor(w: World, publicId: string): Promise<void> {
  const result = await w.t
    .withIdentity({ subject: w.owner.subject })
    .mutation(api.guarantees.reviewMutations.requestAnalysis, { agencyId: w.agencyId, publicId });
  if (!result.success) throw new Error(`requestAnalysis failed: ${result.error.code}`);
}

async function acceptFor(w: World, publicId: string, feeRateBps = 1_750): Promise<void> {
  const result = await w.t
    .withIdentity({ subject: w.compliance.subject })
    .mutation(api.guarantees.reviewMutations.acceptAnalysis, { publicId, feeRateBps });
  if (!result.success) throw new Error(`acceptAnalysis failed: ${result.error.code}`);
}

async function readByPublicId(t: T, publicId: string): Promise<Guarantee> {
  const row = await t.run((ctx) =>
    ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique(),
  );
  if (!row) throw new Error(`guarantee ${publicId} missing`);
  return row;
}

async function auditActions(t: T, publicId: string): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("mutavAuditLog")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "guarantees").eq("resourceId", publicId),
      )
      .collect(),
  );
  return rows.map((row) => row.action);
}

async function historyMessages(t: T, publicId: string): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("guaranteeHistory")
      .withIndex("by_guarantee", (q) => q.eq("guaranteePublicId", publicId))
      .collect(),
  );
  return rows.map((row) => row.message);
}

describe("create starts the review", () => {
  test("a new draft is editing with no request, decision or signature yet", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    const row = await readByPublicId(w.t, publicId);
    expect(row.underwriting.review).toBe("editing");
    expect(row.underwriting.analysisRequest).toBeUndefined();
    expect(row.underwriting.decision).toBeUndefined();
    expect(row.terms.feeRateBps).toBe(1_200);
    expect(row.capacity.reservedCents).toBe(0);
  });
});

describe("guarantees.reviewMutations.updateDraft", () => {
  test("reprices the snapshot and moves the lease rent while editing", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    const result = await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.reviewMutations.updateDraft, {
        agencyId: w.agencyId,
        publicId,
        rentCents: 400_000,
        plan: "plus",
      });
    expect(result.success).toBe(true);

    const row = await readByPublicId(w.t, publicId);
    expect(row.terms.rentCents).toBe(400_000);
    expect(row.terms.taxaFeeCents).toBe(48_000);
    expect(row.terms.prestamistaFeeCents).toBe(1_280);
    expect(row.capacity).toEqual({
      ceilingCents: 12_000_000,
      availableCents: 12_000_000,
      reservedCents: 0,
    });
    const lease = await w.t.run((ctx) => ctx.db.get(row.leaseId));
    expect(lease?.rent).toEqual({
      rentCents: 400_000,
      condoCents: 50_000,
      otherFeesCents: 0,
      totalRentCents: 450_000,
    });
    expect(await auditActions(w.t, publicId)).toContain("guarantee.draft_updated");
    expect(await historyMessages(w.t, publicId)).toContain("Proposta atualizada");
  });

  test("INVALID_RENT for a non-positive rent, nothing written", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    const before = await readByPublicId(w.t, publicId);
    const result = await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.reviewMutations.updateDraft, {
        agencyId: w.agencyId,
        publicId,
        rentCents: 0,
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("INVALID_RENT");
    expect((await readByPublicId(w.t, publicId)).terms).toEqual(before.terms);
  });

  test("NOT_EDITING once analysis is requested", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.reviewMutations.updateDraft, {
        agencyId: w.agencyId,
        publicId,
        plan: "plus",
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_EDITING");
  });

  test("NOT_DRAFTED on a canceled draft", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.useCases.cancelDraft, { agencyId: w.agencyId, publicId });
    const result = await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.reviewMutations.updateDraft, {
        agencyId: w.agencyId,
        publicId,
        plan: "plus",
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_DRAFTED");
  });

  test("PRODUCT_UNAVAILABLE when no product can price the draft", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await w.t.run(async (ctx) => {
      for (const product of await ctx.db.query("products").collect()) {
        await ctx.db.patch(product._id, { enabled: false });
      }
    });
    const result = await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.reviewMutations.updateDraft, {
        agencyId: w.agencyId,
        publicId,
        plan: "plus",
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  test("NOT_FOUND for another agency's draft", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    const result = await w.t
      .withIdentity({ subject: w.foreignOwner.subject })
      .mutation(api.guarantees.reviewMutations.updateDraft, {
        agencyId: w.foreignAgencyId,
        publicId,
        plan: "plus",
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("guarantees.reviewMutations.requestAnalysis", () => {
  test("editing → analysis_requested, stamps the request, writes history and audit", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);

    const row = await readByPublicId(w.t, publicId);
    expect(row.status).toBe("drafted");
    expect(row.underwriting.review).toBe("analysis_requested");
    expect(row.underwriting.analysisRequest).toEqual({
      requestedAt: START,
      requestedBy: w.owner.userId,
    });
    expect(await auditActions(w.t, publicId)).toContain("guarantee.analysis_requested");
    expect(await historyMessages(w.t, publicId)).toContain("Análise Mutav solicitada");
  });

  test("re-reads the freshest assessment, so Mutav reviews the current score", async () => {
    const w = await world();
    const publicId = await createDraft(w, { score: 750 });
    vi.setSystemTime(new Date("2026-10-01T13:00:00.000Z"));
    await seedFreshCreditAssessment(w.t, { agencyId: w.agencyId, document: VALID_CPF, score: 380 });
    await requestAnalysisFor(w, publicId);
    const row = await readByPublicId(w.t, publicId);
    expect(row.underwriting.score).toBe(380);
    expect(row.underwriting.tier).toBe("negado");
  });

  test("NOT_EDITING when asked twice", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.reviewMutations.requestAnalysis, {
        agencyId: w.agencyId,
        publicId,
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_EDITING");
  });

  test("CREDIT_ASSESSMENT_REQUIRED when the assessment has gone stale", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
    const result = await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.reviewMutations.requestAnalysis, {
        agencyId: w.agencyId,
        publicId,
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("CREDIT_ASSESSMENT_REQUIRED");
    expect((await readByPublicId(w.t, publicId)).underwriting.review).toBe("editing");
  });

  test("NOT_DRAFTED on a canceled draft", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.useCases.cancelDraft, { agencyId: w.agencyId, publicId });
    const result = await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.reviewMutations.requestAnalysis, {
        agencyId: w.agencyId,
        publicId,
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_DRAFTED");
  });

  test("NOT_FOUND across agencies", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    const result = await w.t
      .withIdentity({ subject: w.foreignOwner.subject })
      .mutation(api.guarantees.reviewMutations.requestAnalysis, {
        agencyId: w.foreignAgencyId,
        publicId,
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_FOUND");
  });

  test("an agency that is not active is refused by the wrapper", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await w.t.run((ctx) => ctx.db.patch(w.agencyId, { onboardingState: "under_review" }));
    await expect(
      w.t
        .withIdentity({ subject: w.owner.subject })
        .mutation(api.guarantees.reviewMutations.requestAnalysis, {
          agencyId: w.agencyId,
          publicId,
        }),
    ).rejects.toThrow(/Agency is not active/);
  });
});

describe("guarantees.reviewMutations.acceptAnalysis", () => {
  test("re-snapshots terms at the staff rate, keeps the bureau tier, records the decision", async () => {
    const w = await world();
    const publicId = await createDraft(w, { score: 380 });
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.acceptAnalysis, {
        publicId,
        feeRateBps: 1_750,
        note: "  Renda comprovada  ",
      });
    expect(result.success).toBe(true);

    const row = await readByPublicId(w.t, publicId);
    expect(row.status).toBe("drafted");
    expect(row.underwriting.review).toBe("accepted");
    expect(row.underwriting.tier).toBe("negado");
    expect(row.terms.feeRateBps).toBe(1_750);
    expect(row.terms.taxaFeeCents).toBe(52_500);
    expect(row.terms.feeCents).toBe(52_500);
    expect(row.capacity).toEqual({
      ceilingCents: 9_000_000,
      availableCents: 9_000_000,
      reservedCents: 0,
    });
    expect(row.underwriting.decision).toEqual({
      outcome: "accepted",
      feeRateBps: 1_750,
      note: "Renda comprovada",
      decidedAt: START,
      decidedBy: w.compliance.userId,
    });
    expect(await auditActions(w.t, publicId)).toContain("guarantee.analysis_accepted");
    expect(await historyMessages(w.t, publicId)).toContain("Análise Mutav aprovada");
  });

  test.each([99, 3_001, 1_250.5])("INVALID_FEE_RATE for %d bps, nothing written", async (bps) => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.acceptAnalysis, { publicId, feeRateBps: bps });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("INVALID_FEE_RATE");
    expect((await readByPublicId(w.t, publicId)).underwriting.review).toBe("analysis_requested");
  });

  test("TEXT_TOO_LONG for an oversized note", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.acceptAnalysis, {
        publicId,
        feeRateBps: 1_200,
        note: "x".repeat(2_001),
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("TEXT_TOO_LONG");
  });

  test("REVIEW_ILLEGAL_TRANSITION when the agency has not asked yet", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.acceptAnalysis, { publicId, feeRateBps: 1_200 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("REVIEW_ILLEGAL_TRANSITION");
  });

  test("REVIEW_SELF_TRANSITION on a replayed acceptance", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    await acceptFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.acceptAnalysis, { publicId, feeRateBps: 1_200 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("REVIEW_SELF_TRANSITION");
  });

  test("NOT_FOUND for an unknown publicId", async () => {
    const w = await world();
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.acceptAnalysis, {
        publicId: "nope",
        feeRateBps: 1_200,
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_FOUND");
  });

  test("support staff and agency members are refused by the role gate", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    await expect(
      w.t
        .withIdentity({ subject: w.support.subject })
        .mutation(api.guarantees.reviewMutations.acceptAnalysis, { publicId, feeRateBps: 1_200 }),
    ).rejects.toThrow(/Requires 'compliance' role or higher/);
    await expect(
      w.t
        .withIdentity({ subject: w.owner.subject })
        .mutation(api.guarantees.reviewMutations.acceptAnalysis, { publicId, feeRateBps: 1_200 }),
    ).rejects.toThrow(/Not a Mutav staff member/);
    expect((await readByPublicId(w.t, publicId)).underwriting.review).toBe("analysis_requested");
  });
});

describe("guarantees.reviewMutations.refuseAnalysis", () => {
  test("refuses, closes the draft as underwriting_refused and frees the lease", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.refuseAnalysis, {
        publicId,
        reason: " Renda insuficiente ",
      });
    expect(result.success).toBe(true);

    const row = await readByPublicId(w.t, publicId);
    expect(row.status).toBe("closed");
    expect(row.closure).toEqual({
      reason: "underwriting_refused",
      closedAt: START,
      note: "Renda insuficiente",
    });
    expect(row.underwriting.review).toBe("refused");
    expect(row.underwriting.decision).toEqual({
      outcome: "refused",
      reason: "Renda insuficiente",
      decidedAt: START,
      decidedBy: w.compliance.userId,
    });
    expect(row.capacity.reservedCents).toBe(0);
    const lease = await w.t.run((ctx) => ctx.db.get(row.leaseId));
    expect(lease?.openGuaranteeId).toBeNull();
    const actions = await auditActions(w.t, publicId);
    expect(actions).toContain("guarantee.transitioned");
    expect(actions).toContain("guarantee.analysis_refused");
  });

  test.each(["", "   "])("REFUSAL_REASON_REQUIRED for %j", async (reason) => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.refuseAnalysis, { publicId, reason });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("REFUSAL_REASON_REQUIRED");
    expect((await readByPublicId(w.t, publicId)).status).toBe("drafted");
  });

  test("TEXT_TOO_LONG for an oversized reason", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.refuseAnalysis, {
        publicId,
        reason: "x".repeat(2_001),
      });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("TEXT_TOO_LONG");
  });

  test("REVIEW_ILLEGAL_TRANSITION from an accepted draft", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    await acceptFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.refuseAnalysis, { publicId, reason: "late" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("REVIEW_ILLEGAL_TRANSITION");
  });

  test("NOT_DRAFTED when refusing an already-refused (closed) guarantee", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const asStaff = w.t.withIdentity({ subject: w.compliance.subject });
    await asStaff.mutation(api.guarantees.reviewMutations.refuseAnalysis, {
      publicId,
      reason: "first",
    });
    const result = await asStaff.mutation(api.guarantees.reviewMutations.refuseAnalysis, {
      publicId,
      reason: "again",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_DRAFTED");
  });

  test("the agency can draft the same tenant again after a refusal", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.refuseAnalysis, { publicId, reason: "no" });
    const second = await createDraft(w);
    expect(second).not.toBe(publicId);
    expect((await readByPublicId(w.t, second)).underwriting.review).toBe("editing");
  });

  test("support staff is refused by the role gate", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    await expect(
      w.t
        .withIdentity({ subject: w.support.subject })
        .mutation(api.guarantees.reviewMutations.refuseAnalysis, { publicId, reason: "no" }),
    ).rejects.toThrow(/Requires 'compliance' role or higher/);
  });
});

describe("guarantees.reviewMutations.markSentForSignature", () => {
  test("accepted → awaiting_signature, stamps who sent it and when", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    await acceptFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.markSentForSignature, { publicId });
    expect(result.success).toBe(true);

    const row = await readByPublicId(w.t, publicId);
    expect(row.status).toBe("drafted");
    expect(row.underwriting.review).toBe("awaiting_signature");
    expect(row.underwriting.signatureRequest).toEqual({
      sentAt: START,
      sentBy: w.compliance.userId,
    });
    expect(await auditActions(w.t, publicId)).toContain("guarantee.sent_for_signature");
    expect(await historyMessages(w.t, publicId)).toContain("Contrato enviado para assinatura");
  });

  test("REVIEW_ILLEGAL_TRANSITION before acceptance", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const result = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.markSentForSignature, { publicId });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("REVIEW_ILLEGAL_TRANSITION");
  });

  test("NOT_DRAFTED on a refused guarantee", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    const asStaff = w.t.withIdentity({ subject: w.compliance.subject });
    await asStaff.mutation(api.guarantees.reviewMutations.refuseAnalysis, {
      publicId,
      reason: "no",
    });
    const result = await asStaff.mutation(api.guarantees.reviewMutations.markSentForSignature, {
      publicId,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_DRAFTED");
  });

  test("support staff is refused by the role gate", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    await acceptFor(w, publicId);
    await expect(
      w.t
        .withIdentity({ subject: w.support.subject })
        .mutation(api.guarantees.reviewMutations.markSentForSignature, { publicId }),
    ).rejects.toThrow(/Requires 'compliance' role or higher/);
  });
});

describe("guarantees.reviewQueries", () => {
  test("listAnalysisQueue: only drafts in analysis_requested, oldest request first", async () => {
    const w = await world();
    const later = await createDraft(w, { cpf: VALID_CPF });
    const earlier = await createDraft(w, { cpf: OTHER_CPF, score: 380 });
    const notAsked = await createDraft(w, { cpf: VALID_CPF });
    const canceled = await createDraft(w, { cpf: THIRD_CPF });

    vi.setSystemTime(new Date("2026-10-01T12:05:00.000Z"));
    await requestAnalysisFor(w, earlier);
    vi.setSystemTime(new Date("2026-10-01T12:10:00.000Z"));
    await requestAnalysisFor(w, later);
    await requestAnalysisFor(w, canceled);
    await w.t
      .withIdentity({ subject: w.owner.subject })
      .mutation(api.guarantees.useCases.cancelDraft, { agencyId: w.agencyId, publicId: canceled });

    const queue = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .query(api.guarantees.reviewQueries.listAnalysisQueue, {
        paginationOpts: { numItems: 10, cursor: null },
      });
    expect(queue.page.map((row) => row.publicId)).toEqual([earlier, later]);
    expect(queue.page.map((row) => row.publicId)).not.toContain(notAsked);
    expect(queue.page[0]).toMatchObject({
      agencyName: "Agency 1",
      tenantName: "Maria Silva Santos",
      rentCents: RENT_CENTS,
      score: 380,
      tier: "negado",
      requestedAt: "2026-10-01T12:05:00.000Z",
      provisionalFeeRateBps: 1_500,
      bureauProvider: null,
      isMockScore: false,
    });
  });

  test("listAwaitingDispatch lists accepted drafts not yet sent", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await requestAnalysisFor(w, publicId);
    await acceptFor(w, publicId, 1_300);
    const asStaff = w.t.withIdentity({ subject: w.compliance.subject });
    const rows = await asStaff.query(api.guarantees.reviewQueries.listAwaitingDispatch, {});
    expect(rows.map((row) => [row.publicId, row.provisionalFeeRateBps])).toEqual([
      [publicId, 1_300],
    ]);
    await asStaff.mutation(api.guarantees.reviewMutations.markSentForSignature, { publicId });
    expect(await asStaff.query(api.guarantees.reviewQueries.listAwaitingDispatch, {})).toEqual([]);
  });

  test("getAnalysisDetail returns the case file with every bureau signal", async () => {
    const w = await world();
    const publicId = await createDraft(w);
    await w.t.run(async (ctx) => {
      const row = await ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique();
      if (!row?.underwriting.assessmentId) throw new Error("no assessment");
      const signalId = await ctx.db.insert("creditAnalysisSignals", {
        agencyId: w.agencyId,
        subjectType: "tenant",
        subjectHash: "h",
        capability: "credit_score",
        provider: "mock",
        status: "ok",
        normalized: { score: 750, scale: 1000 },
        correlationId: "c",
        windowKey: "2026-10-01",
        pulledAt: 1,
      });
      await ctx.db.patch(row.underwriting.assessmentId, { signalIds: [signalId] });
    });
    await requestAnalysisFor(w, publicId);

    const detail = await w.t
      .withIdentity({ subject: w.compliance.subject })
      .query(api.guarantees.reviewQueries.getAnalysisDetail, { publicId });
    expect(detail?.tenant).toEqual({
      entityType: "pf",
      taxId: VALID_CPF,
      fullName: "Maria Silva Santos",
      email: "maria@example.com",
      phone: "11900000001",
    });
    expect(detail?.credit).toMatchObject({
      score: 750,
      tier: "regular",
      provider: "mock",
      isMock: true,
      signals: [{ provider: "mock", status: "ok", score: 750, scale: 1000, pulledAt: 1 }],
    });
    expect(detail?.review.status).toBe("analysis_requested");
    expect(detail?.lease.rent.rentCents).toBe(RENT_CENTS);
    expect(detail?.history.map((h) => h.message)).toContain("Análise Mutav solicitada");
  });

  test("getAnalysisDetail is null for an unknown publicId", async () => {
    const w = await world();
    expect(
      await w.t
        .withIdentity({ subject: w.compliance.subject })
        .query(api.guarantees.reviewQueries.getAnalysisDetail, { publicId: "missing" }),
    ).toBeNull();
  });

  test("support staff cannot read the queue or a case file", async () => {
    const w = await world();
    const asSupport = w.t.withIdentity({ subject: w.support.subject });
    await expect(
      asSupport.query(api.guarantees.reviewQueries.listAnalysisQueue, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Requires 'compliance' role or higher/);
    await expect(
      asSupport.query(api.guarantees.reviewQueries.getAnalysisDetail, { publicId: "x" }),
    ).rejects.toThrow(/Requires 'compliance' role or higher/);
  });

  test("the agency detail view exposes the review: status, staff rate and refusal reason", async () => {
    const w = await world();
    const accepted = await createDraft(w);
    await requestAnalysisFor(w, accepted);
    await acceptFor(w, accepted, 1_300);
    const refused = await createDraft(w, { cpf: OTHER_CPF });
    await requestAnalysisFor(w, refused);
    await w.t
      .withIdentity({ subject: w.compliance.subject })
      .mutation(api.guarantees.reviewMutations.refuseAnalysis, {
        publicId: refused,
        reason: "Renda insuficiente",
      });

    const asOwner = w.t.withIdentity({ subject: w.owner.subject });
    const acceptedView = await asOwner.query(api.guarantees.useCases.getByPublicId, {
      publicId: accepted,
    });
    expect(acceptedView?.review).toEqual({
      status: "accepted",
      requestedAt: START,
      decidedAt: START,
      acceptedFeeRateBps: 1_300,
      refusalReason: null,
      sentForSignatureAt: null,
    });
    const refusedView = await asOwner.query(api.guarantees.useCases.getByPublicId, {
      publicId: refused,
    });
    expect(refusedView?.status).toBe("closed");
    expect(refusedView?.review.status).toBe("refused");
    expect(refusedView?.review.refusalReason).toBe("Renda insuficiente");
  });
});
