// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { registerGuaranteeAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import type { StorageId } from "../lib/storage";
import type { AgencyId } from "../agencies/domain";
import type { MutavStaffRole } from "../mutavStaff/domain";
import type { UserId } from "../users/domain";
import type { GuaranteeDocumentId, GuaranteeId, GuaranteeState } from "./domain";
import { hasApprovedSignedContract } from "./documents";

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
  publicId: string;
};

async function makeFixture(
  t: T,
  {
    suffix = "1",
    status = "drafted",
    onboardingState = "active",
    agencyEmail = "agency@test.br",
  }: {
    suffix?: string;
    status?: GuaranteeState;
    onboardingState?: "active" | "in_progress";
    agencyEmail?: string;
  } = {},
): Promise<Fixture> {
  const subject = `auth0|doc-user-${suffix}`;
  const publicId = `GD-${suffix}`;
  const { userId, agencyId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `doc-user-${suffix}`,
      subject,
      name: `Agency User ${suffix}`,
      email: `doc-${suffix}@test.br`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: `Agency ${suffix}`,
      cnpj: `0000000000000${suffix}`.slice(-14),
      agencyType: "empresa",
      onboardingState,
      email: agencyEmail,
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
      status,
      activatedAt: status === "drafted" ? null : "2026-02-01T00:00:00.000Z",
      ...(status === "closed"
        ? { closeReason: "end_of_lease", closedAt: "2026-03-01T00:00:00.000Z" }
        : {}),
      tenantTaxId: `1114447773${suffix}`.slice(-11),
    },
    publicId,
  );
  return { subject, userId, agencyId, guaranteeId, publicId };
}

async function makeStaff(t: T, role: MutavStaffRole, suffix = role): Promise<{ subject: string }> {
  const subject = `auth0|staff-${suffix}`;
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `staff-${suffix}`,
      subject,
      name: `Staff ${suffix}`,
      email: `staff-${suffix}@mutav.finance`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("mutavStaff", { userId, role, createdAt: "2026-01-01T00:00:00.000Z" });
  });
  return { subject };
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

async function storeFile(
  t: T,
  {
    type = "application/pdf",
    bytes = PDF_BYTES,
  }: { type?: string; bytes?: Uint8Array<ArrayBuffer> } = {},
): Promise<StorageId> {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([bytes], { type }));
    // convex-test leaves `contentType` off the `_storage` row that production
    // fills from the upload's Content-Type header; write it in so the
    // mutation sees what a real upload records. `_storage` is outside the
    // typed table map, hence `Reflect.apply` rather than a typed patch.
    await Reflect.apply(ctx.db.patch, ctx.db, ["_storage", storageId, { contentType: type }]);
    return storageId;
  });
}

async function agencyAttach(
  t: T,
  fx: Fixture,
  {
    key = "rentalContract",
    storageId,
    fileName = "contrato.pdf",
  }: {
    key?: "rentalContract" | "inspection" | "policy";
    storageId: StorageId;
    fileName?: string;
  },
) {
  return t
    .withIdentity({ subject: fx.subject })
    .mutation(api.guarantees.documents.attachGuaranteeDocument, {
      agencyId: fx.agencyId,
      publicId: fx.publicId,
      key,
      storageId,
      fileName,
    });
}

async function attachOk(
  t: T,
  fx: Fixture,
  key: "rentalContract" | "inspection" | "policy" = "rentalContract",
): Promise<GuaranteeDocumentId> {
  const result = await agencyAttach(t, fx, { key, storageId: await storeFile(t) });
  if (!result.success) throw new Error(`attach failed: ${result.error.code}`);
  return result.data.documentId;
}

async function auditActions(t: T): Promise<string[]> {
  return t.run(async (ctx) =>
    (await ctx.db.query("mutavAuditLog").collect()).map((entry) => entry.action),
  );
}

describe("generateGuaranteeDocumentUploadUrl", () => {
  test("mints a URL for an open guarantee of the caller's agency", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const result = await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.guarantees.documents.generateGuaranteeDocumentUploadUrl, {
        agencyId: fx.agencyId,
        publicId: fx.publicId,
      });
    expect(result.success).toBe(true);
  });

  test("GUARANTEE_NOT_FOUND for another agency's guarantee", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const other = await makeFixture(t, { suffix: "2" });
    const result = await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.guarantees.documents.generateGuaranteeDocumentUploadUrl, {
        agencyId: fx.agencyId,
        publicId: other.publicId,
      });
    expect(result).toMatchObject({ success: false, error: { code: "GUARANTEE_NOT_FOUND" } });
  });

  test("GUARANTEE_CLOSED for a closed guarantee", async () => {
    const t = setup();
    const fx = await makeFixture(t, { status: "closed" });
    const result = await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.guarantees.documents.generateGuaranteeDocumentUploadUrl, {
        agencyId: fx.agencyId,
        publicId: fx.publicId,
      });
    expect(result).toMatchObject({ success: false, error: { code: "GUARANTEE_CLOSED" } });
  });

  test("throws for an agency that is not active", async () => {
    const t = setup();
    const fx = await makeFixture(t, { onboardingState: "in_progress" });
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.guarantees.documents.generateGuaranteeDocumentUploadUrl, {
          agencyId: fx.agencyId,
          publicId: fx.publicId,
        }),
    ).rejects.toThrow(/Agency is not active/);
  });

  test("throws when unauthenticated", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    await expect(
      t.mutation(api.guarantees.documents.generateGuaranteeDocumentUploadUrl, {
        agencyId: fx.agencyId,
        publicId: fx.publicId,
      }),
    ).rejects.toThrow(/Authentication required/);
  });
});

describe("attachGuaranteeDocument", () => {
  test("records a pending_review row from storage metadata and audits it", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const storageId = await storeFile(t);
    const result = await agencyAttach(t, fx, { storageId, fileName: "  contrato.pdf  " });
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.supersededCount).toBe(0);

    const row = await t.run((ctx) => ctx.db.get(result.data.documentId));
    expect(row).toMatchObject({
      guaranteeId: fx.guaranteeId,
      agencyId: fx.agencyId,
      key: "rentalContract",
      storageId,
      fileName: "contrato.pdf",
      contentType: "application/pdf",
      sizeBytes: 5,
      status: "pending_review",
      uploadedBy: { kind: "agency_user", userId: fx.userId },
    });
    expect(await auditActions(t)).toEqual(["guarantee.document_attached"]);
  });

  test("a new upload supersedes earlier pending files for the same key only", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const first = await attachOk(t, fx, "rentalContract");
    const inspection = await attachOk(t, fx, "inspection");
    const second = await agencyAttach(t, fx, { storageId: await storeFile(t) });
    if (!second.success) throw new Error(second.error.code);
    expect(second.data.supersededCount).toBe(1);

    const statuses = await t.run(async (ctx) => ({
      first: (await ctx.db.get(first))?.status,
      inspection: (await ctx.db.get(inspection))?.status,
      second: (await ctx.db.get(second.data.documentId))?.status,
    }));
    expect(statuses).toEqual({
      first: "superseded",
      inspection: "pending_review",
      second: "pending_review",
    });
  });

  test("an approved file is kept approved when a new one arrives", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const approved = await attachOk(t, fx);
    await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId: approved });
    await attachOk(t, fx);
    expect(await t.run(async (ctx) => (await ctx.db.get(approved))?.status)).toBe("approved");
  });

  test.each([
    ["text/plain", "UNSUPPORTED_CONTENT_TYPE"],
    ["application/x-msdownload", "UNSUPPORTED_CONTENT_TYPE"],
  ])("refuses content type %s", async (type, code) => {
    const t = setup();
    const fx = await makeFixture(t);
    const result = await agencyAttach(t, fx, { storageId: await storeFile(t, { type }) });
    expect(result).toMatchObject({ success: false, error: { code } });
    expect(await auditActions(t)).toEqual([]);
  });

  test.each(["image/jpeg", "image/png"])("accepts %s", async (type) => {
    const t = setup();
    const fx = await makeFixture(t);
    const result = await agencyAttach(t, fx, { storageId: await storeFile(t, { type }) });
    expect(result.success).toBe(true);
  });

  test("refuses a file over 15 MB", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const storageId = await storeFile(t, { bytes: new Uint8Array(15 * 1024 * 1024 + 1) });
    const result = await agencyAttach(t, fx, { storageId });
    expect(result).toMatchObject({ success: false, error: { code: "FILE_TOO_LARGE" } });
  });

  test("refuses an empty file", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const storageId = await storeFile(t, { bytes: new Uint8Array(0) });
    const result = await agencyAttach(t, fx, { storageId });
    expect(result).toMatchObject({ success: false, error: { code: "FILE_EMPTY" } });
  });

  test("refuses a blank file name", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const result = await agencyAttach(t, fx, { storageId: await storeFile(t), fileName: "   " });
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_FILE_NAME" } });
  });

  test("FILE_NOT_FOUND when the blob was deleted", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const storageId = await storeFile(t);
    await t.run((ctx) => ctx.storage.delete(storageId));
    const result = await agencyAttach(t, fx, { storageId });
    expect(result).toMatchObject({ success: false, error: { code: "FILE_NOT_FOUND" } });
  });

  test("FILE_ALREADY_ATTACHED when the same blob is attached twice", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const storageId = await storeFile(t);
    await agencyAttach(t, fx, { storageId });
    const result = await agencyAttach(t, fx, { storageId, key: "inspection" });
    expect(result).toMatchObject({ success: false, error: { code: "FILE_ALREADY_ATTACHED" } });
  });

  test("GUARANTEE_CLOSED on a closed guarantee", async () => {
    const t = setup();
    const fx = await makeFixture(t, { status: "closed" });
    const result = await agencyAttach(t, fx, { storageId: await storeFile(t) });
    expect(result).toMatchObject({ success: false, error: { code: "GUARANTEE_CLOSED" } });
  });

  test("GUARANTEE_NOT_FOUND for another agency's guarantee (cross-agency)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const other = await makeFixture(t, { suffix: "2" });
    const result = await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.guarantees.documents.attachGuaranteeDocument, {
        agencyId: fx.agencyId,
        publicId: other.publicId,
        key: "rentalContract",
        storageId: await storeFile(t),
        fileName: "contrato.pdf",
      });
    expect(result).toMatchObject({ success: false, error: { code: "GUARANTEE_NOT_FOUND" } });
  });

  test("throws when the caller names an agency they do not belong to", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const other = await makeFixture(t, { suffix: "2" });
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.guarantees.documents.attachGuaranteeDocument, {
          agencyId: other.agencyId,
          publicId: other.publicId,
          key: "rentalContract",
          storageId: await storeFile(t),
          fileName: "contrato.pdf",
        }),
    ).rejects.toThrow(/not a member/);
  });

  test("throws for an agency that is not active", async () => {
    const t = setup();
    const fx = await makeFixture(t, { onboardingState: "in_progress" });
    await expect(agencyAttach(t, fx, { storageId: await storeFile(t) })).rejects.toThrow(
      /Agency is not active/,
    );
  });
});

describe("listGuaranteeDocuments", () => {
  test("lists the guarantee's files newest first, hiding staff identities", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const support = await makeStaff(t, "support");
    await attachOk(t, fx, "rentalContract");
    const staffUpload = await t
      .withIdentity(support)
      .mutation(api.guarantees.staffDocuments.staffAttachGuaranteeDocument, {
        publicId: fx.publicId,
        key: "policy",
        storageId: await storeFile(t),
        fileName: "apolice.pdf",
      });
    expect(staffUpload.success).toBe(true);

    const rows = await t
      .withIdentity({ subject: fx.subject })
      .query(api.guarantees.documents.listGuaranteeDocuments, { publicId: fx.publicId });
    expect(rows?.map((row) => [row.key, row.uploadedBy])).toEqual([
      ["policy", { kind: "staff", name: null }],
      ["rentalContract", { kind: "agency_user", name: "Agency User 1" }],
    ]);
    expect(rows?.[0]).not.toHaveProperty("storageId");
  });

  test("null for a non-member (no cross-agency existence leak)", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const other = await makeFixture(t, { suffix: "2" });
    await attachOk(t, other);
    const rows = await t
      .withIdentity({ subject: fx.subject })
      .query(api.guarantees.documents.listGuaranteeDocuments, { publicId: other.publicId });
    expect(rows).toBeNull();
  });

  test("null for an unknown publicId", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const rows = await t
      .withIdentity({ subject: fx.subject })
      .query(api.guarantees.documents.listGuaranteeDocuments, { publicId: "nope" });
    expect(rows).toBeNull();
  });
});

describe("getGuaranteeDocumentUrl", () => {
  test("returns a URL for a member", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const documentId = await attachOk(t, fx);
    const url = await t
      .withIdentity({ subject: fx.subject })
      .query(api.guarantees.documents.getGuaranteeDocumentUrl, { documentId });
    expect(typeof url).toBe("string");
  });

  test("null for a member of another agency", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const other = await makeFixture(t, { suffix: "2" });
    const documentId = await attachOk(t, other);
    const url = await t
      .withIdentity({ subject: fx.subject })
      .query(api.guarantees.documents.getGuaranteeDocumentUrl, { documentId });
    expect(url).toBeNull();
  });

  test("null when unauthenticated", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const documentId = await attachOk(t, fx);
    const url = await t.query(api.guarantees.documents.getGuaranteeDocumentUrl, { documentId });
    expect(url).toBeNull();
  });
});

describe("staff uploads", () => {
  test("support can mint a URL and attach; the row is pending_review with a staff uploader", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const support = await makeStaff(t, "support");
    const url = await t
      .withIdentity(support)
      .mutation(api.guarantees.staffDocuments.staffGenerateUploadUrl, { publicId: fx.publicId });
    expect(url.success).toBe(true);
    const result = await t
      .withIdentity(support)
      .mutation(api.guarantees.staffDocuments.staffAttachGuaranteeDocument, {
        publicId: fx.publicId,
        key: "rentalContract",
        storageId: await storeFile(t),
        fileName: "contrato.pdf",
      });
    if (!result.success) throw new Error(result.error.code);
    const row = await t.run((ctx) => ctx.db.get(result.data.documentId));
    expect(row?.status).toBe("pending_review");
    expect(row?.uploadedBy.kind).toBe("staff");
    expect(await auditActions(t)).toEqual(["guarantee.document_attached"]);
  });

  test("GUARANTEE_NOT_FOUND / GUARANTEE_CLOSED", async () => {
    const t = setup();
    const closed = await makeFixture(t, { status: "closed" });
    const support = await makeStaff(t, "support");
    const missing = await t
      .withIdentity(support)
      .mutation(api.guarantees.staffDocuments.staffGenerateUploadUrl, { publicId: "nope" });
    expect(missing).toMatchObject({ success: false, error: { code: "GUARANTEE_NOT_FOUND" } });
    const closedUrl = await t
      .withIdentity(support)
      .mutation(api.guarantees.staffDocuments.staffGenerateUploadUrl, {
        publicId: closed.publicId,
      });
    expect(closedUrl).toMatchObject({ success: false, error: { code: "GUARANTEE_CLOSED" } });
    const closedAttach = await t
      .withIdentity(support)
      .mutation(api.guarantees.staffDocuments.staffAttachGuaranteeDocument, {
        publicId: closed.publicId,
        key: "rentalContract",
        storageId: await storeFile(t),
        fileName: "contrato.pdf",
      });
    expect(closedAttach).toMatchObject({ success: false, error: { code: "GUARANTEE_CLOSED" } });
    const missingAttach = await t
      .withIdentity(support)
      .mutation(api.guarantees.staffDocuments.staffAttachGuaranteeDocument, {
        publicId: "nope",
        key: "rentalContract",
        storageId: await storeFile(t),
        fileName: "a.pdf",
      });
    expect(missingAttach).toMatchObject({
      success: false,
      error: { code: "GUARANTEE_NOT_FOUND" },
    });
  });

  test("non-staff and treasury are refused", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const treasury = await makeStaff(t, "treasury");
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.guarantees.staffDocuments.staffGenerateUploadUrl, { publicId: fx.publicId }),
    ).rejects.toThrow(/Not a Mutav staff member/);
    await expect(
      t
        .withIdentity(treasury)
        .mutation(api.guarantees.staffDocuments.staffGenerateUploadUrl, { publicId: fx.publicId }),
    ).rejects.toThrow(/Requires 'support'/);
  });
});

describe("approveGuaranteeDocument", () => {
  test("compliance approves a pending file and the audit records it", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const documentId = await attachOk(t, fx);
    const result = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });
    expect(result).toMatchObject({ success: true, data: { status: "approved" } });
    const row = await t.run((ctx) => ctx.db.get(documentId));
    expect(row?.status).toBe("approved");
    expect(row?.reviewedBy).toBeDefined();
    expect(row?.reviewedAt).toBeDefined();
    expect(await auditActions(t)).toEqual([
      "guarantee.document_attached",
      "guarantee.document_approved",
    ]);
  });

  test("NOT_PENDING_REVIEW for an already decided or superseded file", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const superseded = await attachOk(t, fx);
    const current = await attachOk(t, fx);
    const supersededResult = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId: superseded });
    expect(supersededResult).toMatchObject({
      success: false,
      error: { code: "NOT_PENDING_REVIEW" },
    });
    await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId: current });
    const again = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId: current });
    expect(again).toMatchObject({ success: false, error: { code: "NOT_PENDING_REVIEW" } });
  });

  test("DOCUMENT_NOT_FOUND for a deleted row", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const documentId = await attachOk(t, fx);
    await t.run((ctx) => ctx.db.delete(documentId));
    const result = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });
    expect(result).toMatchObject({ success: false, error: { code: "DOCUMENT_NOT_FOUND" } });
  });

  test("support cannot review", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const support = await makeStaff(t, "support");
    const documentId = await attachOk(t, fx);
    await expect(
      t
        .withIdentity(support)
        .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId }),
    ).rejects.toThrow(/Requires 'compliance'/);
  });

  test("agency users cannot review their own upload", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const documentId = await attachOk(t, fx);
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId }),
    ).rejects.toThrow(/Not a Mutav staff member/);
  });
});

describe("rejectGuaranteeDocument", () => {
  test("stores the trimmed reason, audits, and schedules the agency email", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const documentId = await attachOk(t, fx);
    const result = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.rejectGuaranteeDocument, {
        documentId,
        reason: "  Assinatura do locador ausente  ",
      });
    expect(result).toMatchObject({ success: true, data: { status: "rejected" } });
    const { row, scheduled } = await t.run(async (ctx) => {
      return {
        row: await ctx.db.get(documentId),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      };
    });
    expect(row).toMatchObject({
      status: "rejected",
      rejectionReason: "Assinatura do locador ausente",
    });
    expect(await auditActions(t)).toEqual([
      "guarantee.document_attached",
      "guarantee.document_rejected",
    ]);
    expect(scheduled.map((job) => job.name)).toContain(
      "guarantees/actions:sendDocumentRejectedEmail",
    );
  });

  test("skips the email when the agency has no address", async () => {
    const t = setup();
    const fx = await makeFixture(t, { agencyEmail: "" });
    const compliance = await makeStaff(t, "compliance");
    const documentId = await attachOk(t, fx);
    await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.rejectGuaranteeDocument, {
        documentId,
        reason: "Ilegível",
      });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => job.name)).not.toContain(
      "guarantees/actions:sendDocumentRejectedEmail",
    );
  });

  test("REJECTION_REASON_REQUIRED and REJECTION_REASON_TOO_LONG", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const documentId = await attachOk(t, fx);
    const blank = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.rejectGuaranteeDocument, {
        documentId,
        reason: "   ",
      });
    expect(blank).toMatchObject({ success: false, error: { code: "REJECTION_REASON_REQUIRED" } });
    const long = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.rejectGuaranteeDocument, {
        documentId,
        reason: "x".repeat(1001),
      });
    expect(long).toMatchObject({ success: false, error: { code: "REJECTION_REASON_TOO_LONG" } });
    expect(await t.run(async (ctx) => (await ctx.db.get(documentId))?.status)).toBe(
      "pending_review",
    );
  });

  test("NOT_PENDING_REVIEW and DOCUMENT_NOT_FOUND", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const documentId = await attachOk(t, fx);
    await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });
    const decided = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.rejectGuaranteeDocument, {
        documentId,
        reason: "late",
      });
    expect(decided).toMatchObject({ success: false, error: { code: "NOT_PENDING_REVIEW" } });
    await t.run((ctx) => ctx.db.delete(documentId));
    const missing = await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.rejectGuaranteeDocument, {
        documentId,
        reason: "gone",
      });
    expect(missing).toMatchObject({ success: false, error: { code: "DOCUMENT_NOT_FOUND" } });
  });

  test("support cannot reject", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const support = await makeStaff(t, "support");
    const documentId = await attachOk(t, fx);
    await expect(
      t.withIdentity(support).mutation(api.guarantees.staffDocuments.rejectGuaranteeDocument, {
        documentId,
        reason: "no",
      }),
    ).rejects.toThrow(/Requires 'compliance'/);
  });
});

describe("staff reads", () => {
  test("listDocumentsForGuarantee names uploader and reviewer", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const support = await makeStaff(t, "support");
    const documentId = await attachOk(t, fx);
    await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId });
    const result = await t
      .withIdentity(support)
      .query(api.guarantees.staffDocuments.listDocumentsForGuarantee, { publicId: fx.publicId });
    expect(result?.guaranteeStatus).toBe("drafted");
    expect(result?.documents).toMatchObject([
      {
        status: "approved",
        uploadedBy: { kind: "agency_user", name: "Agency User 1" },
        reviewedByName: "Staff compliance",
      },
    ]);
  });

  test("listDocumentsForGuarantee is null for an unknown guarantee and refused to non-staff", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const support = await makeStaff(t, "support");
    expect(
      await t
        .withIdentity(support)
        .query(api.guarantees.staffDocuments.listDocumentsForGuarantee, { publicId: "nope" }),
    ).toBeNull();
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .query(api.guarantees.staffDocuments.listDocumentsForGuarantee, { publicId: fx.publicId }),
    ).rejects.toThrow(/Not a Mutav staff member/);
  });

  test("listDocumentsPendingReview is cross-agency, oldest first, pending only", async () => {
    const t = setup();
    const a = await makeFixture(t, { suffix: "1" });
    const b = await makeFixture(t, { suffix: "2" });
    const compliance = await makeStaff(t, "compliance");
    const first = await attachOk(t, a, "rentalContract");
    await attachOk(t, b, "inspection");
    const decided = await attachOk(t, a, "policy");
    await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId: decided });

    const queue = await t
      .withIdentity(compliance)
      .query(api.guarantees.staffDocuments.listDocumentsPendingReview, {});
    expect(queue.hasMore).toBe(false);
    expect(queue.rows.map((row) => [row.agencyName, row.guaranteePublicId, row.key])).toEqual([
      ["Agency 1", "GD-1", "rentalContract"],
      ["Agency 2", "GD-2", "inspection"],
    ]);
    expect(queue.rows[0]?.id).toBe(first);
    expect(queue.rows[0]?.tenantName).toBe("Test Tenant");
    expect(queue.rows[0]?.property?.streetAndNumber).toBe("Rua Teste, 1");
  });

  test("listDocumentsPendingReview requires compliance", async () => {
    const t = setup();
    const support = await makeStaff(t, "support");
    await expect(
      t.withIdentity(support).query(api.guarantees.staffDocuments.listDocumentsPendingReview, {}),
    ).rejects.toThrow(/Requires 'compliance'/);
  });

  test("getStaffGuaranteeDocumentUrl resolves for support, null for a missing row", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const support = await makeStaff(t, "support");
    const documentId = await attachOk(t, fx);
    expect(
      typeof (await t
        .withIdentity(support)
        .query(api.guarantees.staffDocuments.getStaffGuaranteeDocumentUrl, { documentId })),
    ).toBe("string");
    await t.run((ctx) => ctx.db.delete(documentId));
    expect(
      await t
        .withIdentity(support)
        .query(api.guarantees.staffDocuments.getStaffGuaranteeDocumentUrl, { documentId }),
    ).toBeNull();
  });
});

describe("hasApprovedSignedContract", () => {
  test("false until compliance approves a rental contract, then true", async () => {
    const t = setup();
    const fx = await makeFixture(t);
    const compliance = await makeStaff(t, "compliance");
    const inspection = await attachOk(t, fx, "inspection");
    await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, {
        documentId: inspection,
      });
    const contract = await attachOk(t, fx, "rentalContract");
    expect(await t.run((ctx) => hasApprovedSignedContract(ctx, fx.guaranteeId))).toBe(false);
    await t
      .withIdentity(compliance)
      .mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, { documentId: contract });
    expect(await t.run((ctx) => hasApprovedSignedContract(ctx, fx.guaranteeId))).toBe(true);
  });
});
