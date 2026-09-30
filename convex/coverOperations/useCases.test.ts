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
import schema from "../schema";

function setup() {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

type T = ReturnType<typeof setup>;

const FIRST_PAGE = { numItems: 25, cursor: null };

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

describe("listAwaitingPayout", () => {
  test("unauthenticated → throws", async () => {
    const t = setup();
    await expect(
      t.query(api.coverOperations.useCases.listAwaitingPayout, { paginationOpts: FIRST_PAGE }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("staff below compliance → throws", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const asSupport = await grantStaffRole(t, a, "support");
    await expect(
      asSupport.query(api.coverOperations.useCases.listAwaitingPayout, {
        paginationOpts: FIRST_PAGE,
      }),
    ).rejects.toThrow(/compliance/);
  });

  test("lists recorded operations across agencies with the joined references; executed drop out", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    const b = await seedCoverCandidate(t, { suffix: "2" });
    await seedCoverNotice(t, a, {
      publicId: "DN-list-a",
      rentDueDate: "2026-05-05",
      updatedAmountCents: 200_000,
    });
    await seedCoverNotice(t, b, {
      publicId: "DN-list-b",
      rentDueDate: "2026-06-05",
      updatedAmountCents: 150_000,
    });
    const asCompliance = await grantStaffRole(t, a, "compliance");

    const batch = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCoverBatch, {
      noticePublicIds: ["DN-list-a", "DN-list-b"],
      note: "Weekly run.",
    });
    if (!batch.success) throw new Error(batch.message);

    const listed = await asCompliance.query(api.coverOperations.useCases.listAwaitingPayout, {
      paginationOpts: FIRST_PAGE,
    });
    expect(listed.isDone).toBe(true);
    expect(listed.page).toEqual([
      {
        publicId: batch.data.operations[0].operationPublicId,
        batchId: batch.data.batchId,
        noticePublicId: "DN-list-a",
        agencyName: "Cover Agency 1",
        guaranteePublicId: "CTR-COVER1",
        coveragePeriod: "2026-05",
        requestedCents: 200_000,
        appliedCents: 200_000,
        recordedAt: expect.any(String),
        note: "Weekly run.",
      },
      {
        publicId: batch.data.operations[1].operationPublicId,
        batchId: batch.data.batchId,
        noticePublicId: "DN-list-b",
        agencyName: "Cover Agency 2",
        guaranteePublicId: "CTR-COVER2",
        coveragePeriod: "2026-06",
        requestedCents: 150_000,
        appliedCents: 150_000,
        recordedAt: expect.any(String),
        note: "Weekly run.",
      },
    ]);

    const executed = await asCompliance.mutation(
      api.coverOperations.mutations.staffMarkCoverExecuted,
      { operationPublicId: batch.data.operations[0].operationPublicId, paymentReference: "E2E-1" },
    );
    expect(executed.success).toBe(true);

    const after = await asCompliance.query(api.coverOperations.useCases.listAwaitingPayout, {
      paginationOpts: FIRST_PAGE,
    });
    expect(after.page.map((row) => row.noticePublicId)).toEqual(["DN-list-b"]);
  });

  test("oldest recorded first, and a single cover carries no batch", async () => {
    const t = setup();
    const a = await seedCoverCandidate(t, { suffix: "1" });
    await seedCoverNotice(t, a, { publicId: "DN-order-late", rentDueDate: "2026-07-05" });
    await seedCoverNotice(t, a, { publicId: "DN-order-early", rentDueDate: "2026-06-05" });
    const asCompliance = await grantStaffRole(t, a, "compliance");
    for (const noticePublicId of ["DN-order-late", "DN-order-early"]) {
      const result = await asCompliance.mutation(api.coverOperations.mutations.staffRecordCover, {
        noticePublicId,
      });
      expect(result.success).toBe(true);
    }
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("coverOperations").collect();
      for (const row of rows) {
        const recordedAt =
          row.coveragePeriod === "2026-07"
            ? "2026-07-10T12:00:00.000Z"
            : "2026-07-11T12:00:00.000Z";
        await ctx.db.patch(row._id, { recordedAt });
      }
    });

    const listed = await asCompliance.query(api.coverOperations.useCases.listAwaitingPayout, {
      paginationOpts: FIRST_PAGE,
    });
    expect(listed.page.map((row) => [row.noticePublicId, row.batchId])).toEqual([
      ["DN-order-late", null],
      ["DN-order-early", null],
    ]);
  });
});
