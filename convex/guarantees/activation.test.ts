// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { AgencyId, OnboardingState } from "../agencies/domain";
import type { UserId } from "../users/domain";
import type { MutavStaffRole } from "../mutavStaff/domain";
import type { OfferHold } from "../reserve/domain";
import { registerGuaranteeAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import {
  GUARANTEE_STATE,
  type Guarantee,
  type GuaranteeDocument,
  type GuaranteeDocumentId,
  type GuaranteeId,
  type GuaranteeState,
} from "./domain";
import type { ReviewStatus } from "./review";
import schema from "../schema";

type T = TestConvex<typeof schema>;

const RENT_CENTS = 100_000;
// 30× and 6× the fixture rent under the default product.
const CEILING_CENTS = 3_000_000;
// ceil(2_500 × (3_000_000 + 600_000) / 10_000): one fixture guarantee's cover × c.
const OWN_REQUIREMENT_CENTS = 900_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const STAFF_SUBJECT = "auth0|staff-activation";

function setup(): T {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

/** A vault balance the reserve reader would record — written directly, no sweep scheduled. */
async function setBalance(t: T, balanceCents: number, takenAt = Date.now()): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("reserveBalanceSnapshots", {
      balanceCents,
      takenAt,
      source: "squads_vault",
    });
  });
}

type Fixture = { subject: string; userId: UserId; agencyId: AgencyId };

async function makeAgency(
  t: T,
  suffix: string,
  onboardingState: OnboardingState = "active",
): Promise<Fixture> {
  const subject = `auth0|agency-user-${suffix}`;
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `user-${suffix}`,
      subject,
      name: `Agency User ${suffix}`,
      email: `agency-${suffix}@test.br`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: `Agency ${suffix}`,
      cnpj: `0000000000000${suffix}`.slice(-14),
      agencyType: "empresa",
      email: `agency-${suffix}@agency.test.br`,
      onboardingState,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: "owner",
      joinedAt: "2026-01-01T00:00:00.000Z",
    });
    return { userId, agencyId };
  });
  return { subject, ...ids };
}

async function makeStaff(t: T, role: MutavStaffRole, subject = STAFF_SUBJECT): Promise<UserId> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `staff-${role}-${subject}`,
      subject,
      name: `Staff ${role}`,
      email: `staff-${role}@mutav.test`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("mutavStaff", { userId, role, createdAt: "2026-01-01T00:00:00.000Z" });
    return userId;
  });
}

async function seedDraft(
  t: T,
  fx: Fixture,
  publicId: string,
  {
    review = "awaiting_capacity",
    status = GUARANTEE_STATE.DRAFTED,
    availableCents,
    requestedAt,
  }: {
    review?: ReviewStatus;
    status?: GuaranteeState;
    availableCents?: number;
    requestedAt?: string;
  } = {},
) {
  const seeded = await seedGuaranteeWithLease(
    t,
    {
      agencyId: fx.agencyId,
      status,
      review,
      rentCents: RENT_CENTS,
      tenantTaxId: "11144477735",
      activatedAt: status === GUARANTEE_STATE.DRAFTED ? null : "2026-02-01T00:00:00.000Z",
      ...(availableCents === undefined ? {} : { availableCents }),
    },
    publicId,
  );
  if (requestedAt !== undefined) {
    await t.run(async (ctx) => {
      const row = await ctx.db.get(seeded.guaranteeId);
      if (!row) throw new Error("guarantee vanished");
      await ctx.db.patch(row._id, {
        underwriting: {
          ...row.underwriting,
          analysisRequest: { requestedAt, requestedBy: fx.userId },
        },
      });
    });
  }
  return seeded;
}

async function insertRentalContract(
  t: T,
  {
    fx,
    guaranteeId,
    status,
  }: { fx: Fixture; guaranteeId: GuaranteeId; status: GuaranteeDocument["status"] },
): Promise<GuaranteeDocumentId> {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" }),
    );
    return ctx.db.insert("guaranteeDocuments", {
      guaranteeId,
      agencyId: fx.agencyId,
      key: "rentalContract",
      storageId,
      fileName: "contrato-assinado.pdf",
      contentType: "application/pdf",
      sizeBytes: 4,
      uploadedBy: { kind: "agency_user", userId: fx.userId },
      uploadedAt: "2026-10-01T00:00:00.000Z",
      status,
    });
  });
}

async function insertHold(
  t: T,
  {
    fx,
    guaranteeId,
    amountCents = OWN_REQUIREMENT_CENTS,
    expiresInMs,
    signed = false,
  }: {
    fx: Fixture;
    guaranteeId: GuaranteeId;
    amountCents?: number;
    expiresInMs: number;
    signed?: boolean;
  },
) {
  const now = Date.now();
  return t.run((ctx) =>
    ctx.db.insert("offerHolds", {
      guaranteeId,
      agencyId: fx.agencyId,
      amountCents,
      holdDays: 7,
      createdAt: now - 7 * DAY_MS,
      expiresAt: now + expiresInMs,
      ...(signed ? { signedAt: now - DAY_MS } : {}),
    }),
  );
}

async function readGuarantee(t: T, guaranteeId: GuaranteeId): Promise<Guarantee> {
  const doc = await t.run((ctx) => ctx.db.get(guaranteeId));
  if (!doc) throw new Error("guarantee vanished");
  return doc;
}

async function holdsOf(t: T, guaranteeId: GuaranteeId): Promise<OfferHold[]> {
  return t.run((ctx) =>
    ctx.db
      .query("offerHolds")
      .withIndex("by_guarantee", (q) => q.eq("guaranteeId", guaranteeId))
      .collect(),
  );
}

async function auditRows(t: T, publicId: string) {
  return t.run((ctx) =>
    ctx.db
      .query("mutavAuditLog")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "guarantees").eq("resourceId", publicId),
      )
      .collect(),
  );
}

async function historyMessages(t: T, fx: Fixture, publicId: string): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("guaranteeHistory")
      .withIndex("by_agency_guarantee", (q) =>
        q.eq("agencyId", fx.agencyId).eq("guaranteePublicId", publicId),
      )
      .collect(),
  );
  return rows.map((row) => row.message);
}

/** The creation event that carries the agency-submitted tenant, as `create` writes it. */
async function insertCreationEvent(t: T, fx: Fixture, publicId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("guaranteeHistory", {
      agencyId: fx.agencyId,
      guaranteePublicId: publicId,
      at: "2026-10-01T00:00:00.000Z",
      username: "ana",
      message: "Garantia criada",
      tenantSnapshot: {
        entityType: "pf",
        taxId: "11144477735",
        fullName: "Maria Silva",
        email: "maria@example.com",
        phone: "11900000001",
        birthDate: "1990-01-01",
      },
    });
  });
}

async function scheduledJobs(t: T) {
  return t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
}

async function scheduledNames(t: T): Promise<string[]> {
  return (await scheduledJobs(t)).map((job) => job.name);
}

// ---------------------------------------------------------------------------

describe("guarantees.activation.sendForSignature", () => {
  let t: T;
  let fx: Fixture;
  let staffId: UserId;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    staffId = await makeStaff(t, "compliance");
  });

  const send = (publicId: string, offerHoldDays?: number) =>
    t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.activation.sendForSignature, {
        publicId,
        ...(offerHoldDays === undefined ? {} : { offerHoldDays }),
      });

  test("accepted → awaiting_signature, holding cover × c for the default 7 days", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SND1", { review: "accepted" });
    await insertCreationEvent(t, fx, "SND1");
    await setBalance(t, OWN_REQUIREMENT_CENTS);
    const before = Date.now();

    const result = await send("SND1");

    expect(result).toMatchObject({
      success: true,
      data: {
        publicId: "SND1",
        resent: false,
        holdDays: 7,
        holdDaysSource: "default",
        amountCents: OWN_REQUIREMENT_CENTS,
      },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.underwriting.review).toBe("awaiting_signature");
    expect(after.underwriting.signatureRequest?.sentBy).toBe(staffId);
    const [hold] = await holdsOf(t, guaranteeId);
    expect(hold).toMatchObject({
      amountCents: OWN_REQUIREMENT_CENTS,
      holdDays: 7,
      agencyId: fx.agencyId,
    });
    expect(hold?.expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(hold?.releasedAt).toBeUndefined();
    expect(await historyMessages(t, fx, "SND1")).toContain("Contrato enviado para assinatura");
    expect(await scheduledNames(t)).toContain("guarantees/actions:sendProposalNotifications");
    const sent = (await auditRows(t, "SND1")).find(
      (row) => row.action === "guarantee.sent_for_signature",
    );
    expect(sent?.actor).toEqual({ kind: "user", userId: staffId });
  });

  test("INSUFFICIENT_FREE_CAPITAL one cent short, and nothing is written", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SND2", { review: "accepted" });
    await setBalance(t, OWN_REQUIREMENT_CENTS - 1);

    const result = await send("SND2");

    expect(result).toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_FREE_CAPITAL", shortfallCents: 1 },
    });
    expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe("accepted");
    expect(await holdsOf(t, guaranteeId)).toEqual([]);
    expect(await auditRows(t, "SND2")).toEqual([]);
  });

  test("the on-risk book's required coverage counts against the balance", async () => {
    await seedDraft(t, fx, "SND3A", { status: GUARANTEE_STATE.ACTIVE });
    await seedDraft(t, fx, "SND3B", { review: "accepted" });
    await setBalance(t, 2 * OWN_REQUIREMENT_CENTS - 1);

    expect(await send("SND3B")).toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_FREE_CAPITAL", shortfallCents: 1 },
    });

    await setBalance(t, 2 * OWN_REQUIREMENT_CENTS);
    expect((await send("SND3B")).success).toBe(true);
  });

  test("another offer's active hold counts against free capital", async () => {
    const other = await seedDraft(t, fx, "SND4A", { review: "awaiting_signature" });
    await insertHold(t, {
      fx,
      guaranteeId: other.guaranteeId,
      amountCents: 1,
      expiresInMs: DAY_MS,
    });
    await seedDraft(t, fx, "SND4B", { review: "accepted" });
    await setBalance(t, OWN_REQUIREMENT_CENTS);

    expect(await send("SND4B")).toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_FREE_CAPITAL" },
    });
  });

  test("a lapsed hold no longer counts, even before the sweep writes it", async () => {
    const other = await seedDraft(t, fx, "SND5A", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId: other.guaranteeId, expiresInMs: -1 });
    await seedDraft(t, fx, "SND5B", { review: "accepted" });
    await setBalance(t, OWN_REQUIREMENT_CENTS);

    expect((await send("SND5B")).success).toBe(true);
  });

  test("a hold pinned by a signature keeps counting after its period", async () => {
    const other = await seedDraft(t, fx, "SND6A");
    await insertHold(t, { fx, guaranteeId: other.guaranteeId, expiresInMs: -DAY_MS, signed: true });
    await seedDraft(t, fx, "SND6B", { review: "accepted" });
    await setBalance(t, OWN_REQUIREMENT_CENTS);

    expect(await send("SND6B")).toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_FREE_CAPITAL" },
    });
  });

  test("RESERVE_BALANCE_UNAVAILABLE with no balance, or only a stale one: fail closed", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SND7", { review: "accepted" });

    expect(await send("SND7")).toMatchObject({
      success: false,
      error: { code: "RESERVE_BALANCE_UNAVAILABLE" },
    });
    await setBalance(t, 10 ** 12, Date.now() - 31 * MINUTE_MS);
    expect(await send("SND7")).toMatchObject({
      success: false,
      error: { code: "RESERVE_BALANCE_UNAVAILABLE" },
    });
    expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe("accepted");
    expect(await holdsOf(t, guaranteeId)).toEqual([]);
  });

  test("the coverage ratio setting sizes the hold", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SND8", { review: "accepted" });
    await t.mutation(internal.reserve.balance.setCoverageRatioBps, { coverageRatioBps: 5_000 });
    await setBalance(t, 10 ** 12);

    expect(await send("SND8")).toMatchObject({ data: { amountCents: 1_800_000 } });
    expect((await holdsOf(t, guaranteeId))[0]?.amountCents).toBe(1_800_000);
  });

  test("the hold period resolves contract ?? agency ?? product ?? platform", async () => {
    await setBalance(t, 10 ** 12);
    const platform = await seedDraft(t, fx, "HD1", { review: "accepted" });
    await t.mutation(internal.reserve.offerHolds.setPlatformOfferHoldDays, { offerHoldDays: 10 });
    expect(await send("HD1")).toMatchObject({ data: { holdDays: 10, holdDaysSource: "platform" } });
    expect((await holdsOf(t, platform.guaranteeId))[0]?.holdDays).toBe(10);

    const product = await seedDraft(t, fx, "HD2", { review: "accepted" });
    await t.mutation(internal.reserve.offerHolds.setProductOfferHoldDays, {
      productId: product.productId,
      offerHoldDays: 5,
    });
    expect(await send("HD2")).toMatchObject({ data: { holdDays: 5, holdDaysSource: "product" } });

    await seedDraft(t, fx, "HD3", { review: "accepted" });
    await t.mutation(internal.reserve.offerHolds.setAgencyOfferHoldDays, {
      agencyId: fx.agencyId,
      offerHoldDays: 3,
    });
    expect(await send("HD3")).toMatchObject({ data: { holdDays: 3, holdDaysSource: "agency" } });

    await seedDraft(t, fx, "HD4", { review: "accepted" });
    expect(await send("HD4", 2)).toMatchObject({
      data: { holdDays: 2, holdDaysSource: "contract" },
    });
  });

  test("INVALID_HOLD_DAYS for a contract override out of range", async () => {
    await seedDraft(t, fx, "HD5", { review: "accepted" });
    await setBalance(t, 10 ** 12);

    expect(await send("HD5", 0)).toMatchObject({
      success: false,
      error: { code: "INVALID_HOLD_DAYS" },
    });
    expect(await send("HD5", 91)).toMatchObject({ error: { code: "INVALID_HOLD_DAYS" } });
  });

  test("OFFER_STILL_HELD: no re-send while the hold is live", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "RS1", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS });
    await setBalance(t, 10 ** 12);

    expect(await send("RS1")).toMatchObject({
      success: false,
      error: { code: "OFFER_STILL_HELD" },
    });
  });

  test("a re-send after the hold lapsed re-runs the preflight and replaces the hold", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "RS2", { review: "awaiting_signature" });
    await insertCreationEvent(t, fx, "RS2");
    const lapsedId = await insertHold(t, { fx, guaranteeId, expiresInMs: -1 });
    await setBalance(t, OWN_REQUIREMENT_CENTS);

    const result = await send("RS2");

    expect(result).toMatchObject({ success: true, data: { resent: true } });
    const holds = await holdsOf(t, guaranteeId);
    expect(holds).toHaveLength(2);
    expect(holds.find((hold) => hold._id === lapsedId)).toMatchObject({ releaseReason: "resent" });
    expect(holds.find((hold) => hold._id !== lapsedId)?.releasedAt).toBeUndefined();
    expect(await historyMessages(t, fx, "RS2")).toContain("Contrato reenviado para assinatura");
    // The tenant was notified on the first send; a re-send does not notify again.
    expect(await scheduledNames(t)).not.toContain("guarantees/actions:sendProposalNotifications");
  });

  test("a re-send that no longer fits keeps the review and the lapsed hold untouched", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "RS3", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: -1 });
    await setBalance(t, 0);

    expect(await send("RS3")).toMatchObject({ error: { code: "INSUFFICIENT_FREE_CAPITAL" } });
    const holds = await holdsOf(t, guaranteeId);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.releasedAt).toBeUndefined();
  });

  test("REVIEW_ILLEGAL_TRANSITION before acceptance", async () => {
    await seedDraft(t, fx, "SND9", { review: "analysis_requested" });
    await setBalance(t, 10 ** 12);
    expect(await send("SND9")).toMatchObject({
      success: false,
      error: { code: "REVIEW_ILLEGAL_TRANSITION" },
    });
  });

  test("NOT_DRAFTED and NOT_FOUND", async () => {
    await seedDraft(t, fx, "SND10", { status: GUARANTEE_STATE.ACTIVE });
    await setBalance(t, 10 ** 12);
    expect(await send("SND10")).toMatchObject({ error: { code: "NOT_DRAFTED" } });
    expect(await send("NOPE")).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("support staff, agency members and anonymous callers are refused", async () => {
    await seedDraft(t, fx, "SND11", { review: "accepted" });
    await makeStaff(t, "support", "auth0|staff-support");
    await setBalance(t, 10 ** 12);

    await expect(
      t
        .withIdentity({ subject: "auth0|staff-support" })
        .mutation(api.guarantees.activation.sendForSignature, { publicId: "SND11" }),
    ).rejects.toThrow(/compliance/);
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.guarantees.activation.sendForSignature, { publicId: "SND11" }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.guarantees.activation.sendForSignature, { publicId: "SND11" }),
    ).rejects.toThrow();
  });
});

describe("approving the signed rental contract activates on capacity", () => {
  let t: T;
  let fx: Fixture;
  let staffId: UserId;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    staffId = await makeStaff(t, "compliance");
  });

  const approve = (documentId: GuaranteeDocumentId) =>
    t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });

  async function offeredDraft(publicId: string, fixture: Fixture = fx) {
    const seeded = await seedDraft(t, fixture, publicId, { review: "awaiting_signature" });
    await insertHold(t, { fx: fixture, guaranteeId: seeded.guaranteeId, expiresInMs: DAY_MS });
    const documentId = await insertRentalContract(t, {
      fx: fixture,
      guaranteeId: seeded.guaranteeId,
      status: "pending_review",
    });
    return { ...seeded, documentId };
  }

  test("with room: drafted → active, billing starts, the own hold is released", async () => {
    const { guaranteeId, documentId } = await offeredDraft("ACT1");
    await setBalance(t, OWN_REQUIREMENT_CENTS);

    const result = await approve(documentId);

    expect(result).toMatchObject({
      success: true,
      data: { reviewSigned: true, activation: { outcome: "activated" } },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("active");
    expect(after.activatedAt).not.toBeNull();
    expect(after.underwriting.review).toBe("signed");
    expect(after.underwriting.signedAt).toEqual(expect.any(String));
    expect(after.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS,
      reservedCents: 0,
    });
    expect(after.activationFee).toEqual({ status: "pending" });
    expect(after.activationCheck).toMatchObject({
      outcome: "passed",
      balanceCents: OWN_REQUIREMENT_CENTS,
      coverageRatioBps: 2_500,
      requiredCoverageCents: 0,
      activeHoldsCents: 0,
      freeCapitalCents: OWN_REQUIREMENT_CENTS,
      ownRequirementCents: OWN_REQUIREMENT_CENTS,
      shortfallCents: 0,
    });
    expect((await holdsOf(t, guaranteeId))[0]).toMatchObject({ releaseReason: "activated" });
    const messages = await historyMessages(t, fx, "ACT1");
    expect(messages).toContain("Contrato assinado registrado");
    expect(messages).toContain("Garantia ativada");
    const rows = await auditRows(t, "ACT1");
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["guarantee.signed", "guarantee.transitioned", "guarantee.activated"]),
    );
    expect(rows.find((row) => row.action === "guarantee.activated")?.actor).toEqual({
      kind: "user",
      userId: staffId,
    });
    expect(await scheduledNames(t)).toContain(
      "guarantees/actions:sendGuaranteeActivatedNotification",
    );
  });

  test("its own hold is excluded from its activation; every other hold counts", async () => {
    const { guaranteeId, documentId } = await offeredDraft("ACT2");
    // Exactly the own requirement: passes only because the own hold is excluded.
    await setBalance(t, OWN_REQUIREMENT_CENTS);
    const other = await seedDraft(t, fx, "ACT2B", { review: "awaiting_signature" });
    await insertHold(t, {
      fx,
      guaranteeId: other.guaranteeId,
      amountCents: 1,
      expiresInMs: DAY_MS,
    });

    const result = await approve(documentId);

    expect(result).toMatchObject({ data: { activation: { outcome: "awaiting_capacity" } } });
    expect((await readGuarantee(t, guaranteeId)).activationCheck).toMatchObject({
      activeHoldsCents: 1,
      shortfallCents: 1,
    });
  });

  test("short of capital: awaiting_capacity, still drafted, hold pinned and kept", async () => {
    const { guaranteeId, documentId } = await offeredDraft("ACT3");
    await seedDraft(t, fx, "ACT3B", { status: GUARANTEE_STATE.ACTIVE });
    await setBalance(t, OWN_REQUIREMENT_CENTS + 500_000);

    const result = await approve(documentId);

    expect(result).toMatchObject({
      success: true,
      data: {
        reviewSigned: true,
        activation: {
          outcome: "awaiting_capacity",
          reason: "INSUFFICIENT_FREE_CAPITAL",
          shortfallCents: 400_000,
        },
      },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("drafted");
    expect(after.underwriting.review).toBe("awaiting_capacity");
    expect(after.activationFee).toBeUndefined();
    expect(after.activationCheck).toMatchObject({
      outcome: "insufficient_capacity",
      balanceCents: 1_400_000,
      requiredCoverageCents: OWN_REQUIREMENT_CENTS,
      freeCapitalCents: 500_000,
      ownRequirementCents: OWN_REQUIREMENT_CENTS,
      shortfallCents: 400_000,
    });
    const [hold] = await holdsOf(t, guaranteeId);
    expect(hold?.signedAt).toEqual(expect.any(Number));
    expect(hold?.releasedAt).toBeUndefined();
    expect(await historyMessages(t, fx, "ACT3")).toContain("Aguardando capacidade da reserva");
    const actions = (await auditRows(t, "ACT3")).map((row) => row.action);
    expect(actions).toContain("guarantee.awaiting_capacity");
    expect(actions).not.toContain("guarantee.activated");
  });

  test("no fresh balance: awaiting_capacity, failing closed", async () => {
    const { guaranteeId, documentId } = await offeredDraft("ACT4");
    await setBalance(t, 10 ** 12, Date.now() - 31 * MINUTE_MS);

    const result = await approve(documentId);

    expect(result).toMatchObject({
      data: {
        activation: {
          outcome: "awaiting_capacity",
          reason: "RESERVE_BALANCE_UNAVAILABLE",
          shortfallCents: null,
        },
      },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("drafted");
    expect(after.activationCheck).toEqual({
      outcome: "reserve_unavailable",
      checkedAt: expect.any(String),
    });
  });

  test("an inactive agency keeps the draft signed and unactivated; the approval stands", async () => {
    const suspended = await makeAgency(t, "2", "rejected");
    const { guaranteeId, documentId } = await offeredDraft("ACT5", suspended);
    await setBalance(t, 10 ** 12);

    const result = await approve(documentId);

    expect(result).toMatchObject({
      success: true,
      data: { status: "approved", reviewSigned: true, activation: null },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("drafted");
    expect(after.underwriting.review).toBe("signed");
  });

  test("a lapsed hold is not pinned, and the capacity check is the final word", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT6", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: -1 });
    const documentId = await insertRentalContract(t, { fx, guaranteeId, status: "pending_review" });
    await setBalance(t, OWN_REQUIREMENT_CENTS);

    await approve(documentId);

    expect((await readGuarantee(t, guaranteeId)).status).toBe("active");
    expect((await holdsOf(t, guaranteeId))[0]?.signedAt).toBeUndefined();
  });

  test.each<ReviewStatus>(["editing", "analysis_requested", "accepted"])(
    "leaves the review at %s untouched",
    async (review) => {
      const { guaranteeId } = await seedDraft(t, fx, `SIG-${review}`, { review });
      const documentId = await insertRentalContract(t, {
        fx,
        guaranteeId,
        status: "pending_review",
      });
      await setBalance(t, 10 ** 12);

      const result = await approve(documentId);

      expect(result).toMatchObject({
        success: true,
        data: { reviewSigned: false, activation: null },
      });
      const after = await readGuarantee(t, guaranteeId);
      expect(after.underwriting.review).toBe(review);
      expect(after.status).toBe("drafted");
      const actions = (await auditRows(t, `SIG-${review}`)).map((row) => row.action);
      expect(actions).not.toContain("guarantee.signed");
    },
  );

  test("approving another document kind does not sign the review", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SIG3", { review: "awaiting_signature" });
    const documentId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"], { type: "application/pdf" }));
      return ctx.db.insert("guaranteeDocuments", {
        guaranteeId,
        agencyId: fx.agencyId,
        key: "inspection",
        storageId,
        fileName: "vistoria.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        uploadedBy: { kind: "agency_user", userId: fx.userId },
        uploadedAt: "2026-10-01T00:00:00.000Z",
        status: "pending_review",
      });
    });
    await setBalance(t, 10 ** 12);

    expect(await approve(documentId)).toMatchObject({ data: { reviewSigned: false } });
    expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe("awaiting_signature");
  });
});

describe("guarantees.activation.retryActivation", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    await makeStaff(t, "compliance");
  });

  const retry = (publicId: string) =>
    t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.activation.retryActivation, { publicId });

  async function waitingDraft(publicId: string, fixture: Fixture = fx) {
    const seeded = await seedDraft(t, fixture, publicId);
    await insertRentalContract(t, {
      fx: fixture,
      guaranteeId: seeded.guaranteeId,
      status: "approved",
    });
    return seeded;
  }

  test("a new balance with room activates the waiting draft and moves the review back to signed", async () => {
    const { guaranteeId } = await waitingDraft("RTY1");
    await insertHold(t, { fx, guaranteeId, expiresInMs: -DAY_MS, signed: true });
    await setBalance(t, OWN_REQUIREMENT_CENTS);

    expect(await retry("RTY1")).toMatchObject({
      success: true,
      data: { outcome: "activated" },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("active");
    expect(after.underwriting.review).toBe("signed");
    expect(after.activationFee).toEqual({ status: "pending" });
    expect((await holdsOf(t, guaranteeId))[0]).toMatchObject({ releaseReason: "activated" });
  });

  test("still short: keeps waiting, refreshes the figures, writes no new audit entry", async () => {
    const { guaranteeId } = await waitingDraft("RTY2");
    await setBalance(t, OWN_REQUIREMENT_CENTS - 250);

    expect(await retry("RTY2")).toMatchObject({
      success: true,
      data: {
        outcome: "awaiting_capacity",
        reason: "INSUFFICIENT_FREE_CAPITAL",
        shortfallCents: 250,
      },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("drafted");
    expect(after.underwriting.review).toBe("awaiting_capacity");
    expect(after.activationCheck).toMatchObject({ shortfallCents: 250 });
    expect(await auditRows(t, "RTY2")).toEqual([]);
  });

  test("idempotent: a guarantee already on risk is NOT_DRAFTED and nothing moves", async () => {
    const { guaranteeId } = await waitingDraft("RTY3");
    await setBalance(t, 10 ** 12);
    expect((await retry("RTY3")).success).toBe(true);
    const activatedAt = (await readGuarantee(t, guaranteeId)).activatedAt;

    expect(await retry("RTY3")).toMatchObject({
      success: false,
      error: { code: "NOT_DRAFTED" },
    });
    expect((await readGuarantee(t, guaranteeId)).activatedAt).toBe(activatedAt);
    const activations = (await auditRows(t, "RTY3")).filter(
      (row) => row.action === "guarantee.activated",
    );
    expect(activations).toHaveLength(1);
  });

  test("REVIEW_NOT_SIGNED while the contract is still out for signature", async () => {
    await waitingDraft("RTY4");
    await seedDraft(t, fx, "RTY4B", { review: "awaiting_signature" });
    await setBalance(t, 10 ** 12);
    expect(await retry("RTY4B")).toMatchObject({
      success: false,
      error: { code: "REVIEW_NOT_SIGNED" },
    });
  });

  test("SIGNED_CONTRACT_NOT_APPROVED with no approved contract", async () => {
    await seedDraft(t, fx, "RTY5");
    await setBalance(t, 10 ** 12);
    expect(await retry("RTY5")).toMatchObject({
      error: { code: "SIGNED_CONTRACT_NOT_APPROVED" },
    });
  });

  test("AGENCY_NOT_ACTIVE when the agency lost its active onboarding", async () => {
    const suspended = await makeAgency(t, "2", "rejected");
    await waitingDraft("RTY6", suspended);
    await setBalance(t, 10 ** 12);
    expect(await retry("RTY6")).toMatchObject({ error: { code: "AGENCY_NOT_ACTIVE" } });
  });

  test("NOT_FOUND for an unknown guarantee", async () => {
    expect(await retry("NOPE")).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("CAPACITY_INVARIANT_BROKEN for a draft that carries reserved cents", async () => {
    const { guaranteeId } = await waitingDraft("RTY7");
    await t.run(async (ctx) => {
      await ctx.db.patch(guaranteeId, {
        capacity: { ceilingCents: CEILING_CENTS, availableCents: 0, reservedCents: CEILING_CENTS },
      });
    });
    await setBalance(t, 10 ** 12);

    expect(await retry("RTY7")).toMatchObject({
      success: false,
      error: { code: "CAPACITY_INVARIANT_BROKEN" },
    });
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });

  test("support staff and agency members are refused", async () => {
    await waitingDraft("RTY8");
    await makeStaff(t, "support", "auth0|staff-support");

    await expect(
      t
        .withIdentity({ subject: "auth0|staff-support" })
        .mutation(api.guarantees.activation.retryActivation, { publicId: "RTY8" }),
    ).rejects.toThrow(/compliance/);
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.guarantees.activation.retryActivation, { publicId: "RTY8" }),
    ).rejects.toThrow();
  });
});

describe("a new reserve balance retries the waiting guarantees", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
  });

  async function waitingDraft(publicId: string, requestedAt: string) {
    const seeded = await seedDraft(t, fx, publicId, { requestedAt });
    await insertRentalContract(t, { fx, guaranteeId: seeded.guaranteeId, status: "approved" });
    return seeded;
  }

  /** Run the sweep chain the way the scheduler would, one mutation per guarantee. */
  async function runSweep(): Promise<Array<string | null>> {
    const attempted: Array<string | null> = [];
    let cursor: string | null = null;
    for (;;) {
      const run: { attempted: string | null; done: boolean } = await t.mutation(
        internal.guarantees.activation.retryAwaitingCapacity,
        { cursor },
      );
      attempted.push(run.attempted);
      if (run.done) return attempted;
      const next = (await scheduledJobs(t))
        .filter((job) => job.name === "guarantees/activation:retryAwaitingCapacity")
        .at(-1);
      const args: unknown = next?.args[0];
      if (typeof args !== "object" || args === null || !("cursor" in args)) {
        throw new Error("the sweep did not schedule its next step");
      }
      cursor = typeof args.cursor === "string" ? args.cursor : null;
    }
  }

  test("recordReserveBalance stores the reading and schedules the sweep", async () => {
    const takenAt = Date.now() - MINUTE_MS;
    const result = await t.mutation(internal.reserve.balance.recordReserveBalance, {
      balanceCents: 12_345,
      takenAt,
    });

    expect(result).toMatchObject({ success: true });
    const rows = await t.run((ctx) => ctx.db.query("reserveBalanceSnapshots").collect());
    expect(rows.map((row) => [row.balanceCents, row.takenAt, row.source])).toEqual([
      [12_345, takenAt, "squads_vault"],
    ]);
    const jobs = await scheduledJobs(t);
    expect(jobs.map((job) => [job.name, job.args])).toEqual([
      ["guarantees/activation:retryAwaitingCapacity", [{ cursor: null }]],
    ]);
  });

  test.each([
    ["a negative balance", { balanceCents: -1, takenAt: 1 }],
    ["fractional cents", { balanceCents: 1.5, takenAt: 1 }],
    ["a reading from the future", { balanceCents: 1, takenAt: Date.now() + DAY_MS }],
  ])("recordReserveBalance refuses %s and writes nothing", async (_label, args) => {
    expect(await t.mutation(internal.reserve.balance.recordReserveBalance, args)).toMatchObject({
      success: false,
      error: { code: "INVALID_RESERVE_BALANCE" },
    });
    expect(await t.run((ctx) => ctx.db.query("reserveBalanceSnapshots").collect())).toEqual([]);
    expect(await scheduledJobs(t)).toEqual([]);
  });

  test("oldest request first, each in its own run; the one that no longer fits keeps waiting", async () => {
    const newer = await waitingDraft("SWP2", "2026-10-02T00:00:00.000Z");
    const older = await waitingDraft("SWP1", "2026-10-01T00:00:00.000Z");
    // Room for exactly one: the older request takes it.
    await setBalance(t, OWN_REQUIREMENT_CENTS);

    expect(await runSweep()).toEqual(["SWP1", "SWP2"]);

    expect((await readGuarantee(t, older.guaranteeId)).status).toBe("active");
    const waiting = await readGuarantee(t, newer.guaranteeId);
    expect(waiting.status).toBe("drafted");
    expect(waiting.underwriting.review).toBe("awaiting_capacity");
    expect(waiting.activationCheck).toMatchObject({
      requiredCoverageCents: OWN_REQUIREMENT_CENTS,
      shortfallCents: OWN_REQUIREMENT_CENTS,
    });
    const transitioned = (await auditRows(t, "SWP1")).find(
      (row) => row.action === "guarantee.transitioned",
    );
    expect(transitioned?.actor).toEqual({ kind: "system", source: "reserve_capacity_sweep" });
    expect(await historyMessages(t, fx, "SWP1")).toContain("Garantia ativada");
  });

  test("with nothing waiting the sweep is a single no-op run", async () => {
    await setBalance(t, 10 ** 12);
    expect(await runSweep()).toEqual([null]);
  });
});

describe("reserve settings and offer holds outside the send", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    await makeStaff(t, "compliance");
  });

  test("the coverage ratio setting refuses values out of range and audits a change", async () => {
    expect(
      await t.mutation(internal.reserve.balance.setCoverageRatioBps, { coverageRatioBps: 0 }),
    ).toMatchObject({ success: false, error: { code: "INVALID_COVERAGE_RATIO" } });
    expect(
      await t.mutation(internal.reserve.balance.setCoverageRatioBps, { coverageRatioBps: 10_001 }),
    ).toMatchObject({ success: false });
    expect(
      await t.mutation(internal.reserve.balance.setCoverageRatioBps, { coverageRatioBps: null }),
    ).toMatchObject({ success: true, data: { coverageRatioBps: 2_500 } });
    const audit = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "platformSettings").eq("resourceId", "platform"),
        )
        .collect(),
    );
    expect(audit.map((row) => [row.action, row.actor.kind])).toEqual([
      ["reserve.coverage_ratio_updated", "system"],
    ]);
  });

  test("the agency canceling an offered draft releases its hold as canceled", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "HLD1", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS });

    await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.guarantees.useCases.cancelDraft, { agencyId: fx.agencyId, publicId: "HLD1" });

    expect((await holdsOf(t, guaranteeId))[0]).toMatchObject({ releaseReason: "canceled" });
  });

  test("staff canceling a draft waiting for capacity releases its hold", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "HLD2");
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS, signed: true });

    await t.withIdentity({ subject: STAFF_SUBJECT }).mutation(api.guarantees.mutations.close, {
      publicId: "HLD2",
      reason: "canceled_pre_activation",
    });

    expect((await holdsOf(t, guaranteeId))[0]).toMatchObject({ releaseReason: "canceled" });
  });

  test("the hold sweep releases lapsed holds only, with a system audit entry", async () => {
    const lapsed = await seedDraft(t, fx, "SWH1", { review: "awaiting_signature" });
    const live = await seedDraft(t, fx, "SWH2", { review: "awaiting_signature" });
    const signed = await seedDraft(t, fx, "SWH3");
    const lapsedId = await insertHold(t, { fx, guaranteeId: lapsed.guaranteeId, expiresInMs: -1 });
    await insertHold(t, { fx, guaranteeId: live.guaranteeId, expiresInMs: DAY_MS });
    await insertHold(t, {
      fx,
      guaranteeId: signed.guaranteeId,
      expiresInMs: -DAY_MS,
      signed: true,
    });

    const result = await t.mutation(internal.reserve.offerHolds.sweepExpiredOfferHolds, {});

    expect(result).toEqual({ released: 1 });
    expect((await holdsOf(t, lapsed.guaranteeId))[0]).toMatchObject({ releaseReason: "expired" });
    expect((await holdsOf(t, live.guaranteeId))[0]?.releasedAt).toBeUndefined();
    expect((await holdsOf(t, signed.guaranteeId))[0]?.releasedAt).toBeUndefined();
    const audit = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "offerHolds").eq("resourceId", lapsedId),
        )
        .collect(),
    );
    expect(audit.map((row) => [row.action, row.actor.kind])).toEqual([
      ["offer_hold.released", "system"],
    ]);
  });

  test("hold-period settings refuse values out of range", async () => {
    expect(
      await t.mutation(internal.reserve.offerHolds.setPlatformOfferHoldDays, { offerHoldDays: 0 }),
    ).toMatchObject({ success: false, error: { code: "INVALID_HOLD_DAYS" } });
    expect(
      await t.mutation(internal.reserve.offerHolds.setAgencyOfferHoldDays, {
        agencyId: fx.agencyId,
        offerHoldDays: 1.5,
      }),
    ).toMatchObject({ success: false, error: { code: "INVALID_HOLD_DAYS" } });
    expect(
      await t.mutation(internal.reserve.offerHolds.setPlatformOfferHoldDays, {
        offerHoldDays: null,
      }),
    ).toMatchObject({ success: true, data: { offerHoldDays: null } });
  });
});

describe("activation queries", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    await makeStaff(t, "compliance");
  });

  test("listActivationQueue: the capacity tab holds waiting and blocked signed drafts", async () => {
    const waiting = await seedDraft(t, fx, "Q1");
    await insertRentalContract(t, { fx, guaranteeId: waiting.guaranteeId, status: "approved" });
    const suspended = await makeAgency(t, "2", "rejected");
    const blocked = await seedDraft(t, suspended, "Q5", { review: "signed" });
    await insertRentalContract(t, {
      fx: suspended,
      guaranteeId: blocked.guaranteeId,
      status: "approved",
    });
    const lapsed = await seedDraft(t, fx, "Q2", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId: lapsed.guaranteeId, expiresInMs: -1 });
    await seedDraft(t, fx, "Q3", { review: "accepted" });
    await seedDraft(t, fx, "Q4", { status: GUARANTEE_STATE.ACTIVE });
    const asStaff = t.withIdentity({ subject: STAFF_SUBJECT });

    const capacity = await asStaff.query(api.guarantees.activationQueries.listActivationQueue, {
      review: "awaiting_capacity",
    });
    const awaiting = await asStaff.query(api.guarantees.activationQueries.listActivationQueue, {
      review: "awaiting_signature",
    });

    expect(capacity.rows.map((row) => row.publicId)).toEqual(["Q1", "Q5"]);
    expect(capacity.rows[0]).toMatchObject({
      agencyName: "Agency 1",
      agencyActive: true,
      rentCents: RENT_CENTS,
      signedContract: "approved",
      offerHold: "none",
      activationCheck: null,
      blockers: [],
    });
    expect(capacity.rows[1]?.blockers).toEqual(["AGENCY_NOT_ACTIVE"]);
    expect(awaiting.rows.map((row) => row.publicId)).toEqual(["Q2"]);
    expect(awaiting.rows[0]?.offerHold).toBe("lapsed");
    expect(awaiting.rows[0]?.blockers).toEqual([
      "REVIEW_NOT_SIGNED",
      "SIGNED_CONTRACT_NOT_APPROVED",
    ]);
  });

  test("getActivationDetail carries the capacity check and the hold", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "D1");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS, signed: true });
    await setBalance(t, 100);
    await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.activation.retryActivation, { publicId: "D1" });

    const detail = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .query(api.guarantees.activationQueries.getActivationDetail, { publicId: "D1" });

    expect(detail?.activationCheck).toMatchObject({
      outcome: "insufficient_capacity",
      balanceCents: 100,
      freeCapitalCents: 100,
      ownRequirementCents: OWN_REQUIREMENT_CENTS,
      shortfallCents: OWN_REQUIREMENT_CENTS - 100,
    });
    expect(detail?.offerHold).toMatchObject({
      status: "active",
      amountCents: OWN_REQUIREMENT_CENTS,
    });
    expect(detail?.review.status).toBe("awaiting_capacity");
    expect(detail?.blockers).toEqual([]);
  });

  test("getActivationDetail lists every blocker and returns null on a miss", async () => {
    const suspended = await makeAgency(t, "2", "rejected");
    await seedDraft(t, suspended, "D2", { review: "accepted" });
    const asStaff = t.withIdentity({ subject: STAFF_SUBJECT });

    const detail = await asStaff.query(api.guarantees.activationQueries.getActivationDetail, {
      publicId: "D2",
    });
    const missing = await asStaff.query(api.guarantees.activationQueries.getActivationDetail, {
      publicId: "NOPE",
    });

    expect(detail?.blockers).toEqual([
      "REVIEW_NOT_SIGNED",
      "SIGNED_CONTRACT_NOT_APPROVED",
      "AGENCY_NOT_ACTIVE",
    ]);
    expect(detail?.offerHold).toBeNull();
    expect(detail?.activationCheck).toBeNull();
    expect(missing).toBeNull();
  });

  test("support staff cannot read the activation queue", async () => {
    await makeStaff(t, "support", "auth0|staff-support");
    await expect(
      t
        .withIdentity({ subject: "auth0|staff-support" })
        .query(api.guarantees.activationQueries.listActivationQueue, {
          review: "awaiting_capacity",
        }),
    ).rejects.toThrow(/compliance/);
  });
});

describe("removed activation paths", () => {
  test.each([
    ["guarantees/mutations:staffActivate", "staff"],
    ["guarantees/mutations:activate", "agency"],
  ] as const)("mutation %s no longer exists", async (path, caller) => {
    const t = setup();
    const fx = await makeAgency(t, "1");
    await makeStaff(t, "compliance");
    const { guaranteeId } = await seedDraft(t, fx, "GONE1");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    const removed = makeFunctionReference<"mutation">(path);

    await expect(
      t
        .withIdentity({ subject: caller === "agency" ? fx.subject : STAFF_SUBJECT })
        .mutation(
          removed,
          caller === "agency"
            ? { agencyId: fx.agencyId, publicId: "GONE1" }
            : { publicId: "GONE1" },
        ),
    ).rejects.toThrow();
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });

  test.each([
    ["guarantees/registration:confirmRegistration", { publicId: "GONE2", txSignature: "5" }],
    ["guarantees/registration:sendForSignature", { publicId: "GONE2" }],
  ] as const)("action %s no longer exists", async (path, args) => {
    const t = setup();
    const fx = await makeAgency(t, "1");
    await makeStaff(t, "compliance");
    const { guaranteeId } = await seedDraft(t, fx, "GONE2");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });

    await expect(
      t
        .withIdentity({ subject: STAFF_SUBJECT })
        .action(makeFunctionReference<"action">(path), args),
    ).rejects.toThrow();
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });
});
