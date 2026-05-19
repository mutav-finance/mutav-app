// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { seedAgencyWithMembership, seedDevUser, seedForeignAgency } from "../lib/testFixtures";
import schema from "../schema";

describe("anchors.bankAccountUseCases.listByAgency (scoped wrapper)", () => {
  test("returns the agency's bank accounts for a member", async () => {
    const t = convexTest(schema);
    const userId = await seedDevUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await t.run(async (ctx) => {
      const anchorAccountId = await ctx.db.insert("anchorAccounts", {
        agencyId,
        provider: "etherfuse",
        status: "approved",
        externalId: "cus_test_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: {
          provider: "etherfuse",
          publicKey: "GTEST",
          encryptedSecret: { ciphertext: "x", iv: "y", authTag: "z" },
          bankAccountId: "ba_test",
          kycStatus: "approved",
        },
      });
      await ctx.db.insert("agencyBankAccounts", {
        agencyId,
        anchorAccountId,
        externalBankAccountId: "ext_bank_1",
        type: "pix",
        accountNumber: "12345",
        accountHolderName: "Test Holder",
        etherfuseCreatedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      });
    });

    const banks = await t.query(api.anchors.bankAccountUseCases.listByAgency, { agencyId });
    expect(banks).toHaveLength(1);
    expect(banks[0].externalBankAccountId).toBe("ext_bank_1");
  });

  test("throws ForbiddenError when the caller is not a member", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);
    const foreignAgencyId = await seedForeignAgency(t);

    await expect(
      t.query(api.anchors.bankAccountUseCases.listByAgency, { agencyId: foreignAgencyId }),
    ).rejects.toThrow(/Forbidden|not a member/i);
  });
});

describe("anchors.accountUseCases.listByAgency (scoped wrapper)", () => {
  test("returns the agency's anchor accounts for a member", async () => {
    const t = convexTest(schema);
    const userId = await seedDevUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await t.run((ctx) =>
      ctx.db.insert("anchorAccounts", {
        agencyId,
        provider: "testanchor",
        status: "approved",
        externalId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { provider: "testanchor" },
      }),
    );

    const accounts = await t.query(api.anchors.accountUseCases.listByAgency, { agencyId });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].provider).toBe("testanchor");
  });

  test("throws ForbiddenError when the caller is not a member", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);
    const foreignAgencyId = await seedForeignAgency(t);

    await expect(
      t.query(api.anchors.accountUseCases.listByAgency, { agencyId: foreignAgencyId }),
    ).rejects.toThrow(/Forbidden|not a member/i);
  });
});

describe("anchors.orderUseCases.getOrderById (resource-by-id pattern)", () => {
  test("returns the order for a member of its agency", async () => {
    const t = convexTest(schema);
    const userId = await seedDevUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const orderId = await t.run(async (ctx) => {
      const paymentId = await ctx.db.insert("payments", {
        agencyId,
        publicId: "pay_test_1",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "pending" },
        method: null,
        lineItems: [],
      });
      return ctx.db.insert("anchorOrders", {
        agencyId,
        paymentId,
        provider: "testanchor",
        anchorTxId: "tx_test_1",
        status: "pending_user_transfer_start",
        createdAt: new Date().toISOString(),
      });
    });

    const order = await t.query(api.anchors.orderUseCases.getOrderById, { orderId });
    expect(order).not.toBeNull();
    expect(order?._id).toBe(orderId);
  });

  // Null instead of throw to avoid leaking cross-agency existence.
  test("returns null when the order belongs to a foreign agency", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);
    const foreignAgencyId = await seedForeignAgency(t);

    const orderId = await t.run(async (ctx) => {
      const paymentId = await ctx.db.insert("payments", {
        agencyId: foreignAgencyId,
        publicId: "pay_foreign",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "pending" },
        method: null,
        lineItems: [],
      });
      return ctx.db.insert("anchorOrders", {
        agencyId: foreignAgencyId,
        paymentId,
        provider: "testanchor",
        anchorTxId: "tx_foreign",
        status: "pending_user_transfer_start",
        createdAt: new Date().toISOString(),
      });
    });

    const order = await t.query(api.anchors.orderUseCases.getOrderById, { orderId });
    expect(order).toBeNull();
  });
});

describe("anchors.orderUseCases.listOrdersByPayment (resource-by-id pattern via payment)", () => {
  test("returns orders for a payment in the caller's agency", async () => {
    const t = convexTest(schema);
    const userId = await seedDevUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const paymentId = await t.run(async (ctx) => {
      const pid = await ctx.db.insert("payments", {
        agencyId,
        publicId: "pay_test_2",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "pending" },
        method: null,
        lineItems: [],
      });
      await ctx.db.insert("anchorOrders", {
        agencyId,
        paymentId: pid,
        provider: "testanchor",
        anchorTxId: "tx_a",
        status: "pending_user_transfer_start",
        createdAt: new Date().toISOString(),
      });
      return pid;
    });

    const orders = await t.query(api.anchors.orderUseCases.listOrdersByPayment, { paymentId });
    expect(orders).toHaveLength(1);
  });

  test("returns [] when the payment belongs to a foreign agency", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);
    const foreignAgencyId = await seedForeignAgency(t);

    const paymentId = await t.run(async (ctx) => {
      const pid = await ctx.db.insert("payments", {
        agencyId: foreignAgencyId,
        publicId: "pay_foreign_2",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "pending" },
        method: null,
        lineItems: [],
      });
      await ctx.db.insert("anchorOrders", {
        agencyId: foreignAgencyId,
        paymentId: pid,
        provider: "testanchor",
        anchorTxId: "tx_b",
        status: "pending_user_transfer_start",
        createdAt: new Date().toISOString(),
      });
      return pid;
    });

    const orders = await t.query(api.anchors.orderUseCases.listOrdersByPayment, { paymentId });
    expect(orders).toEqual([]);
  });
});
