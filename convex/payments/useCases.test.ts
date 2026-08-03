// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import {
  seedAgencyWithMembership,
  seedForeignAgency,
  setupAuthenticatedUser,
} from "../lib/testFixtures";
import schema from "../schema";
import { SettlementMethods } from "./domain";
import { recordSettlement } from "./settlement";

describe("payments.settlement.recordSettlement (idempotency)", () => {
  test("a replayed externalRef short-circuits to the existing row instead of inserting", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const invoiceId = await t.run((ctx) =>
      ctx.db.insert("invoices", {
        agencyId,
        publicId: "INV-idem-1",
        accessToken: "TOK-FIXTURE-01",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "open" },
        lineItems: [],
      }),
    );

    const { firstId, secondId } = await t.run(async (ctx) => {
      const args = {
        agencyId,
        invoiceId,
        status: "succeeded" as const,
        amountCents: 10000,
        method: SettlementMethods.stellar("GDEST", "tx_replayed"),
        externalRef: "tx_replayed",
      };
      const firstId = await recordSettlement(ctx, args);
      const secondId = await recordSettlement(ctx, args);
      return { firstId, secondId };
    });

    expect(secondId).toBe(firstId);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(firstId);
  });
});

describe("payments.useCases.listByInvoice (scoping)", () => {
  test("returns the settlements for an invoice the caller's agency owns", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const invoiceId = await t.run(async (ctx) => {
      const invoiceId = await ctx.db.insert("invoices", {
        agencyId,
        publicId: "INV-scope-1",
        accessToken: "TOK-FIXTURE-02",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "open" },
        lineItems: [],
      });
      await ctx.db.insert("payments", {
        agencyId,
        invoiceId,
        status: "succeeded",
        amountCents: 10000,
        externalRef: "tx_scope_1",
        method: SettlementMethods.stellar("GDEST", "tx_scope_1"),
      });
      return invoiceId;
    });

    const payments = await asUser.query(api.payments.useCases.listByInvoice, {
      invoiceId,
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].externalRef).toBe("tx_scope_1");
  });

  // Empty list (not a throw) so the caller can't probe cross-agency existence.
  test("returns an empty list for an invoice owned by a foreign agency", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    await seedAgencyWithMembership(t, userId);
    const foreignAgencyId = await seedForeignAgency(t);

    const foreignInvoiceId = await t.run(async (ctx) => {
      const foreignInvoiceId = await ctx.db.insert("invoices", {
        agencyId: foreignAgencyId,
        publicId: "INV-foreign-1",
        accessToken: "TOK-FIXTURE-03",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "open" },
        lineItems: [],
      });
      await ctx.db.insert("payments", {
        agencyId: foreignAgencyId,
        invoiceId: foreignInvoiceId,
        status: "succeeded",
        amountCents: 10000,
        externalRef: "tx_foreign_1",
        method: SettlementMethods.stellar("GDEST", "tx_foreign_1"),
      });
      return foreignInvoiceId;
    });

    const payments = await asUser.query(api.payments.useCases.listByInvoice, {
      invoiceId: foreignInvoiceId,
    });
    expect(payments).toEqual([]);
  });
});

describe("payments dual-write (markPaidByTx)", () => {
  test("marking an open invoice paid by tx records a succeeded settlement keyed on the txHash", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const invoiceId = await t.run((ctx) =>
      ctx.db.insert("invoices", {
        agencyId,
        publicId: "INV-dualwrite-1",
        accessToken: "TOK-FIXTURE-04",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "open" },
        lineItems: [],
      }),
    );

    const txHash = "tx_dualwrite_1";
    await t.mutation(internal.invoices.mutations.markPaidByTx, {
      invoiceId,
      txHash,
      paidAt: new Date().toISOString(),
      muxedAddress: "MDEST",
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].externalRef).toBe(txHash);
  });
});

describe("payments idempotency (markPaidByTx replays)", () => {
  test("a same-txHash replay short-circuits to already_paid without a duplicate settlement", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const invoiceId = await t.run((ctx) =>
      ctx.db.insert("invoices", {
        agencyId,
        publicId: "INV-idem-replay-1",
        accessToken: "TOK-FIXTURE-05",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "open" },
        lineItems: [],
      }),
    );

    const txHash = "tx_idem_replay_1";
    const paidArgs = {
      invoiceId,
      txHash,
      paidAt: new Date().toISOString(),
      muxedAddress: "MDEST",
    };

    const first = await t.mutation(internal.invoices.mutations.markPaidByTx, paidArgs);
    expect(first.status).toBe("paid");

    const replay = await t.mutation(internal.invoices.mutations.markPaidByTx, paidArgs);
    expect(replay.status).toBe("already_paid");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
        .collect(),
    );
    expect(rows).toHaveLength(1);

    // A different txHash against an already-paid invoice is a duplicate inbound,
    // not a second settlement.
    const otherTx = await t.mutation(internal.invoices.mutations.markPaidByTx, {
      ...paidArgs,
      txHash: "tx_idem_replay_2",
    });
    expect(otherTx.status).toBe("duplicate_inbound");

    const rowsAfter = await t.run((ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
        .collect(),
    );
    expect(rowsAfter).toHaveLength(1);
  });
});
