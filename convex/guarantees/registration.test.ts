// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { AgencyId, OnboardingState } from "../agencies/domain";
import type { UserId } from "../users/domain";
import type { MutavStaffRole } from "../mutavStaff/domain";
import type { OfferHold } from "../reserve/domain";
import type { Result } from "../lib/result";
import type {
  ExpectedRegistration,
  ReadCapacityError,
  ReserveCapacity,
  VerifiedRegistration,
  VerifyRegistrationError,
} from "../reserve/reader";
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

/**
 * The reserve is read through `reserveReader`; the shipped adapter fails
 * closed, so every test here swaps it for a fake whose answers the test sets.
 */
const reader = vi.hoisted(() => ({
  capacity: null as Result<ReserveCapacity, ReadCapacityError> | null,
  verdict: null as Result<VerifiedRegistration, VerifyRegistrationError> | null,
  verifyCalls: [] as Array<{ txSignature: string; expected: ExpectedRegistration }>,
}));

vi.mock("../reserve/reader", async (importOriginal) => {
  const original = await importOriginal<typeof import("../reserve/reader")>();
  return {
    ...original,
    reserveReader: {
      readCapacity: async () => reader.capacity ?? original.unavailableReserveReader.readCapacity(),
      verifyRegistration: async (txSignature: string, expected: ExpectedRegistration) => {
        reader.verifyCalls.push({ txSignature, expected });
        return (
          reader.verdict ??
          original.unavailableReserveReader.verifyRegistration(txSignature, expected)
        );
      },
    },
  };
});

type T = TestConvex<typeof schema>;

const RENT_CENTS = 100_000;
// 30× and 6× the fixture rent under the default product.
const CEILING_CENTS = 3_000_000;
const DEFAULT_COVER = BigInt(30_000_000_000);
const EXIT_COVER = BigInt(6_000_000_000);
const COVERAGE_RATIO_BPS = 2_500;
// ceil(2_500 × (30e9 + 6e9) / 10_000)
const HOLD_AMOUNT = BigInt(9_000_000_000);
const DAY_MS = 86_400_000;
const STAFF_SUBJECT = "auth0|staff-registration";
const TX_SIGNATURE = "5".repeat(88);
const OTHER_TX_SIGNATURE = "4".repeat(88);

function setCapacity(freeCapitalBaseUnits: bigint, coverageRatioBps = COVERAGE_RATIO_BPS) {
  reader.capacity = {
    success: true,
    data: { freeCapitalBaseUnits, coverageRatioBps },
    message: "fake",
  };
}

function setVerified() {
  reader.verdict = {
    success: true,
    data: { slot: 4242, registeredAt: "2026-10-20T12:00:00.000Z" },
    message: "fake",
  };
}

function setRefused(programErrorCode: number, programErrorName: string) {
  reader.verdict = {
    success: false,
    error: { code: "PROGRAM_ERROR", programErrorCode, programErrorName },
    message: "fake",
  };
}

function setup(): T {
  reader.capacity = null;
  reader.verdict = null;
  reader.verifyCalls = [];
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
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
    review = "pending_registration",
    status = GUARANTEE_STATE.DRAFTED,
    availableCents,
  }: { review?: ReviewStatus; status?: GuaranteeState; availableCents?: number } = {},
) {
  return seedGuaranteeWithLease(
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
    amountBaseUnits = HOLD_AMOUNT,
    expiresInMs,
    signed = false,
  }: {
    fx: Fixture;
    guaranteeId: GuaranteeId;
    amountBaseUnits?: bigint;
    expiresInMs: number;
    signed?: boolean;
  },
) {
  const now = Date.now();
  return t.run((ctx) =>
    ctx.db.insert("offerHolds", {
      guaranteeId,
      agencyId: fx.agencyId,
      amountBaseUnits,
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

// ---------------------------------------------------------------------------

describe("guarantees.registration.sendForSignature", () => {
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
      .action(api.guarantees.registration.sendForSignature, {
        publicId,
        ...(offerHoldDays === undefined ? {} : { offerHoldDays }),
      });

  test("accepted → awaiting_signature, holding cover × c for the default 7 days", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SND1", { review: "accepted" });
    setCapacity(HOLD_AMOUNT);
    const before = Date.now();

    const result = await send("SND1");

    expect(result).toMatchObject({
      success: true,
      data: {
        publicId: "SND1",
        resent: false,
        holdDays: 7,
        holdDaysSource: "default",
        amountBaseUnits: HOLD_AMOUNT.toString(),
      },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.underwriting.review).toBe("awaiting_signature");
    expect(after.underwriting.signatureRequest?.sentBy).toBe(staffId);
    const [hold] = await holdsOf(t, guaranteeId);
    expect(hold).toMatchObject({
      amountBaseUnits: HOLD_AMOUNT,
      holdDays: 7,
      agencyId: fx.agencyId,
    });
    expect(hold?.expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(hold?.releasedAt).toBeUndefined();
    expect(await historyMessages(t, fx, "SND1")).toContain("Contrato enviado para assinatura");
    const sent = (await auditRows(t, "SND1")).find(
      (row) => row.action === "guarantee.sent_for_signature",
    );
    expect(sent?.actor).toEqual({ kind: "user", userId: staffId });
  });

  test("INSUFFICIENT_FREE_CAPITAL one base unit short, and nothing is written", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SND2", { review: "accepted" });
    setCapacity(HOLD_AMOUNT - BigInt(1));

    const result = await send("SND2");

    expect(result).toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_FREE_CAPITAL", shortfallBaseUnits: "1" },
    });
    expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe("accepted");
    expect(await holdsOf(t, guaranteeId)).toEqual([]);
    expect(await auditRows(t, "SND2")).toEqual([]);
  });

  test("another offer's active hold counts against free capital", async () => {
    const other = await seedDraft(t, fx, "SND3A", { review: "awaiting_signature" });
    await insertHold(t, {
      fx,
      guaranteeId: other.guaranteeId,
      amountBaseUnits: BigInt(1),
      expiresInMs: DAY_MS,
    });
    await seedDraft(t, fx, "SND3B", { review: "accepted" });
    setCapacity(HOLD_AMOUNT);

    const result = await send("SND3B");

    expect(result).toMatchObject({ success: false, error: { code: "INSUFFICIENT_FREE_CAPITAL" } });
  });

  test("a lapsed hold no longer counts, even before the sweep writes it", async () => {
    const other = await seedDraft(t, fx, "SND4A", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId: other.guaranteeId, expiresInMs: -1 });
    await seedDraft(t, fx, "SND4B", { review: "accepted" });
    setCapacity(HOLD_AMOUNT);

    expect((await send("SND4B")).success).toBe(true);
  });

  test("a hold pinned by a signature keeps counting after its period", async () => {
    const other = await seedDraft(t, fx, "SND5A");
    await insertHold(t, { fx, guaranteeId: other.guaranteeId, expiresInMs: -DAY_MS, signed: true });
    await seedDraft(t, fx, "SND5B", { review: "accepted" });
    setCapacity(HOLD_AMOUNT);

    expect(await send("SND5B")).toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_FREE_CAPITAL" },
    });
  });

  test("RESERVE_READER_UNAVAILABLE with the shipped adapter: fail closed", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SND6", { review: "accepted" });

    const result = await send("SND6");

    expect(result).toMatchObject({ success: false, error: { code: "RESERVE_READER_UNAVAILABLE" } });
    expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe("accepted");
    expect(await holdsOf(t, guaranteeId)).toEqual([]);
  });

  test("the hold period resolves contract ?? agency ?? product ?? platform", async () => {
    setCapacity(HOLD_AMOUNT * BigInt(10));
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

  test("INVALID_HOLD_DAYS for a contract override out of range, before the chain is read", async () => {
    await seedDraft(t, fx, "HD5", { review: "accepted" });
    setCapacity(HOLD_AMOUNT);

    expect(await send("HD5", 0)).toMatchObject({
      success: false,
      error: { code: "INVALID_HOLD_DAYS" },
    });
    expect(await send("HD5", 91)).toMatchObject({ error: { code: "INVALID_HOLD_DAYS" } });
  });

  test("OFFER_STILL_HELD: no re-send while the hold is live", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "RS1", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS });
    setCapacity(HOLD_AMOUNT * BigInt(10));

    expect(await send("RS1")).toMatchObject({
      success: false,
      error: { code: "OFFER_STILL_HELD" },
    });
  });

  test("a re-send after the hold lapsed re-runs the preflight and replaces the hold", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "RS2", { review: "awaiting_signature" });
    const lapsedId = await insertHold(t, { fx, guaranteeId, expiresInMs: -1 });
    setCapacity(HOLD_AMOUNT);

    const result = await send("RS2");

    expect(result).toMatchObject({ success: true, data: { resent: true } });
    const holds = await holdsOf(t, guaranteeId);
    expect(holds).toHaveLength(2);
    expect(holds.find((hold) => hold._id === lapsedId)).toMatchObject({ releaseReason: "resent" });
    expect(holds.find((hold) => hold._id !== lapsedId)?.releasedAt).toBeUndefined();
    expect(await historyMessages(t, fx, "RS2")).toContain("Contrato reenviado para assinatura");
  });

  test("a re-send that no longer fits keeps the review and the lapsed hold untouched", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "RS3", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: -1 });
    setCapacity(BigInt(0));

    expect(await send("RS3")).toMatchObject({ error: { code: "INSUFFICIENT_FREE_CAPITAL" } });
    const holds = await holdsOf(t, guaranteeId);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.releasedAt).toBeUndefined();
  });

  test("REVIEW_ILLEGAL_TRANSITION before acceptance", async () => {
    await seedDraft(t, fx, "SND7", { review: "analysis_requested" });
    setCapacity(HOLD_AMOUNT);
    expect(await send("SND7")).toMatchObject({
      success: false,
      error: { code: "REVIEW_ILLEGAL_TRANSITION" },
    });
  });

  test("NOT_DRAFTED and NOT_FOUND", async () => {
    await seedDraft(t, fx, "SND8", { status: GUARANTEE_STATE.ACTIVE });
    setCapacity(HOLD_AMOUNT);
    expect(await send("SND8")).toMatchObject({ error: { code: "NOT_DRAFTED" } });
    expect(await send("NOPE")).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("INVALID_RESERVE_READING for a non-positive coverage ratio", async () => {
    await seedDraft(t, fx, "SND9", { review: "accepted" });
    setCapacity(HOLD_AMOUNT, 0);
    expect(await send("SND9")).toMatchObject({ error: { code: "INVALID_RESERVE_READING" } });
  });

  test("support staff and agency members are refused", async () => {
    await seedDraft(t, fx, "SND10", { review: "accepted" });
    await makeStaff(t, "support", "auth0|staff-support");
    setCapacity(HOLD_AMOUNT);

    await expect(
      t
        .withIdentity({ subject: "auth0|staff-support" })
        .action(api.guarantees.registration.sendForSignature, { publicId: "SND10" }),
    ).rejects.toThrow(/compliance/);
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .action(api.guarantees.registration.sendForSignature, { publicId: "SND10" }),
    ).rejects.toThrow();
    await expect(
      t.action(api.guarantees.registration.sendForSignature, { publicId: "SND10" }),
    ).rejects.toThrow();
  });
});

describe("approving the signed rental contract", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    await makeStaff(t, "compliance");
  });

  const approve = (documentId: GuaranteeDocumentId) =>
    t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });

  test("walks awaiting_signature → signed → pending_registration and pins the hold", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SIG1", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS });
    const documentId = await insertRentalContract(t, { fx, guaranteeId, status: "pending_review" });

    const result = await approve(documentId);

    expect(result).toMatchObject({ success: true, data: { reviewSigned: true } });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("drafted");
    expect(after.underwriting.review).toBe("pending_registration");
    expect(after.underwriting.signedAt).toEqual(expect.any(String));
    expect((await holdsOf(t, guaranteeId))[0]?.signedAt).toEqual(expect.any(Number));
    const messages = await historyMessages(t, fx, "SIG1");
    expect(messages).toContain("Contrato assinado registrado");
    expect(messages).toContain("Aguardando registro na reserva");
    const actions = (await auditRows(t, "SIG1")).map((row) => row.action);
    expect(actions).toContain("guarantee.signed");
    expect(actions).toContain("guarantee.registration_queued");
  });

  test("a lapsed hold is not pinned; the chain stays the final check", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SIG2", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: -1 });
    const documentId = await insertRentalContract(t, { fx, guaranteeId, status: "pending_review" });

    await approve(documentId);

    expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe("pending_registration");
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

      const result = await approve(documentId);

      expect(result).toMatchObject({ success: true, data: { reviewSigned: false } });
      expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe(review);
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

    expect(await approve(documentId)).toMatchObject({ data: { reviewSigned: false } });
    expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe("awaiting_signature");
  });
});

describe("guarantees.registration.confirmRegistration", () => {
  let t: T;
  let fx: Fixture;
  let staffId: UserId;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    staffId = await makeStaff(t, "compliance");
  });

  const confirm = (publicId: string, txSignature = TX_SIGNATURE) =>
    t
      .withIdentity({ subject: STAFF_SUBJECT })
      .action(api.guarantees.registration.confirmRegistration, { publicId, txSignature });

  async function pendingDraft(publicId: string, fixture: Fixture = fx) {
    const seeded = await seedDraft(t, fixture, publicId);
    await insertRentalContract(t, {
      fx: fixture,
      guaranteeId: seeded.guaranteeId,
      status: "approved",
    });
    return seeded;
  }

  test("a verified registration puts the draft on risk, starts billing, releases the hold", async () => {
    const { guaranteeId } = await pendingDraft("REG1");
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS, signed: true });
    setVerified();

    const result = await confirm("REG1");

    expect(result).toMatchObject({
      success: true,
      data: {
        publicId: "REG1",
        txSignature: TX_SIGNATURE,
        capacity: { ceilingCents: CEILING_CENTS, availableCents: CEILING_CENTS, reservedCents: 0 },
      },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("active");
    expect(after.activatedAt).not.toBeNull();
    expect(after.activationFee).toEqual({ status: "pending" });
    expect(after.registration).toMatchObject({
      txSignature: TX_SIGNATURE,
      slot: 4242,
      registeredAt: "2026-10-20T12:00:00.000Z",
      confirmedBy: staffId,
    });
    expect(after.registration?.onchainIdHex).toMatch(/^[0-9a-f]{64}$/);
    expect((await holdsOf(t, guaranteeId))[0]).toMatchObject({ releaseReason: "registered" });
    expect(await historyMessages(t, fx, "REG1")).toContain("Garantia ativada");
    const rows = await auditRows(t, "REG1");
    expect(rows.find((row) => row.action === "guarantee.activated")?.actor).toEqual({
      kind: "user",
      userId: staffId,
    });
    expect(rows.find((row) => row.action === "guarantee.transitioned")?.actor).toEqual({
      kind: "user",
      userId: staffId,
    });
  });

  test("the chain is asked for exactly this guarantee's id and covers", async () => {
    await pendingDraft("REG2");
    setVerified();

    await confirm("REG2", ` ${TX_SIGNATURE} `);

    expect(reader.verifyCalls).toHaveLength(1);
    expect(reader.verifyCalls[0]).toMatchObject({
      txSignature: TX_SIGNATURE,
      expected: { defaultCoverBaseUnits: DEFAULT_COVER, exitCoverBaseUnits: EXIT_COVER },
    });
    const detail = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .query(api.guarantees.activationQueries.getActivationDetail, { publicId: "REG2" });
    expect(reader.verifyCalls[0]?.expected.idHex).toBe(detail?.registration.expected.onchainIdHex);
  });

  test("a refusal keeps pending_registration, stores the program error, keeps the hold", async () => {
    const { guaranteeId } = await pendingDraft("REG3");
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS, signed: true });
    setRefused(6008, "InsufficientFreeCapital");

    const result = await confirm("REG3");

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "REGISTRATION_REFUSED",
        programErrorCode: 6008,
        programErrorName: "InsufficientFreeCapital",
      },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("drafted");
    expect(after.underwriting.review).toBe("pending_registration");
    expect(after.activationFee).toBeUndefined();
    expect(after.registrationRefusal).toMatchObject({
      programErrorCode: 6008,
      programErrorName: "InsufficientFreeCapital",
      txSignature: TX_SIGNATURE,
      recordedBy: staffId,
    });
    expect((await holdsOf(t, guaranteeId))[0]?.releasedAt).toBeUndefined();
    expect(await historyMessages(t, fx, "REG3")).toContain(
      "Registro recusado pela reserva (InsufficientFreeCapital)",
    );
    const actions = (await auditRows(t, "REG3")).map((row) => row.action);
    expect(actions).toContain("guarantee.registration_refused");
  });

  test("a later successful registration clears the refusal", async () => {
    const { guaranteeId } = await pendingDraft("REG4");
    setRefused(6002, "Paused");
    await confirm("REG4", OTHER_TX_SIGNATURE);
    setVerified();

    expect((await confirm("REG4")).success).toBe(true);
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("active");
    expect(after.registrationRefusal).toBeUndefined();
  });

  test.each([["TX_NOT_FOUND"], ["NOT_REGISTER_GUARANTEE"], ["ARGS_MISMATCH"]] as const)(
    "%s is returned and nothing is written",
    async (code) => {
      const { guaranteeId } = await pendingDraft(`REG-${code}`);
      reader.verdict = { success: false, error: { code }, message: "fake" };

      expect(await confirm(`REG-${code}`)).toMatchObject({ success: false, error: { code } });
      const after = await readGuarantee(t, guaranteeId);
      expect(after.status).toBe("drafted");
      expect(after.registrationRefusal).toBeUndefined();
    },
  );

  test("RESERVE_READER_UNAVAILABLE with the shipped adapter: fail closed", async () => {
    const { guaranteeId } = await pendingDraft("REG5");
    expect(await confirm("REG5")).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });

  test("INVALID_TX_SIGNATURE before the chain is asked", async () => {
    await pendingDraft("REG6");
    setVerified();
    expect(await confirm("REG6", "not-a-signature")).toMatchObject({
      error: { code: "INVALID_TX_SIGNATURE" },
    });
    expect(reader.verifyCalls).toEqual([]);
  });

  test("REVIEW_NOT_PENDING_REGISTRATION while the contract is still out for signature", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "REG7", { review: "awaiting_signature" });
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    setVerified();

    expect(await confirm("REG7")).toMatchObject({
      error: { code: "REVIEW_NOT_PENDING_REGISTRATION" },
    });
    expect(reader.verifyCalls).toEqual([]);
  });

  test("SIGNED_CONTRACT_NOT_APPROVED with no approved contract", async () => {
    await seedDraft(t, fx, "REG8");
    setVerified();
    expect(await confirm("REG8")).toMatchObject({
      error: { code: "SIGNED_CONTRACT_NOT_APPROVED" },
    });
  });

  test("AGENCY_NOT_ACTIVE when the agency lost its active onboarding", async () => {
    const suspended = await makeAgency(t, "2", "rejected");
    await pendingDraft("REG9", suspended);
    setVerified();
    expect(await confirm("REG9")).toMatchObject({ error: { code: "AGENCY_NOT_ACTIVE" } });
  });

  test("NOT_FOUND and NOT_DRAFTED", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "REG10", { status: GUARANTEE_STATE.ACTIVE });
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    setVerified();
    expect(await confirm("NOPE")).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await confirm("REG10")).toMatchObject({ error: { code: "NOT_DRAFTED" } });
  });

  test("CAPACITY_INVARIANT_BROKEN for a draft that carries reserved cents", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "REG11", { availableCents: 2_000_000 });
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    setVerified();

    expect(await confirm("REG11")).toMatchObject({
      error: { code: "CAPACITY_INVARIANT_BROKEN" },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("drafted");
    expect(after.registration).toBeUndefined();
  });

  test("support staff and agency members are refused", async () => {
    await pendingDraft("REG12");
    await makeStaff(t, "support", "auth0|staff-support");
    setVerified();

    await expect(
      t
        .withIdentity({ subject: "auth0|staff-support" })
        .action(api.guarantees.registration.confirmRegistration, {
          publicId: "REG12",
          txSignature: TX_SIGNATURE,
        }),
    ).rejects.toThrow(/compliance/);
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .action(api.guarantees.registration.confirmRegistration, {
          publicId: "REG12",
          txSignature: TX_SIGNATURE,
        }),
    ).rejects.toThrow();
  });
});

describe("offer holds outside the send", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    await makeStaff(t, "compliance");
  });

  test("the agency canceling an offered draft releases its hold as canceled", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "HLD1", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS });

    await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.guarantees.useCases.cancelDraft, { agencyId: fx.agencyId, publicId: "HLD1" });

    expect((await holdsOf(t, guaranteeId))[0]).toMatchObject({ releaseReason: "canceled" });
  });

  test("staff canceling a pending registration releases its hold", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "HLD2");
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS, signed: true });

    await t.withIdentity({ subject: STAFF_SUBJECT }).mutation(api.guarantees.mutations.close, {
      publicId: "HLD2",
      reason: "canceled_pre_activation",
    });

    expect((await holdsOf(t, guaranteeId))[0]).toMatchObject({ releaseReason: "canceled" });
  });

  test("the sweep releases lapsed holds only, with a system audit entry", async () => {
    const lapsed = await seedDraft(t, fx, "SWP1", { review: "awaiting_signature" });
    const live = await seedDraft(t, fx, "SWP2", { review: "awaiting_signature" });
    const signed = await seedDraft(t, fx, "SWP3");
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

  test("listActivationQueue returns drafts at the requested stage, flagging a lapsed hold", async () => {
    const pending = await seedDraft(t, fx, "Q1");
    await insertRentalContract(t, { fx, guaranteeId: pending.guaranteeId, status: "approved" });
    const lapsed = await seedDraft(t, fx, "Q2", { review: "awaiting_signature" });
    await insertHold(t, { fx, guaranteeId: lapsed.guaranteeId, expiresInMs: -1 });
    await seedDraft(t, fx, "Q3", { review: "accepted" });
    await seedDraft(t, fx, "Q4", { status: GUARANTEE_STATE.ACTIVE });
    const asStaff = t.withIdentity({ subject: STAFF_SUBJECT });

    const ready = await asStaff.query(api.guarantees.activationQueries.listActivationQueue, {
      review: "pending_registration",
    });
    const awaiting = await asStaff.query(api.guarantees.activationQueries.listActivationQueue, {
      review: "awaiting_signature",
    });

    expect(ready.rows.map((row) => row.publicId)).toEqual(["Q1"]);
    expect(ready.rows[0]).toMatchObject({
      agencyName: "Agency 1",
      agencyActive: true,
      rentCents: RENT_CENTS,
      signedContract: "approved",
      offerHold: "none",
      registrationRefusal: null,
      blockers: [],
    });
    expect(awaiting.rows.map((row) => row.publicId)).toEqual(["Q2"]);
    expect(awaiting.rows[0]?.offerHold).toBe("lapsed");
    expect(awaiting.rows[0]?.blockers).toEqual([
      "REVIEW_NOT_PENDING_REGISTRATION",
      "SIGNED_CONTRACT_NOT_APPROVED",
    ]);
  });

  test("getActivationDetail carries the expected registration, the hold and the refusal", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "D1");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    await insertHold(t, { fx, guaranteeId, expiresInMs: DAY_MS, signed: true });
    setRefused(6007, "UnderCovered");
    await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .action(api.guarantees.registration.confirmRegistration, {
        publicId: "D1",
        txSignature: TX_SIGNATURE,
      });

    const detail = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .query(api.guarantees.activationQueries.getActivationDetail, { publicId: "D1" });

    expect(detail?.registration.expected).toEqual({
      onchainIdHex: expect.stringMatching(/^[0-9a-f]{64}$/),
      defaultCoverBaseUnits: DEFAULT_COVER.toString(),
      exitCoverBaseUnits: EXIT_COVER.toString(),
    });
    expect(detail?.registration.refusal).toMatchObject({
      programErrorCode: 6007,
      programErrorName: "UnderCovered",
    });
    expect(detail?.registration.confirmed).toBeNull();
    expect(detail?.offerHold).toMatchObject({
      status: "active",
      amountBaseUnits: HOLD_AMOUNT.toString(),
    });
    expect(detail?.review.reserveRefusedAt).toEqual(expect.any(String));
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
      "REVIEW_NOT_PENDING_REGISTRATION",
      "SIGNED_CONTRACT_NOT_APPROVED",
      "AGENCY_NOT_ACTIVE",
    ]);
    expect(detail?.offerHold).toBeNull();
    expect(missing).toBeNull();
  });

  test("support staff cannot read the activation queue", async () => {
    await makeStaff(t, "support", "auth0|staff-support");
    await expect(
      t
        .withIdentity({ subject: "auth0|staff-support" })
        .query(api.guarantees.activationQueries.listActivationQueue, {
          review: "pending_registration",
        }),
    ).rejects.toThrow(/compliance/);
  });
});

describe("nobody clicks Activate", () => {
  test.each([
    ["guarantees/mutations:staffActivate", false],
    ["guarantees/mutations:activate", true],
  ] as const)("%s no longer exists", async (path, agencyScoped) => {
    const t = setup();
    const fx = await makeAgency(t, "1");
    await makeStaff(t, "compliance");
    const { guaranteeId } = await seedDraft(t, fx, "GONE1");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    const removed = makeFunctionReference<"mutation">(path);

    await expect(
      t
        .withIdentity({ subject: agencyScoped ? fx.subject : STAFF_SUBJECT })
        .mutation(
          removed,
          agencyScoped ? { agencyId: fx.agencyId, publicId: "GONE1" } : { publicId: "GONE1" },
        ),
    ).rejects.toThrow();
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });
});
