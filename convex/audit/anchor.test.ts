// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { AUDIT_ACTION, AUDIT_ANCHOR_STATUS } from "./domain";
import { appendAuditEntry } from "./useCases";

async function seedEntries(t: ReturnType<typeof convexTest>, count: number) {
  for (let i = 0; i < count; i++) {
    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "anchor-test" },
        action: AUDIT_ACTION.INVOICE_PAID,
        resourceType: "invoices",
        resourceId: `INV-${i}`,
        payload: { i },
      }),
    );
    // Guarantee a unique timestamp so the by_timestamp range scan is
    // unambiguous between this entry and the next.
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("computeAuditAnchor — first run from genesis", () => {
  test("empty log produces the sentinel root with entryCount 0", async () => {
    const t = convexTest(schema);
    const result = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});
    expect(result.entryCount).toBe(0);
    expect(result.rootHash).toBe("0".repeat(64));

    const anchors = await t.run((ctx) => ctx.db.query("mutavAuditAnchors").collect());
    expect(anchors).toHaveLength(1);
    expect(anchors[0].status).toBe(AUDIT_ANCHOR_STATUS.PENDING);
    expect(anchors[0].stellarTxHash).toBeNull();
    expect(anchors[0].periodStart).toBe(0);
  });

  test("first anchor covers all existing entries", async () => {
    const t = convexTest(schema);
    await seedEntries(t, 3);

    const result = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});
    expect(result.entryCount).toBe(3);
    expect(result.rootHash).not.toBe("0".repeat(64));
  });
});

describe("computeAuditAnchor — subsequent runs", () => {
  test("second anchor only covers entries added after the first", async () => {
    const t = convexTest(schema);
    await seedEntries(t, 2);

    const first = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});
    expect(first.entryCount).toBe(2);

    // Gap so the second anchor's periodStart is strictly after the first's entries.
    await new Promise((r) => setTimeout(r, 5));
    await seedEntries(t, 3);

    const second = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});
    expect(second.entryCount).toBe(3);
    expect(second.rootHash).not.toBe(first.rootHash);

    const anchors = await t.run((ctx) =>
      ctx.db.query("mutavAuditAnchors").withIndex("by_periodEnd").order("asc").collect(),
    );
    expect(anchors).toHaveLength(2);
    expect(anchors[1].periodStart).toBe(anchors[0].periodEnd);
  });

  test("quiet period — second anchor with no new entries is a valid empty anchor", async () => {
    const t = convexTest(schema);
    await seedEntries(t, 2);
    await t.mutation(internal.audit.anchor.computeAuditAnchor, {});

    await new Promise((r) => setTimeout(r, 5));
    const second = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});
    expect(second.entryCount).toBe(0);
    expect(second.rootHash).toBe("0".repeat(64));
  });
});

describe("verifyLatestAnchor", () => {
  test("returns no_anchor when the table is empty", async () => {
    const t = convexTest(schema);
    const result = await t.query(internal.audit.anchor.verifyLatestAnchor, {});
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("no_anchor");
  });

  test("returns valid for a clean anchor", async () => {
    const t = convexTest(schema);
    await seedEntries(t, 3);
    const compute = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});

    const result = await t.query(internal.audit.anchor.verifyLatestAnchor, {});
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.anchorId).toBe(compute.anchorId);
    expect(result.entriesChecked).toBe(3);
    expect(result.rootHash).toBe(compute.rootHash);
    expect(result.stellarTxHash).toBeNull(); // pending in dev mode
  });

  test("returns root_mismatch when an entry is tampered after the anchor", async () => {
    const t = convexTest(schema);
    await seedEntries(t, 3);
    const compute = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});

    // Tamper with an entry's entryHash after anchoring. The anchor's root
    // is now stale — recomputation produces a different root.
    const entries = await t.run((ctx) =>
      ctx.db.query("mutavAuditLog").withIndex("by_timestamp").order("asc").collect(),
    );
    await t.run((ctx) => ctx.db.patch(entries[1]._id, { entryHash: "f".repeat(64) }));

    const result = await t.query(internal.audit.anchor.verifyLatestAnchor, {});
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("root_mismatch");
    if (result.reason !== "root_mismatch") return;
    expect(result.anchorId).toBe(compute.anchorId);
    expect(result.expectedRoot).toBe(compute.rootHash);
    expect(result.computedRoot).not.toBe(compute.rootHash);
    expect(result.entriesChecked).toBe(3);
  });
});

describe("markAnchorSubmitted / markAnchorFailed", () => {
  test("submitted lifecycle: pending → submitted with txHash + network", async () => {
    const t = convexTest(schema);
    await seedEntries(t, 1);
    const { anchorId } = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});

    const result = await t.mutation(internal.audit.anchor.markAnchorSubmitted, {
      anchorId,
      stellarTxHash: "abc123",
      stellarNetwork: "testnet",
    });
    expect(result.idempotent).toBe(false);

    const anchor = await t.run((ctx) => ctx.db.get(anchorId));
    expect(anchor?.status).toBe(AUDIT_ANCHOR_STATUS.SUBMITTED);
    expect(anchor?.stellarTxHash).toBe("abc123");
    expect(anchor?.stellarNetwork).toBe("testnet");
  });

  test("markAnchorSubmitted is idempotent for the same txHash", async () => {
    const t = convexTest(schema);
    const { anchorId } = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});

    await t.mutation(internal.audit.anchor.markAnchorSubmitted, {
      anchorId,
      stellarTxHash: "abc123",
      stellarNetwork: "testnet",
    });
    const second = await t.mutation(internal.audit.anchor.markAnchorSubmitted, {
      anchorId,
      stellarTxHash: "abc123",
      stellarNetwork: "testnet",
    });
    expect(second.idempotent).toBe(true);
  });

  test("markAnchorSubmitted refuses to overwrite a different txHash", async () => {
    const t = convexTest(schema);
    const { anchorId } = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});

    await t.mutation(internal.audit.anchor.markAnchorSubmitted, {
      anchorId,
      stellarTxHash: "abc123",
      stellarNetwork: "testnet",
    });
    await expect(
      t.mutation(internal.audit.anchor.markAnchorSubmitted, {
        anchorId,
        stellarTxHash: "different",
        stellarNetwork: "testnet",
      }),
    ).rejects.toThrow(/refusing to overwrite/);
  });

  test("failed lifecycle records the reason and leaves room for retry", async () => {
    const t = convexTest(schema);
    const { anchorId } = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});

    await t.mutation(internal.audit.anchor.markAnchorFailed, {
      anchorId,
      stellarNetwork: "testnet",
      failureReason: "horizon 504",
    });

    const anchor = await t.run((ctx) => ctx.db.get(anchorId));
    expect(anchor?.status).toBe(AUDIT_ANCHOR_STATUS.FAILED);
    expect(anchor?.failureReason).toBe("horizon 504");
  });

  test("markAnchorFailed does not downgrade an already-submitted anchor", async () => {
    const t = convexTest(schema);
    const { anchorId } = await t.mutation(internal.audit.anchor.computeAuditAnchor, {});
    await t.mutation(internal.audit.anchor.markAnchorSubmitted, {
      anchorId,
      stellarTxHash: "abc",
      stellarNetwork: "testnet",
    });
    const result = await t.mutation(internal.audit.anchor.markAnchorFailed, {
      anchorId,
      stellarNetwork: "testnet",
      failureReason: "late failure",
    });
    expect(result.unchanged).toBe(true);
    if (!result.unchanged) return;
    expect(result.currentStatus).toBe(AUDIT_ANCHOR_STATUS.SUBMITTED);
  });
});
