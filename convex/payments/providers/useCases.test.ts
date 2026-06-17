// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../_generated/api";
import {
  seedAgencyWithMembership,
  seedForeignAgency,
  setupAuthenticatedUser,
} from "../../lib/testFixtures";
import schema from "../../schema";

describe("payments.providers.bankAccountUseCases.listByAgency (scoped wrapper)", () => {
  test("returns the agency's bank accounts for a member", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);
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

    const banks = await asUser.query(api.payments.providers.bankAccountUseCases.listByAgency, {
      agencyId,
    });
    expect(banks).toHaveLength(1);
    expect(banks[0].externalBankAccountId).toBe("ext_bank_1");
  });

  test("throws ForbiddenError when the caller is not a member", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);
    const foreignAgencyId = await seedForeignAgency(t);

    await expect(
      asUser.query(api.payments.providers.bankAccountUseCases.listByAgency, {
        agencyId: foreignAgencyId,
      }),
    ).rejects.toThrow(/Forbidden|not a member/i);
  });
});

describe("payments.providers.bankAccountUseCases.listBanksForInvoice (tenant bearer)", () => {
  test("resolves the agency from the invoice publicId and returns its banks (no auth)", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await t.run(async (ctx) => {
      const anchorAccountId = await ctx.db.insert("anchorAccounts", {
        agencyId,
        provider: "etherfuse",
        status: "approved",
        externalId: "cus_bearer_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: {
          provider: "etherfuse",
          publicKey: "GTEST",
          encryptedSecret: { ciphertext: "x", iv: "y", authTag: "z" },
          bankAccountId: "ba_bearer",
          kycStatus: "approved",
        },
      });
      await ctx.db.insert("agencyBankAccounts", {
        agencyId,
        anchorAccountId,
        externalBankAccountId: "ext_bank_bearer",
        type: "pix",
        accountNumber: "98765",
        accountHolderName: "Bearer Holder",
        etherfuseCreatedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      });
      await ctx.db.insert("invoices", {
        agencyId,
        publicId: "INV-bearer-1",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "open" },
        lineItems: [],
      });
    });

    // No identity — the publicId is the bearer.
    const banks = await t.query(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
      invoicePublicId: "INV-bearer-1",
    });
    expect(banks).toHaveLength(1);
    expect(banks[0].externalBankAccountId).toBe("ext_bank_bearer");
  });

  test("returns an empty list for an unknown invoice publicId (no existence leak)", async () => {
    const t = convexTest(schema);
    const banks = await t.query(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
      invoicePublicId: "INV-does-not-exist",
    });
    expect(banks).toEqual([]);
  });
});

describe("payments.providers.orderUseCases.getOrderById (resource-by-id pattern)", () => {
  test("returns the order for a member of its agency", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    const orderId = await t.run(async (ctx) => {
      const invoiceId = await ctx.db.insert("invoices", {
        agencyId,
        publicId: "inv_test_1",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "open" },
        lineItems: [],
      });
      return ctx.db.insert("providerOrders", {
        agencyId,
        invoiceId,
        provider: "testanchor",
        anchorTxId: "tx_test_1",
        status: "pending_user_transfer_start",
        createdAt: new Date().toISOString(),
      });
    });

    const order = await asUser.query(api.payments.providers.orderUseCases.getOrderById, {
      orderId,
    });
    expect(order).not.toBeNull();
    expect(order?._id).toBe(orderId);
  });

  // Null instead of throw to avoid leaking cross-agency existence.
  test("returns null when the order belongs to a foreign agency", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);
    const foreignAgencyId = await seedForeignAgency(t);

    const orderId = await t.run(async (ctx) => {
      const invoiceId = await ctx.db.insert("invoices", {
        agencyId: foreignAgencyId,
        publicId: "inv_foreign",
        periodMonth: "2026-05",
        issuedAt: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        totalCents: 10000,
        state: { kind: "open" },
        lineItems: [],
      });
      return ctx.db.insert("providerOrders", {
        agencyId: foreignAgencyId,
        invoiceId,
        provider: "testanchor",
        anchorTxId: "tx_foreign",
        status: "pending_user_transfer_start",
        createdAt: new Date().toISOString(),
      });
    });

    const order = await asUser.query(api.payments.providers.orderUseCases.getOrderById, {
      orderId,
    });
    expect(order).toBeNull();
  });
});
