// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { registerGuaranteeAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import type { StorageId } from "../lib/storage";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import type { GuaranteeId } from "../guarantees/domain";
import type { ClaimEvidenceKind } from "./domain";

function setup() {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

type T = ReturnType<typeof setup>;

type Fixture = {
  subject: string;
  userId: UserId;
  agencyId: AgencyId;
  guaranteeId: GuaranteeId;
  noticePublicId: string;
};

const RENT_CENTS = 300_000;
// Due long enough ago that the grace period has passed on any run date.
const PAST_DUE_DATE = "2026-06-05";

async function makeFixture(
  t: T,
  { suffix = "1", rentDueDate = PAST_DUE_DATE, signedContract = true } = {},
): Promise<Fixture> {
  const subject = `auth0|claim-user-${suffix}`;
  const { userId, agencyId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `claim-user-${suffix}`,
      subject,
      name: `Claim User ${suffix}`,
      email: `claim-${suffix}@test.br`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: `Agency ${suffix}`,
      cnpj: `0000000000000${suffix}`.slice(-14),
      agencyType: "empresa",
      onboardingState: "active",
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
  const { guaranteeId } = await seedGuaranteeWithLease(
    t,
    {
      agencyId,
      status: "in_arrears",
      activatedAt: "2024-06-01T00:00:00.000Z",
      rentCents: RENT_CENTS,
      tenantTaxId: `1114447773${suffix}`.slice(-11),
    },
    `CT-${suffix}`,
  );
  const noticePublicId = `DN-CT-${suffix}-${rentDueDate}`;
  await t.run(async (ctx) => {
    await ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId: noticePublicId,
      guaranteeId,
      agencyId,
      status: "open",
      rentDueDate,
      originalAmountCents: RENT_CENTS,
      updatedAmountCents: RENT_CENTS,
      evidenceSource: "agency_reported",
      openedAt: "2026-06-10T12:00:00.000Z",
      openedByUserId: userId,
    });
    if (signedContract) {
      const storageId = await ctx.storage.store(
        new Blob(["contract"], { type: "application/pdf" }),
      );
      await ctx.db.insert("guaranteeDocuments", {
        guaranteeId,
        agencyId,
        key: "rentalContract",
        storageId,
        fileName: "contrato.pdf",
        contentType: "application/pdf",
        sizeBytes: 8,
        uploadedBy: { kind: "agency_user", userId },
        uploadedAt: "2026-02-01T00:00:00.000Z",
        status: "approved",
      });
    }
  });
  return { subject, userId, agencyId, guaranteeId, noticePublicId };
}

async function makeCompliance(t: T): Promise<string> {
  const subject = "auth0|compliance";
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: "compliance",
      subject,
      name: "Compliance Staff",
      email: "compliance@mutav.finance",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("mutavStaff", {
      userId,
      role: "compliance",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
  return subject;
}

async function storePdf(t: T): Promise<StorageId> {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }),
    );
    // convex-test leaves `contentType` off the `_storage` row; see
    // guarantees/documents.test.ts for why this goes through Reflect.apply.
    await Reflect.apply(ctx.db.patch, ctx.db, [
      "_storage",
      storageId,
      { contentType: "application/pdf" },
    ]);
    return storageId;
  });
}

async function attach(t: T, fx: Fixture, kind: ClaimEvidenceKind) {
  return t
    .withIdentity({ subject: fx.subject })
    .mutation(api.delinquencies.claimEvidence.attachClaimEvidence, {
      noticePublicId: fx.noticePublicId,
      kind,
      storageId: await storePdf(t),
      fileName: `${kind}.pdf`,
    });
}

async function attachBoth(t: T, fx: Fixture) {
  for (const kind of ["nonPaymentProof", "tenantNotice"] as const) {
    const result = await attach(t, fx, kind);
    if (!result.success) throw new Error(result.message);
  }
}

async function submit(t: T, fx: Fixture, claimedAmountCents = RENT_CENTS) {
  return t.withIdentity({ subject: fx.subject }).mutation(api.delinquencies.claims.submitClaim, {
    noticePublicId: fx.noticePublicId,
    claimedAmountCents,
    declarationAccepted: true,
  });
}

async function readNotice(t: T, publicId: string) {
  const notice = await t.run((ctx) =>
    ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique(),
  );
  if (!notice) throw new Error("notice missing");
  return notice;
}

async function auditActions(t: T, publicId: string): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("mutavAuditLog")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "guaranteeDelinquencyNotices").eq("resourceId", publicId),
      )
      .collect(),
  );
  return rows.map((row) => row.action);
}

describe("attachClaimEvidence", () => {
  test("records a file and supersedes an earlier pending one of the same kind", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await attach(t, fx, "nonPaymentProof");
    const second = await attach(t, fx, "nonPaymentProof");
    expect(second.success).toBe(true);

    const rows = await t
      .withIdentity({ subject: fx.subject })
      .query(api.delinquencies.claimEvidence.listClaimEvidence, {
        noticePublicId: fx.noticePublicId,
      });
    expect(rows?.map((row) => row.status).sort()).toEqual(["pending_review", "superseded"]);
    expect(await auditActions(t, fx.noticePublicId)).toContain("delinquency.evidence_attached");
  });

  test("another agency cannot attach and cannot read the list", async () => {
    const t = setup();
    const fx = await makeFixture(t, { suffix: "1" });
    const other = await makeFixture(t, { suffix: "2" });
    await expect(
      t
        .withIdentity({ subject: other.subject })
        .mutation(api.delinquencies.claimEvidence.attachClaimEvidence, {
          noticePublicId: fx.noticePublicId,
          kind: "tenantNotice",
          storageId: await storePdf(t),
          fileName: "x.pdf",
        }),
    ).rejects.toThrow();
    const rows = await t
      .withIdentity({ subject: other.subject })
      .query(api.delinquencies.claimEvidence.listClaimEvidence, {
        noticePublicId: fx.noticePublicId,
      });
    expect(rows).toBeNull();
  });

  test("a submitted claim locks its evidence → CLAIM_UNDER_REVIEW", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await attachBoth(t, fx);
    expect((await submit(t, fx)).success).toBe(true);
    const result = await attach(t, fx, "tenantNotice");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CLAIM_UNDER_REVIEW");
  });
});

describe("submitClaim", () => {
  test("happy path: files the claim, writes history and audit", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await attachBoth(t, fx);

    const result = await submit(t, fx, 250_000);
    expect(result.success).toBe(true);

    const notice = await readNotice(t, fx.noticePublicId);
    expect(notice.status).toBe("open");
    expect(notice.claim?.status).toBe("submitted");
    expect(notice.claim?.claimedAmountCents).toBe(250_000);
    expect(notice.claim?.submittedByUserId).toBe(fx.userId);
    expect(await auditActions(t, fx.noticePublicId)).toContain("delinquency.claim_submitted");

    const history = await t.run((ctx) => ctx.db.query("guaranteeHistory").collect());
    expect(history.map((row) => row.message)).toContain("Garantia acionada");

    const detail = await t
      .withIdentity({ subject: fx.subject })
      .query(api.delinquencies.useCases.getByPublicId, { publicId: fx.noticePublicId });
    expect(detail?.caseStatus).toBe("under_review");
  });

  test("missing evidence and contract → CLAIM_REQUIREMENTS_MISSING listing each", async () => {
    const t = setup();
    const fx = await makeFixture(t, { signedContract: false });
    await attach(t, fx, "nonPaymentProof");
    const result = await submit(t, fx);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CLAIM_REQUIREMENTS_MISSING");
    expect(result.error.missing).toEqual(["signedContract", "tenantNotice"]);
  });

  test("inside the grace period → CLAIM_NOT_YET_OPEN", async () => {
    const t = setup();
    const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fx = await makeFixture(t, { rentDueDate: today });
    await attachBoth(t, fx);
    const result = await submit(t, fx);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CLAIM_NOT_YET_OPEN");
  });

  test.each([0, -1, 300_001, 1000.5])("claimed amount %s → INVALID_AMOUNT", async (amount) => {
    const t = setup();
    const fx = await makeFixture(t);
    await attachBoth(t, fx);
    const result = await submit(t, fx, amount);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_AMOUNT");
  });

  test("a second submit → CLAIM_ALREADY_SUBMITTED", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await attachBoth(t, fx);
    await submit(t, fx);
    const result = await submit(t, fx);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CLAIM_ALREADY_SUBMITTED");
  });
});

describe("information requests", () => {
  async function submitted(t: T) {
    const fx = await makeFixture(t);
    await attachBoth(t, fx);
    const result = await submit(t, fx);
    if (!result.success) throw new Error(result.message);
    return { fx, staff: t.withIdentity({ subject: await makeCompliance(t) }) };
  }

  test("an agency member cannot request information", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.delinquencies.claims.staffRequestClaimInfo, {
          noticePublicId: fx.noticePublicId,
          requests: [{ evidenceKind: "tenantNotice", reason: "ilegível" }],
          dueAt: "2099-01-01",
        }),
    ).rejects.toThrow();
  });

  test("full loop: request → re-upload → resubmit → verify accepts the evidence", async () => {
    const t = setup();
    const { fx, staff } = await submitted(t);

    const requested = await staff.mutation(api.delinquencies.claims.staffRequestClaimInfo, {
      noticePublicId: fx.noticePublicId,
      requests: [{ evidenceKind: "tenantNotice", reason: "Arquivo ilegível." }],
      dueAt: "2099-01-01",
    });
    expect(requested.success).toBe(true);

    let detail = await t
      .withIdentity({ subject: fx.subject })
      .query(api.delinquencies.useCases.getByPublicId, { publicId: fx.noticePublicId });
    expect(detail?.caseStatus).toBe("info_requested");
    expect(detail?.claim?.requests.map((r) => [r.evidenceKind, r.resolvedAt])).toEqual([
      ["tenantNotice", null],
    ]);
    const rejected = detail?.evidence.find((row) => row.kind === "tenantNotice");
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.rejectionReason).toBe("Arquivo ilegível.");

    const early = await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.delinquencies.claims.resubmitClaim, { noticePublicId: fx.noticePublicId });
    expect(early.success).toBe(false);
    if (!early.success) expect(early.error.code).toBe("REQUESTS_UNRESOLVED");

    expect((await attach(t, fx, "tenantNotice")).success).toBe(true);
    const resubmitted = await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.delinquencies.claims.resubmitClaim, { noticePublicId: fx.noticePublicId });
    expect(resubmitted.success).toBe(true);

    const verified = await staff.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: fx.noticePublicId,
    });
    expect(verified.success).toBe(true);

    detail = await t
      .withIdentity({ subject: fx.subject })
      .query(api.delinquencies.useCases.getByPublicId, { publicId: fx.noticePublicId });
    expect(detail?.caseStatus).toBe("under_review");
    expect(
      detail?.evidence
        .filter((row) => row.status !== "rejected")
        .map((row) => [row.kind, row.status])
        .sort(),
    ).toEqual([
      ["nonPaymentProof", "accepted"],
      ["tenantNotice", "accepted"],
    ]);
    expect(await auditActions(t, fx.noticePublicId)).toEqual(
      expect.arrayContaining([
        "delinquency.claim_info_requested",
        "delinquency.claim_resubmitted",
        "delinquency.verified",
      ]),
    );
  });

  test("verification is refused while a request waits on the agency", async () => {
    const t = setup();
    const { fx, staff } = await submitted(t);
    await staff.mutation(api.delinquencies.claims.staffRequestClaimInfo, {
      noticePublicId: fx.noticePublicId,
      requests: [{ evidenceKind: "nonPaymentProof", reason: "Falta o boleto." }],
      dueAt: "2099-01-01",
    });
    const result = await staff.mutation(api.delinquencies.mutations.staffVerifyDefault, {
      noticePublicId: fx.noticePublicId,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CLAIM_NOT_SUBMITTED");
  });

  test.each([
    ["no requests", [], "2099-01-01", "NO_REQUESTS"],
    [
      "blank reason",
      [{ evidenceKind: "tenantNotice" as const, reason: "  " }],
      "2099-01-01",
      "REASON_REQUIRED",
    ],
    [
      "past deadline",
      [{ evidenceKind: "tenantNotice" as const, reason: "x" }],
      "2020-01-01",
      "INVALID_DUE_DATE",
    ],
  ])("%s → %s", async (_label, requests, dueAt, code) => {
    const t = setup();
    const { fx, staff } = await submitted(t);
    const result = await staff.mutation(api.delinquencies.claims.staffRequestClaimInfo, {
      noticePublicId: fx.noticePublicId,
      requests,
      dueAt,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(code);
  });
});
