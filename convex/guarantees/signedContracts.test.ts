// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import type { MutavStaffRole } from "../mutavStaff/domain";
import type { StorageId } from "../lib/storage";
import type { AuditEntry } from "../audit/domain";
import { registerGuaranteeAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import { GUARANTEE_STATE, type GuaranteeId, type GuaranteeState } from "./domain";
import schema from "../schema";

type T = TestConvex<typeof schema>;

const PDF = "application/pdf";
const TEN_MIB = 10 * 1024 * 1024;

function setup(): T {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

type Fixture = { subject: string; userId: UserId; agencyId: AgencyId };

async function makeFixture(t: T, suffix: string): Promise<Fixture> {
  const subject = `auth0|user-${suffix}`;
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `user-${suffix}`,
      subject,
      name: `Fixture User ${suffix}`,
      email: `fixture-${suffix}@test.br`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: `Fixture Agency ${suffix}`,
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
  return { subject, ...ids };
}

async function makeStaff(t: T, role: MutavStaffRole): Promise<{ subject: string; userId: UserId }> {
  const subject = `auth0|staff-${role}`;
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `staff-${role}`,
      subject,
      name: `Staff ${role}`,
      email: `staff-${role}@mutav.finance`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("mutavStaff", { userId, role, createdAt: "2026-01-01T00:00:00.000Z" });
    return userId;
  });
  return { subject, userId };
}

type RawDb = { patch(id: string, value: Record<string, unknown>): Promise<void> };

/**
 * Stand-in for the browser's POST to an upload URL. convex-test's
 * `storage.store` drops the Blob's type, so the content type the real upload
 * endpoint records on the `_storage` row is patched in afterwards.
 */
async function storeUpload(
  t: T,
  { contentType = PDF, sizeBytes = 2048 }: { contentType?: string | null; sizeBytes?: number } = {},
): Promise<StorageId> {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([new Uint8Array(sizeBytes)]));
    if (contentType !== null) {
      // hook-ok: test harness — the system table is not in the typed data model
      await (ctx.db as unknown as RawDb).patch(storageId, { contentType });
    }
    return storageId;
  });
}

async function storageExists(t: T, storageId: StorageId): Promise<boolean> {
  return t.run(async (ctx) => (await ctx.db.system.get("_storage", storageId)) !== null);
}

async function seedGuarantee(t: T, fx: Fixture, publicId: string, status: GuaranteeState) {
  return seedGuaranteeWithLease(
    t,
    {
      agencyId: fx.agencyId,
      status,
      activatedAt: status === GUARANTEE_STATE.DRAFTED ? null : "2026-02-01T00:00:00.000Z",
    },
    publicId,
  );
}

async function contractRows(t: T, guaranteeId: GuaranteeId) {
  return t.run((ctx) =>
    ctx.db
      .query("guaranteeSignedContracts")
      .withIndex("by_guarantee", (q) => q.eq("guaranteeId", guaranteeId))
      .collect(),
  );
}

async function auditFor(t: T, publicId: string): Promise<AuditEntry[]> {
  const rows = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
  return rows.filter((row) => row.resourceId === publicId);
}

async function agencyAttach(
  t: T,
  fx: Fixture,
  {
    publicId,
    storageId,
    fileName = "contrato.pdf",
  }: { publicId: string; storageId: StorageId; fileName?: string },
) {
  return t.withIdentity({ subject: fx.subject }).mutation(api.guarantees.signedContracts.attach, {
    agencyId: fx.agencyId,
    publicId,
    storageId,
    fileName,
  });
}

describe("signed contract — agency upload", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
  });

  test("mints an upload URL for its own draft", async () => {
    await seedGuarantee(t, fx, "S1", GUARANTEE_STATE.DRAFTED);
    const result = await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.guarantees.signedContracts.generateUploadUrl, {
        agencyId: fx.agencyId,
        publicId: "S1",
      });
    expect(result.success).toBe(true);
  });

  test("puts the PDF on file with uploader, time, name, size and an audit row", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "S2", GUARANTEE_STATE.DRAFTED);
    const storageId = await storeUpload(t, { sizeBytes: 4096 });

    const result = await agencyAttach(t, fx, {
      publicId: "S2",
      storageId,
      fileName: " contrato.pdf ",
    });

    expect(result).toMatchObject({ success: true, data: { publicId: "S2", replaced: false } });
    const rows = await contractRows(t, guaranteeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      storageId,
      fileName: "contrato.pdf",
      sizeBytes: 4096,
      uploadedBy: { kind: "agency", userId: fx.userId, name: "Fixture User 1" },
    });
    expect(rows[0].uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const audit = await auditFor(t, "S2");
    expect(audit.map((row) => row.action)).toEqual(["guarantee.signed_contract_uploaded"]);
    expect(audit[0].actor).toEqual({ kind: "user", userId: fx.userId });
  });

  test("replacing before activation swaps the file, deletes the old blob and audits the replace", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "S3", GUARANTEE_STATE.DRAFTED);
    const first = await storeUpload(t);
    const second = await storeUpload(t, { sizeBytes: 8192 });
    await agencyAttach(t, fx, { publicId: "S3", storageId: first, fileName: "v1.pdf" });

    const result = await agencyAttach(t, fx, {
      publicId: "S3",
      storageId: second,
      fileName: "v2.pdf",
    });

    expect(result).toMatchObject({ success: true, data: { replaced: true } });
    const rows = await contractRows(t, guaranteeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ storageId: second, fileName: "v2.pdf", sizeBytes: 8192 });
    expect(await storageExists(t, first)).toBe(false);

    const audit = await auditFor(t, "S3");
    expect(audit.map((row) => row.action)).toEqual([
      "guarantee.signed_contract_uploaded",
      "guarantee.signed_contract_replaced",
    ]);
    expect(audit[1].resourceType).toBe("guarantees");
  });

  test("refuses a file that is already on file elsewhere without deleting it", async () => {
    await seedGuarantee(t, fx, "S4", GUARANTEE_STATE.DRAFTED);
    await seedGuarantee(t, fx, "S5", GUARANTEE_STATE.DRAFTED);
    const storageId = await storeUpload(t);
    await agencyAttach(t, fx, { publicId: "S4", storageId });

    const result = await agencyAttach(t, fx, { publicId: "S5", storageId });

    expect(result).toMatchObject({ success: false, error: { code: "FILE_ALREADY_ATTACHED" } });
    expect(await storageExists(t, storageId)).toBe(true);
  });
});

describe("signed contract — file validation", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
    await seedGuarantee(t, fx, "V1", GUARANTEE_STATE.DRAFTED);
  });

  test.each([
    { label: "an image", contentType: "image/png", fileName: "contrato.pdf" },
    { label: "a file with no recorded type", contentType: null, fileName: "contrato.pdf" },
    { label: "a PDF type with a non-PDF name", contentType: PDF, fileName: "contrato.exe" },
  ])(
    "refuses $label as INVALID_FILE_TYPE and discards the blob",
    async ({ contentType, fileName }) => {
      const storageId = await storeUpload(t, { contentType });

      const result = await agencyAttach(t, fx, { publicId: "V1", storageId, fileName });

      expect(result).toMatchObject({ success: false, error: { code: "INVALID_FILE_TYPE" } });
      expect(await storageExists(t, storageId)).toBe(false);
    },
  );

  test("refuses a file over 10 MiB as FILE_TOO_LARGE", async () => {
    const storageId = await storeUpload(t, { sizeBytes: TEN_MIB + 1 });

    const result = await agencyAttach(t, fx, { publicId: "V1", storageId });

    expect(result).toMatchObject({ success: false, error: { code: "FILE_TOO_LARGE" } });
    expect(await storageExists(t, storageId)).toBe(false);
  });

  test("accepts a file of exactly 10 MiB", async () => {
    const storageId = await storeUpload(t, { sizeBytes: TEN_MIB });

    const result = await agencyAttach(t, fx, { publicId: "V1", storageId });

    expect(result.success).toBe(true);
  });

  test("refuses a storage id that does not exist as FILE_NOT_FOUND", async () => {
    const storageId = await storeUpload(t);
    await t.run((ctx) => ctx.storage.delete(storageId));

    const result = await agencyAttach(t, fx, { publicId: "V1", storageId });

    expect(result).toMatchObject({ success: false, error: { code: "FILE_NOT_FOUND" } });
  });
});

describe("signed contract — locked after activation", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
  });

  test("activation needs the contract, then the contract can no longer be replaced", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "L1", GUARANTEE_STATE.DRAFTED);
    const asAgency = t.withIdentity({ subject: fx.subject });

    const refused = await asAgency.mutation(api.guarantees.mutations.activate, {
      agencyId: fx.agencyId,
      publicId: "L1",
    });
    expect(refused).toMatchObject({ success: false, error: { code: "SIGNED_CONTRACT_REQUIRED" } });

    const first = await storeUpload(t);
    await agencyAttach(t, fx, { publicId: "L1", storageId: first });
    const activated = await asAgency.mutation(api.guarantees.mutations.activate, {
      agencyId: fx.agencyId,
      publicId: "L1",
    });
    expect(activated.success).toBe(true);

    const urlAfter = await asAgency.mutation(api.guarantees.signedContracts.generateUploadUrl, {
      agencyId: fx.agencyId,
      publicId: "L1",
    });
    expect(urlAfter).toMatchObject({ success: false, error: { code: "SIGNED_CONTRACT_LOCKED" } });

    const late = await storeUpload(t);
    const replace = await agencyAttach(t, fx, { publicId: "L1", storageId: late });
    expect(replace).toMatchObject({ success: false, error: { code: "SIGNED_CONTRACT_LOCKED" } });

    const rows = await contractRows(t, guaranteeId);
    expect(rows).toHaveLength(1);
    expect(rows[0].storageId).toBe(first);
    expect(await storageExists(t, first)).toBe(true);
    expect(await storageExists(t, late)).toBe(false);

    const audit = await auditFor(t, "L1");
    expect(audit.map((row) => row.action)).toEqual([
      "guarantee.signed_contract_uploaded",
      "guarantee.transitioned",
    ]);
  });

  test("staff cannot replace it after activation either", async () => {
    await seedGuarantee(t, fx, "L2", GUARANTEE_STATE.ACTIVE);
    const staff = await makeStaff(t, "compliance");
    const storageId = await storeUpload(t);

    const result = await t
      .withIdentity({ subject: staff.subject })
      .mutation(api.guarantees.signedContracts.staffAttach, {
        publicId: "L2",
        storageId,
        fileName: "c.pdf",
      });

    expect(result).toMatchObject({ success: false, error: { code: "SIGNED_CONTRACT_LOCKED" } });
  });
});

describe("signed contract — cross-agency isolation", () => {
  let t: T;
  let fx: Fixture;
  let other: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
    other = await makeFixture(t, "2");
    await seedGuarantee(t, other, "X1", GUARANTEE_STATE.DRAFTED);
  });

  test("an agency cannot mint an upload URL for another agency's guarantee", async () => {
    const result = await t
      .withIdentity({ subject: fx.subject })
      .mutation(api.guarantees.signedContracts.generateUploadUrl, {
        agencyId: fx.agencyId,
        publicId: "X1",
      });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  test("an agency cannot attach to another agency's guarantee", async () => {
    const storageId = await storeUpload(t);
    const result = await agencyAttach(t, fx, { publicId: "X1", storageId });
    expect(result).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  test("an agency cannot act under an agency it is not a member of", async () => {
    const storageId = await storeUpload(t);
    await expect(
      t.withIdentity({ subject: fx.subject }).mutation(api.guarantees.signedContracts.attach, {
        agencyId: other.agencyId,
        publicId: "X1",
        storageId,
        fileName: "c.pdf",
      }),
    ).rejects.toThrow(/not a member/);
  });

  test("an agency cannot read or download another agency's contract", async () => {
    const storageId = await storeUpload(t);
    await agencyAttach(t, other, { publicId: "X1", storageId });

    const own = await t
      .withIdentity({ subject: other.subject })
      .query(api.guarantees.signedContracts.get, { agencyId: other.agencyId, publicId: "X1" });
    expect(own?.downloadUrl).toEqual(expect.any(String));

    const foreign = await t
      .withIdentity({ subject: fx.subject })
      .query(api.guarantees.signedContracts.get, { agencyId: fx.agencyId, publicId: "X1" });
    expect(foreign).toBeNull();

    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .query(api.guarantees.signedContracts.get, { agencyId: other.agencyId, publicId: "X1" }),
    ).rejects.toThrow(/not a member/);
  });
});

describe("signed contract — Mutav staff", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
  });

  test("compliance staff upload to an agency's draft; the agency sees Mutav, not the name", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "M1", GUARANTEE_STATE.DRAFTED);
    const staff = await makeStaff(t, "compliance");
    const asStaff = t.withIdentity({ subject: staff.subject });

    const url = await asStaff.mutation(api.guarantees.signedContracts.staffGenerateUploadUrl, {
      publicId: "M1",
    });
    expect(url.success).toBe(true);

    const storageId = await storeUpload(t);
    const result = await asStaff.mutation(api.guarantees.signedContracts.staffAttach, {
      publicId: "M1",
      storageId,
      fileName: "assinado.pdf",
    });
    expect(result).toMatchObject({ success: true, data: { replaced: false } });

    const rows = await contractRows(t, guaranteeId);
    expect(rows[0].uploadedBy).toEqual({
      kind: "staff",
      userId: staff.userId,
      name: "Staff compliance",
    });

    const audit = await auditFor(t, "M1");
    expect(audit.map((row) => row.action)).toEqual(["guarantee.signed_contract_uploaded"]);
    expect(audit[0].actor).toEqual({ kind: "user", userId: staff.userId });

    const agencyView = await t
      .withIdentity({ subject: fx.subject })
      .query(api.guarantees.signedContracts.get, { agencyId: fx.agencyId, publicId: "M1" });
    expect(agencyView?.uploadedBy).toEqual({ kind: "staff", name: null });

    const staffView = await asStaff.query(api.guarantees.signedContracts.staffGetGuarantee, {
      publicId: "M1",
    });
    expect(staffView).toMatchObject({
      publicId: "M1",
      status: "drafted",
      agencyName: "Fixture Agency 1",
      signedContract: {
        fileName: "assinado.pdf",
        uploadedBy: { kind: "staff", name: "Staff compliance" },
      },
      viewerCanUpload: true,
    });
  });

  test("staff replace an agency's upload before activation", async () => {
    await seedGuarantee(t, fx, "M2", GUARANTEE_STATE.DRAFTED);
    await agencyAttach(t, fx, { publicId: "M2", storageId: await storeUpload(t) });
    const staff = await makeStaff(t, "compliance");

    const result = await t
      .withIdentity({ subject: staff.subject })
      .mutation(api.guarantees.signedContracts.staffAttach, {
        publicId: "M2",
        storageId: await storeUpload(t),
        fileName: "corrigido.pdf",
      });

    expect(result).toMatchObject({ success: true, data: { replaced: true } });
    expect((await auditFor(t, "M2")).map((row) => row.action)).toEqual([
      "guarantee.signed_contract_uploaded",
      "guarantee.signed_contract_replaced",
    ]);
  });

  test("support staff may read but not upload", async () => {
    await seedGuarantee(t, fx, "M3", GUARANTEE_STATE.DRAFTED);
    const support = await makeStaff(t, "support");
    const asSupport = t.withIdentity({ subject: support.subject });

    expect(
      await asSupport.query(api.guarantees.signedContracts.staffGetGuarantee, { publicId: "M3" }),
    ).toMatchObject({ publicId: "M3", signedContract: null, viewerCanUpload: false });
    await expect(
      asSupport.mutation(api.guarantees.signedContracts.staffGenerateUploadUrl, { publicId: "M3" }),
    ).rejects.toThrow(/compliance/);
  });

  test("staff cannot activate, even with a signed contract on file", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "M4", GUARANTEE_STATE.DRAFTED);
    const staff = await makeStaff(t, "admin");
    const asStaff = t.withIdentity({ subject: staff.subject });
    await asStaff.mutation(api.guarantees.signedContracts.staffAttach, {
      publicId: "M4",
      storageId: await storeUpload(t),
      fileName: "c.pdf",
    });

    await expect(
      asStaff.mutation(api.guarantees.mutations.activate, {
        agencyId: fx.agencyId,
        publicId: "M4",
      }),
    ).rejects.toThrow(/not a member/);
    const after = await t.run((ctx) => ctx.db.get(guaranteeId));
    expect(after?.status).toBe(GUARANTEE_STATE.DRAFTED);
  });

  test("non-staff users are refused by the staff surface", async () => {
    await seedGuarantee(t, fx, "M5", GUARANTEE_STATE.DRAFTED);
    await expect(
      t
        .withIdentity({ subject: fx.subject })
        .mutation(api.guarantees.signedContracts.staffGenerateUploadUrl, { publicId: "M5" }),
    ).rejects.toThrow(/Not a Mutav staff member/);
  });
});
