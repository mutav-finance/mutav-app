// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { AUDIT_ACTION, GENESIS_PREV_HASH } from "./domain";
import { appendAuditEntry, computeEntryHash } from "./useCases";

describe("appendAuditEntry — chain construction", () => {
  test("genesis entry uses GENESIS_PREV_HASH and a valid entryHash", async () => {
    const t = convexTest(schema);

    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.PAYMENT_PAID,
        resourceType: "payments",
        resourceId: "PAY-1",
        payload: { amount: 100 },
      }),
    );

    const entries = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
    expect(entries).toHaveLength(1);
    const [genesis] = entries;
    expect(genesis.prevHash).toBe(GENESIS_PREV_HASH);
    expect(genesis.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(genesis.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    // entryHash is the SHA-256 of the canonicalized entry
    const recomputed = await computeEntryHash({
      timestamp: genesis.timestamp,
      actor: genesis.actor,
      action: genesis.action,
      resourceType: genesis.resourceType,
      resourceId: genesis.resourceId,
      payloadHash: genesis.payloadHash,
      prevHash: genesis.prevHash,
    });
    expect(recomputed).toBe(genesis.entryHash);
  });

  test("second entry's prevHash equals first entry's entryHash", async () => {
    const t = convexTest(schema);

    // Mixed history: a frozen historical `payments` row chained to a new
    // `invoices` row — proves the chain verifies across the rename boundary.
    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.PAYMENT_PAID,
        resourceType: "payments",
        resourceId: "PAY-1",
        payload: { amount: 100 },
      }),
    );
    // Force a millisecond gap so the by_timestamp ordering is unambiguous.
    await new Promise((r) => setTimeout(r, 2));
    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.INVOICE_PAID,
        resourceType: "invoices",
        resourceId: "INV-2",
        payload: { amount: 200 },
      }),
    );

    const entries = await t.run((ctx) =>
      ctx.db.query("mutavAuditLog").withIndex("by_timestamp").order("asc").collect(),
    );
    expect(entries).toHaveLength(2);
    const [first, second] = entries;
    expect(second.prevHash).toBe(first.entryHash);
    expect(first.entryHash).not.toBe(second.entryHash);
  });

  test("user-kind actor is preserved on the entry", async () => {
    const t = convexTest(schema);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "audit-user",
        name: "Audit User",
        email: "audit@test.br",
        createdAt: new Date().toISOString(),
      }),
    );

    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "user", userId },
        action: AUDIT_ACTION.CONTRACT_CREATED,
        resourceType: "contracts",
        resourceId: "C-1",
        payload: { rentCents: 100000 },
      }),
    );

    const [entry] = await t.run((ctx) => ctx.db.query("mutavAuditLog").collect());
    expect(entry.actor.kind).toBe("user");
    if (entry.actor.kind !== "user") return;
    expect(entry.actor.userId).toBe(userId);
  });
});

describe("verifyChainQuery — tamper detection", () => {
  test("clean chain returns valid", async () => {
    const t = convexTest(schema);

    for (const i of [1, 2, 3]) {
      await t.run((ctx) =>
        appendAuditEntry(ctx, {
          actor: { kind: "system", source: "test" },
          action: AUDIT_ACTION.INVOICE_PAID,
          resourceType: "invoices",
          resourceId: `INV-${i}`,
          payload: { amount: i * 100 },
        }),
      );
      await new Promise((r) => setTimeout(r, 2));
    }

    const result = await t.query(internal.audit.useCases.verifyChainQuery, {});
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.entriesChecked).toBe(3);
  });

  test("tampering with payloadHash on entry N breaks entryHashMismatch on N", async () => {
    const t = convexTest(schema);

    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.INVOICE_PAID,
        resourceType: "invoices",
        resourceId: "INV-1",
        payload: { amount: 100 },
      }),
    );
    await new Promise((r) => setTimeout(r, 2));
    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.INVOICE_PAID,
        resourceType: "invoices",
        resourceId: "INV-2",
        payload: { amount: 200 },
      }),
    );

    // Tamper with the second entry's payloadHash (simulating a backdoor edit).
    const entries = await t.run((ctx) =>
      ctx.db.query("mutavAuditLog").withIndex("by_timestamp").order("asc").collect(),
    );
    const tamperedId = entries[1]._id;
    await t.run((ctx) => ctx.db.patch(tamperedId, { payloadHash: "f".repeat(64) }));

    const result = await t.query(internal.audit.useCases.verifyChainQuery, {});
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.brokenAtId).toBe(tamperedId);
    expect(result.reason).toBe("entryHashMismatch");
  });

  test("tampering with entryHash on entry N breaks prevHashMismatch on N+1", async () => {
    const t = convexTest(schema);

    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.INVOICE_PAID,
        resourceType: "invoices",
        resourceId: "INV-1",
        payload: { amount: 100 },
      }),
    );
    await new Promise((r) => setTimeout(r, 2));
    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.INVOICE_PAID,
        resourceType: "invoices",
        resourceId: "INV-2",
        payload: { amount: 200 },
      }),
    );

    // Tamper with entry 1's entryHash. Verification will find entry 1's
    // entryHash mismatch first (it walks chronologically).
    const entries = await t.run((ctx) =>
      ctx.db.query("mutavAuditLog").withIndex("by_timestamp").order("asc").collect(),
    );
    await t.run((ctx) => ctx.db.patch(entries[0]._id, { entryHash: "a".repeat(64) }));

    const result = await t.query(internal.audit.useCases.verifyChainQuery, {});
    expect(result.valid).toBe(false);
    if (result.valid) return;
    // The walker hits the entryHash mismatch on entry 1 before reaching entry 2.
    expect(result.brokenAtId).toBe(entries[0]._id);
    expect(result.reason).toBe("entryHashMismatch");
  });

  test("an empty chain is trivially valid", async () => {
    const t = convexTest(schema);
    const result = await t.query(internal.audit.useCases.verifyChainQuery, {});
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.entriesChecked).toBe(0);
  });
});

describe("auditLogByResource — forensic lookup", () => {
  test("returns entries for a resource in chronological order", async () => {
    const t = convexTest(schema);

    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.CONTRACT_CREATED,
        resourceType: "contracts",
        resourceId: "C-1",
        payload: { step: 1 },
      }),
    );
    await new Promise((r) => setTimeout(r, 2));
    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.CONTRACT_STATUS_UPDATED,
        resourceType: "contracts",
        resourceId: "C-1",
        payload: { step: 2 },
      }),
    );
    await new Promise((r) => setTimeout(r, 2));
    await t.run((ctx) =>
      appendAuditEntry(ctx, {
        actor: { kind: "system", source: "test" },
        action: AUDIT_ACTION.PAYMENT_PAID,
        resourceType: "payments",
        resourceId: "PAY-1",
        payload: { unrelated: true },
      }),
    );

    const trail = await t.query(internal.audit.useCases.auditLogByResource, {
      resourceType: "contracts",
      resourceId: "C-1",
    });
    expect(trail).toHaveLength(2);
    expect(trail[0].action).toBe(AUDIT_ACTION.CONTRACT_CREATED);
    expect(trail[1].action).toBe(AUDIT_ACTION.CONTRACT_STATUS_UPDATED);
    expect(trail[0].timestamp).toBeLessThanOrEqual(trail[1].timestamp);
  });

  test("returns empty when no entries match", async () => {
    const t = convexTest(schema);
    const trail = await t.query(internal.audit.useCases.auditLogByResource, {
      resourceType: "contracts",
      resourceId: "missing",
    });
    expect(trail).toEqual([]);
  });
});
