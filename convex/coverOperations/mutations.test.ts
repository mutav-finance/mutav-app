// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  registerGuaranteeAggregateComponents,
  seedCoverCandidate,
  seedCoverNotice,
  type CoverCandidate,
} from "../lib/testFixtures";
import type { MutavStaffRole } from "../mutavStaff/domain";
import type { GuaranteeId } from "../guarantees/domain";
import type { DelinquencyNoticeId } from "../delinquencies/domain";
import schema from "../schema";

function setup() {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

type T = ReturnType<typeof setup>;

const CEILING_CENTS = 9_000_000;

function orThrow<TValue>(value: TValue | null | undefined, label: string): TValue {
  if (value === null || value === undefined) throw new Error(`Expected non-null ${label}.`);
  return value;
}

async function grantStaffRole(t: T, candidate: CoverCandidate, role: MutavStaffRole) {
  await t.run((ctx) =>
    ctx.db.insert("mutavStaff", {
      userId: candidate.userId,
      role,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  return t.withIdentity({ subject: candidate.subject });
}

async function readGuarantee(t: T, guaranteeId: GuaranteeId) {
  return orThrow(await t.run((ctx) => ctx.db.get(guaranteeId)), "guarantee row");
}

async function readNotice(t: T, noticeId: DelinquencyNoticeId) {
  return orThrow(await t.run((ctx) => ctx.db.get(noticeId)), "notice row");
}

async function readOperations(t: T) {
  return t.run((ctx) => ctx.db.query("coverOperations").collect());
}

async function readAuditActions(t: T) {
  const entries = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
  return entries.map((entry) => entry.action);
}

// ---------------------------------------------------------------------------
// staffRecordCover — one notice, no batch
// ---------------------------------------------------------------------------

describe("staffRecordCover", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-single-noauth" });
    await expect(
      t.mutation(api.coverOperations.mutations.staffRecordCover, {
        noticePublicId: "DN-single-noauth",
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("staff below compliance → throws", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-single-support" });
    const asSupport = await grantStaffRole(t, a, "support");
    await expect(
      asSupport.mutation(api.coverOperations.mutations.staffRecordCover, {
        noticePublicId: "DN-single-support",
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("records a ledger row, links the notice to it, and audits both", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const noticeId = await seedCoverNotice(t, a, {
      publicId: "DN-single-happy",
      rentDueDate: "2026-06-05",
      updatedAmountCents: 250_000,
    });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const before = Date.now();
    const result = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
      noticePublicId: "DN-single-happy",
      note: "Reserve drawn per case #42.",
    });
    const after = Date.now();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.noticePublicId).toBe("DN-single-happy");
    expect(result.data.appliedCoverCents).toBe(250_000);
    expect(result.data.operationPublicId).toMatch(/^COV-[0-9A-Z]{8}$/);

    const operations = await readOperations(t);
    expect(operations.length).toBe(1);
    const operation = operations[0];
    expect(operation.publicId).toBe(result.data.operationPublicId);
    expect(operation.status).toBe("recorded");
    expect(operation.noticeId).toBe(noticeId);
    expect(operation.guaranteeId).toBe(a.guaranteeId);
    expect(operation.agencyId).toBe(a.agencyId);
    expect(operation.coveragePeriod).toBe("2026-06");
    expect(operation.batchId).toBeUndefined();
    expect(operation.requestedCents).toBe(250_000);
    expect(operation.appliedCents).toBe(250_000);
    expect(operation.recordedByUserId).toBe(a.userId);
    expect(operation.note).toBe("Reserve drawn per case #42.");
    expect(operation.execution).toBeUndefined();
    const recordedAtMs = Date.parse(operation.recordedAt);
    expect(recordedAtMs).toBeGreaterThanOrEqual(before);
    expect(recordedAtMs).toBeLessThanOrEqual(after);

    const notice = await readNotice(t, noticeId);
    expect(notice.status).toBe("resolved");
    expect(notice.resolution?.kind).toBe("cover_committed");
    expect(notice.resolution?.coverOperationId).toBe(operation._id);
    expect(notice.resolution?.coverOperationPublicId).toBe(operation.publicId);
    expect(notice.resolution?.appliedCoverCents).toBe(250_000);

    const guarantee = await readGuarantee(t, a.guaranteeId);
    expect(guarantee.status).toBe("cover_committed");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 8_750_000,
      reservedCents: 250_000,
    });

    const opAudit = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "coverOperations").eq("resourceId", operation.publicId),
        )
        .collect(),
    );
    expect(opAudit.map((entry) => entry.action)).toEqual(["cover_operation.recorded"]);
    expect(opAudit[0].actor).toEqual({ kind: "user", userId: a.userId });
    expect(await readAuditActions(t)).toContain("delinquency.resolved_by_cover");
  });

  test("a second notice for the same guarantee and billing month → COVER_ALREADY_RECORDED", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-idem-first", rentDueDate: "2026-06-05" });
    const secondId = await seedCoverNotice(t, a, {
      publicId: "DN-idem-second",
      rentDueDate: "2026-06-20",
      updatedAmountCents: 100_000,
    });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const first = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
      noticePublicId: "DN-idem-first",
    });
    expect(first.success).toBe(true);
    const auditBefore = (await readAuditActions(t)).length;

    const second = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
      noticePublicId: "DN-idem-second",
    });
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.code).toBe("COVER_ALREADY_RECORDED");

    expect((await readOperations(t)).length).toBe(1);
    expect((await readNotice(t, secondId)).status).toBe("verified");
    expect((await readGuarantee(t, a.guaranteeId)).capacity.reservedCents).toBe(300_000);
    expect((await readAuditActions(t)).length).toBe(auditBefore);
  });

  test("the same notice cannot be covered twice → SELF_TRANSITION, no second row", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-twice" });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const first = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
      noticePublicId: "DN-twice",
    });
    expect(first.success).toBe(true);
    const second = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
      noticePublicId: "DN-twice",
    });
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.code).toBe("SELF_TRANSITION");
    expect((await readOperations(t)).length).toBe(1);
  });

  test("a later billing month on a covered guarantee draws again without a second hop", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-month-6", rentDueDate: "2026-06-05" });
    await seedCoverNotice(t, a, {
      publicId: "DN-month-7",
      rentDueDate: "2026-07-05",
      updatedAmountCents: 100_000,
    });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    for (const noticePublicId of ["DN-month-6", "DN-month-7"]) {
      const result = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
        noticePublicId,
      });
      expect(result.success).toBe(true);
    }

    const periods = (await readOperations(t)).map((op) => op.coveragePeriod).sort();
    expect(periods).toEqual(["2026-06", "2026-07"]);
    expect((await readGuarantee(t, a.guaranteeId)).capacity.reservedCents).toBe(400_000);
  });
});

// ---------------------------------------------------------------------------
// staffRecordCoverBatch — many notices, one transaction
// ---------------------------------------------------------------------------

describe("staffRecordCoverBatch", () => {
  test("staff below compliance → throws", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-batch-support" });
    const asSupport = await grantStaffRole(t, a, "support");
    await expect(
      asSupport.mutation(api.coverOperations.mutations.staffRecordCoverBatch, {
        noticePublicIds: ["DN-batch-support"],
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("empty selection → EMPTY_BATCH", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const asCompliance = await grantStaffRole(t, a, "compliance");
    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: [] },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("EMPTY_BATCH");
  });

  test("more than 25 notices → BATCH_TOO_LARGE", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const asCompliance = await grantStaffRole(t, a, "compliance");
    const noticePublicIds = Array.from({ length: 26 }, (_, i) => `DN-many-${i}`);
    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("BATCH_TOO_LARGE");
  });

  test("the same notice twice → DUPLICATE_NOTICE_IN_BATCH", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-dup" });
    const asCompliance = await grantStaffRole(t, a, "compliance");
    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: ["DN-dup", "DN-dup"] },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("DUPLICATE_NOTICE_IN_BATCH");
    expect(result.error.noticePublicId).toBe("DN-dup");
    expect((await readOperations(t)).length).toBe(0);
  });

  test("covers notices across agencies in one call, one row each under a shared batchId", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const b = await seedCoverCandidate(t, { suffix: "2" });
    const noticeA = await seedCoverNotice(t, a, {
      publicId: "DN-batch-a",
      rentDueDate: "2026-05-05",
      updatedAmountCents: 200_000,
    });
    const noticeB = await seedCoverNotice(t, b, {
      publicId: "DN-batch-b",
      rentDueDate: "2026-06-05",
      updatedAmountCents: 150_000,
    });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: ["DN-batch-a", "DN-batch-b"], note: "Weekly cover run." },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batchId).toMatch(/^CVB-[0-9A-Z]{8}$/);
    expect(result.data.operations.map((op) => [op.noticePublicId, op.appliedCoverCents])).toEqual([
      ["DN-batch-a", 200_000],
      ["DN-batch-b", 150_000],
    ]);

    const operations = await readOperations(t);
    expect(operations.length).toBe(2);
    for (const operation of operations) {
      expect(operation.batchId).toBe(result.data.batchId);
      expect(operation.status).toBe("recorded");
      expect(operation.note).toBe("Weekly cover run.");
    }
    const byNotice = new Map(operations.map((op) => [op.noticeId, op]));
    expect(byNotice.get(noticeA)?.agencyId).toBe(a.agencyId);
    expect(byNotice.get(noticeA)?.coveragePeriod).toBe("2026-05");
    expect(byNotice.get(noticeB)?.agencyId).toBe(b.agencyId);
    expect(byNotice.get(noticeB)?.coveragePeriod).toBe("2026-06");

    for (const [noticeId, guaranteeId] of [
      [noticeA, a.guaranteeId],
      [noticeB, b.guaranteeId],
    ] as const) {
      const notice = await readNotice(t, noticeId);
      expect(notice.status).toBe("resolved");
      expect(notice.resolution?.coverOperationId).toBe(byNotice.get(noticeId)?._id);
      expect((await readGuarantee(t, guaranteeId)).status).toBe("cover_committed");
    }

    const actions = await readAuditActions(t);
    expect(actions.filter((action) => action === "cover_operation.recorded").length).toBe(2);
    expect(actions.filter((action) => action === "delinquency.resolved_by_cover").length).toBe(2);
  });

  test("two billing months of one guarantee in one batch: one state hop, two reservations", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, {
      publicId: "DN-pair-6",
      rentDueDate: "2026-06-05",
      updatedAmountCents: 250_000,
    });
    await seedCoverNotice(t, a, {
      publicId: "DN-pair-7",
      rentDueDate: "2026-07-05",
      updatedAmountCents: 100_000,
    });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: ["DN-pair-6", "DN-pair-7"] },
    );
    expect(result.success).toBe(true);

    const guarantee = await readGuarantee(t, a.guaranteeId);
    expect(guarantee.status).toBe("cover_committed");
    expect(guarantee.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: 8_650_000,
      reservedCents: 350_000,
    });
    const guaranteeAudit = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "guarantees").eq("resourceId", a.guaranteePublicId),
        )
        .collect(),
    );
    expect(guaranteeAudit.map((entry) => entry.action)).toEqual([
      "guarantee.capacity_reserved",
      "guarantee.transitioned",
      "guarantee.capacity_reserved",
    ]);
  });

  test("atomic: one unverified notice refuses the whole batch and nothing is written", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const b = await seedCoverCandidate(t, { suffix: "2" });
    const noticeA = await seedCoverNotice(t, a, { publicId: "DN-atomic-ok" });
    const noticeB = await seedCoverNotice(t, b, { publicId: "DN-atomic-open", status: "open" });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: ["DN-atomic-ok", "DN-atomic-open"] },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_NOT_VERIFIED");
    expect(result.error.noticePublicId).toBe("DN-atomic-open");

    expect(await readOperations(t)).toEqual([]);
    expect((await readNotice(t, noticeA)).status).toBe("verified");
    expect((await readNotice(t, noticeB)).status).toBe("open");
    const guaranteeA = await readGuarantee(t, a.guaranteeId);
    expect(guaranteeA.status).toBe("default_verified");
    expect(guaranteeA.capacity.reservedCents).toBe(0);
    expect(await readAuditActions(t)).toEqual([]);
  });

  test("atomic: an unknown notice anywhere in the batch refuses all of it", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const noticeA = await seedCoverNotice(t, a, { publicId: "DN-known" });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: ["DN-known", "DN-ghost"] },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOTICE_NOT_FOUND");
    expect(result.error.noticePublicId).toBe("DN-ghost");
    expect(await readOperations(t)).toEqual([]);
    expect((await readNotice(t, noticeA)).status).toBe("verified");
  });

  test("atomic: a guarantee not in default refuses the batch before any capacity moves", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const b = await seedCoverCandidate(t, { suffix: "2", status: "active" });
    await seedCoverNotice(t, a, { publicId: "DN-default-ok" });
    await seedCoverNotice(t, b, { publicId: "DN-still-active" });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: ["DN-default-ok", "DN-still-active"] },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("GUARANTEE_TRANSITION_REFUSED");
    expect(result.error.noticePublicId).toBe("DN-still-active");
    expect((await readGuarantee(t, a.guaranteeId)).capacity.reservedCents).toBe(0);
    expect(await readOperations(t)).toEqual([]);
  });

  test("idempotent: two notices of one guarantee in the same billing month → COVER_ALREADY_RECORDED", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-same-month-1", rentDueDate: "2026-06-05" });
    await seedCoverNotice(t, a, { publicId: "DN-same-month-2", rentDueDate: "2026-06-25" });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: ["DN-same-month-1", "DN-same-month-2"] },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("COVER_ALREADY_RECORDED");
    expect(result.error.noticePublicId).toBe("DN-same-month-2");
    expect(await readOperations(t)).toEqual([]);
  });

  test("idempotent: a batch touching an already-covered period is refused whole", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const b = await seedCoverCandidate(t, { suffix: "2" });
    await seedCoverNotice(t, a, { publicId: "DN-prior", rentDueDate: "2026-06-05" });
    await seedCoverNotice(t, a, { publicId: "DN-prior-dup", rentDueDate: "2026-06-18" });
    const noticeB = await seedCoverNotice(t, b, { publicId: "DN-fresh" });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const prior = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
      noticePublicId: "DN-prior",
    });
    expect(prior.success).toBe(true);

    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffRecordCoverBatch,
      { noticePublicIds: ["DN-fresh", "DN-prior-dup"] },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("COVER_ALREADY_RECORDED");
    expect((await readOperations(t)).length).toBe(1);
    expect((await readNotice(t, noticeB)).status).toBe("verified");
    expect((await readGuarantee(t, b.guaranteeId)).capacity.reservedCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// staffMarkCoverExecuted — recorded → executed
// ---------------------------------------------------------------------------

async function recordOne(t: T, candidate: CoverCandidate, noticePublicId: string) {
  await seedCoverNotice(t, candidate, { publicId: noticePublicId });
  const asCompliance = await grantStaffRole(t, candidate, "compliance");
  const result = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
    noticePublicId,
  });
  if (!result.success) throw new Error(`fixture cover failed: ${result.message}`);
  return { asCompliance, operationPublicId: result.data.operationPublicId };
}

describe("staffMarkCoverExecuted", () => {
  test("staff below compliance → throws", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const { operationPublicId } = await recordOne(t, a, "DN-exec-support");
    const b = await seedCoverCandidate(t, { suffix: "2" });
    const asSupport = await grantStaffRole(t, b, "support");
    await expect(
      asSupport.mutation(api.coverOperations.mutations.staffMarkCoverExecuted, {
        operationPublicId,
        paymentReference: "E2E-123",
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("unknown operation → COVER_OPERATION_NOT_FOUND", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const asCompliance = await grantStaffRole(t, a, "compliance");
    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffMarkCoverExecuted,
      { operationPublicId: "COV-NOPE0000", paymentReference: "E2E-123" },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("COVER_OPERATION_NOT_FOUND");
  });

  test("blank payment reference → PAYMENT_REFERENCE_REQUIRED", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const { asCompliance, operationPublicId } = await recordOne(t, a, "DN-exec-blank");
    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffMarkCoverExecuted,
      { operationPublicId, paymentReference: "   " },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("PAYMENT_REFERENCE_REQUIRED");
    expect((await readOperations(t))[0].status).toBe("recorded");
  });

  test("records the payout with its reference and audits it", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const { asCompliance, operationPublicId } = await recordOne(t, a, "DN-exec-happy");

    const before = Date.now();
    const result = await asCompliance.mutation(
      api.coverOperations.mutations.staffMarkCoverExecuted,
      {
        operationPublicId,
        paymentReference: "  E2E-20260701-XYZ  ",
        note: "Pix to landlord.",
      },
    );
    const after = Date.now();
    expect(result.success).toBe(true);

    const operation = (await readOperations(t))[0];
    expect(operation.status).toBe("executed");
    const execution = orThrow(operation.execution, "execution envelope");
    expect(execution.paymentReference).toBe("E2E-20260701-XYZ");
    expect(execution.note).toBe("Pix to landlord.");
    expect(execution.executedByUserId).toBe(a.userId);
    const executedAtMs = Date.parse(execution.executedAt);
    expect(executedAtMs).toBeGreaterThanOrEqual(before);
    expect(executedAtMs).toBeLessThanOrEqual(after);

    const audit = await t.run((ctx) =>
      ctx.db
        .query("mutavAuditLog")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "coverOperations").eq("resourceId", operationPublicId),
        )
        .collect(),
    );
    expect(audit.map((entry) => entry.action)).toEqual([
      "cover_operation.recorded",
      "cover_operation.executed",
    ]);
  });

  test("an executed payout cannot be executed again → COVER_ALREADY_EXECUTED, row unchanged", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const { asCompliance, operationPublicId } = await recordOne(t, a, "DN-exec-twice");
    const first = await asCompliance.mutation(
      api.coverOperations.mutations.staffMarkCoverExecuted,
      { operationPublicId, paymentReference: "E2E-FIRST" },
    );
    expect(first.success).toBe(true);

    const second = await asCompliance.mutation(
      api.coverOperations.mutations.staffMarkCoverExecuted,
      { operationPublicId, paymentReference: "E2E-SECOND" },
    );
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.code).toBe("COVER_ALREADY_EXECUTED");
    expect((await readOperations(t))[0].execution?.paymentReference).toBe("E2E-FIRST");
  });
});
