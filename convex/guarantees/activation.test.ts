// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { AgencyId, OnboardingState } from "../agencies/domain";
import type { UserId } from "../users/domain";
import type { MutavStaffRole } from "../mutavStaff/domain";
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
// 30x the fixture rent under the default product.
const CEILING_CENTS = 3_000_000;
const STAFF_SUBJECT = "auth0|staff-activation";

function setup(): T {
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
    review = "signed",
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

async function readGuarantee(t: T, guaranteeId: GuaranteeId): Promise<Guarantee> {
  const doc = await t.run((ctx) => ctx.db.get(guaranteeId));
  if (!doc) throw new Error("guarantee vanished");
  return doc;
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

describe("guarantees.staffActivate", () => {
  let t: T;
  let fx: Fixture;
  let staffId: UserId;

  beforeEach(async () => {
    t = setup();
    fx = await makeAgency(t, "1");
    staffId = await makeStaff(t, "compliance");
  });

  test("puts a signed draft with an approved contract on risk", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT1");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT1" });

    expect(result).toMatchObject({
      success: true,
      data: {
        publicId: "ACT1",
        capacity: { ceilingCents: CEILING_CENTS, availableCents: CEILING_CENTS, reservedCents: 0 },
      },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("active");
    expect(after.activatedAt).not.toBeNull();
    expect(after.capacity.ceilingCents).toBe(after.terms.coverageCeilingCents);
    expect(after.activationFee).toEqual({ status: "pending" });
    expect(await historyMessages(t, fx, "ACT1")).toContain("Garantia ativada");
  });

  test("audits the activation under the staff actor next to the transition", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT2");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });

    await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT2" });

    const rows = await auditRows(t, "ACT2");
    const activated = rows.find((row) => row.action === "guarantee.activated");
    const transitioned = rows.find((row) => row.action === "guarantee.transitioned");
    expect(activated?.actor).toEqual({ kind: "user", userId: staffId });
    expect(transitioned?.actor).toEqual({ kind: "user", userId: staffId });
  });

  test("NOT_FOUND for an unknown publicId", async () => {
    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "NOPE" });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  test("NOT_DRAFTED for a guarantee already on risk", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT3", { status: GUARANTEE_STATE.ACTIVE });
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT3" });

    expect(result).toMatchObject({ success: false, error: { code: "NOT_DRAFTED" } });
  });

  test("REVIEW_NOT_SIGNED while the contract is still out for signature", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT4", { review: "awaiting_signature" });
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT4" });

    expect(result).toMatchObject({ success: false, error: { code: "REVIEW_NOT_SIGNED" } });
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });

  test("SIGNED_CONTRACT_NOT_APPROVED while the only contract awaits review", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT5");
    await insertRentalContract(t, { fx, guaranteeId, status: "pending_review" });

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT5" });

    expect(result).toMatchObject({
      success: false,
      error: { code: "SIGNED_CONTRACT_NOT_APPROVED" },
    });
  });

  test("SIGNED_CONTRACT_NOT_APPROVED with no contract at all", async () => {
    await seedDraft(t, fx, "ACT6");

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT6" });

    expect(result).toMatchObject({
      success: false,
      error: { code: "SIGNED_CONTRACT_NOT_APPROVED" },
    });
  });

  test("AGENCY_NOT_ACTIVE when the agency lost its active onboarding", async () => {
    const suspended = await makeAgency(t, "2", "rejected");
    const { guaranteeId } = await seedDraft(t, suspended, "ACT7");
    await insertRentalContract(t, { fx: suspended, guaranteeId, status: "approved" });

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT7" });

    expect(result).toMatchObject({ success: false, error: { code: "AGENCY_NOT_ACTIVE" } });
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });

  test("CAPACITY_INVARIANT_BROKEN for a draft that carries reserved cents", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT8", { availableCents: 2_000_000 });
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    const before = await readGuarantee(t, guaranteeId);

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT8" });

    expect(result).toMatchObject({
      success: false,
      error: { code: "CAPACITY_INVARIANT_BROKEN" },
    });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe("drafted");
    expect(after.capacity).toEqual(before.capacity);
    expect(after.activationFee).toBeUndefined();
  });

  test("support staff are refused", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT9");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    await makeStaff(t, "support", "auth0|staff-support");

    await expect(
      t
        .withIdentity({ subject: "auth0|staff-support" })
        .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT9" }),
    ).rejects.toThrow(/compliance/);
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });

  test("an agency member who is not staff is refused", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "ACT10");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });

    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.guarantees.mutations.staffActivate, { publicId: "ACT10" }),
    ).rejects.toThrow();
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
  });
});

describe("agency activation is gone", () => {
  test("the agency-scoped activate mutation no longer exists", async () => {
    const t = setup();
    const fx = await makeAgency(t, "1");
    const { guaranteeId } = await seedDraft(t, fx, "GONE1");
    await insertRentalContract(t, { fx, guaranteeId, status: "approved" });
    const removedActivate = makeFunctionReference<"mutation">("guarantees/mutations:activate");

    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(removedActivate, { agencyId: fx.agencyId, publicId: "GONE1" }),
    ).rejects.toThrow();
    expect((await readGuarantee(t, guaranteeId)).status).toBe("drafted");
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

  test("moves an awaiting_signature draft to signed, with history and audit", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SIG1", { review: "awaiting_signature" });
    const documentId = await insertRentalContract(t, { fx, guaranteeId, status: "pending_review" });

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });

    expect(result).toMatchObject({ success: true, data: { reviewSigned: true } });
    const after = await readGuarantee(t, guaranteeId);
    expect(after.underwriting.review).toBe("signed");
    expect(after.status).toBe("drafted");
    expect(await historyMessages(t, fx, "SIG1")).toContain("Contrato assinado registrado");
    const actions = (await auditRows(t, "SIG1")).map((row) => row.action);
    expect(actions).toContain("guarantee.signed");
  });

  test("the signed draft can then be activated", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SIG2", { review: "awaiting_signature" });
    const documentId = await insertRentalContract(t, { fx, guaranteeId, status: "pending_review" });
    const asStaff = t.withIdentity({ subject: STAFF_SUBJECT });

    await asStaff.mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });
    const result = await asStaff.mutation(api.guarantees.mutations.staffActivate, {
      publicId: "SIG2",
    });

    expect(result.success).toBe(true);
    expect((await readGuarantee(t, guaranteeId)).status).toBe("active");
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

      const result = await t
        .withIdentity({ subject: STAFF_SUBJECT })
        .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });

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

    const result = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });

    expect(result).toMatchObject({ success: true, data: { reviewSigned: false } });
    expect((await readGuarantee(t, guaranteeId)).underwriting.review).toBe("awaiting_signature");
  });

  test("a later rental-contract upload does not revert a signed review", async () => {
    const { guaranteeId } = await seedDraft(t, fx, "SIG4", { review: "awaiting_signature" });
    const documentId = await insertRentalContract(t, { fx, guaranteeId, status: "pending_review" });
    const asStaff = t.withIdentity({ subject: STAFF_SUBJECT });
    await asStaff.mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });

    await insertRentalContract(t, { fx, guaranteeId, status: "pending_review" });

    const detail = await asStaff.query(api.guarantees.activationQueries.getActivationDetail, {
      publicId: "SIG4",
    });
    expect(detail?.review.status).toBe("signed");
    expect(detail?.signedContract).toBe("approved");
    expect(detail?.blockers).toEqual([]);
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

  test("listActivationQueue returns drafts at the requested review stage only", async () => {
    const signed = await seedDraft(t, fx, "Q1");
    await insertRentalContract(t, { fx, guaranteeId: signed.guaranteeId, status: "approved" });
    await seedDraft(t, fx, "Q2", { review: "awaiting_signature" });
    await seedDraft(t, fx, "Q3", { review: "accepted" });
    await seedDraft(t, fx, "Q4", { review: "signed", status: GUARANTEE_STATE.ACTIVE });
    const asStaff = t.withIdentity({ subject: STAFF_SUBJECT });

    const ready = await asStaff.query(api.guarantees.activationQueries.listActivationQueue, {
      review: "signed",
    });
    const awaiting = await asStaff.query(api.guarantees.activationQueries.listActivationQueue, {
      review: "awaiting_signature",
    });

    expect(ready.rows.map((row) => row.publicId)).toEqual(["Q1"]);
    expect(ready.rows[0]).toMatchObject({
      agencyName: "Agency 1",
      agencyActive: true,
      tenantName: null,
      rentCents: RENT_CENTS,
      signedContract: "approved",
      blockers: [],
    });
    expect(awaiting.rows.map((row) => row.publicId)).toEqual(["Q2"]);
    expect(awaiting.rows[0]?.blockers).toEqual([
      "REVIEW_NOT_SIGNED",
      "SIGNED_CONTRACT_NOT_APPROVED",
    ]);
  });

  test("getActivationDetail lists every blocker and returns null on a miss", async () => {
    const suspended = await makeAgency(t, "2", "rejected");
    await seedDraft(t, suspended, "D1", { review: "accepted" });
    const asStaff = t.withIdentity({ subject: STAFF_SUBJECT });

    const detail = await asStaff.query(api.guarantees.activationQueries.getActivationDetail, {
      publicId: "D1",
    });
    const missing = await asStaff.query(api.guarantees.activationQueries.getActivationDetail, {
      publicId: "NOPE",
    });

    expect(detail?.blockers).toEqual([
      "REVIEW_NOT_SIGNED",
      "SIGNED_CONTRACT_NOT_APPROVED",
      "AGENCY_NOT_ACTIVE",
    ]);
    expect(detail?.signedContract).toBe("missing");
    expect(missing).toBeNull();
  });

  test("support staff cannot read the activation queue", async () => {
    await makeStaff(t, "support", "auth0|staff-support");
    await expect(
      t
        .withIdentity({ subject: "auth0|staff-support" })
        .query(api.guarantees.activationQueries.listActivationQueue, { review: "signed" }),
    ).rejects.toThrow(/compliance/);
  });
});
