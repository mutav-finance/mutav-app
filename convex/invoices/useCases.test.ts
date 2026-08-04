// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import { seedAgencyWithMembership, setupAuthenticatedUser } from "../lib/testFixtures";
import schema from "../schema";

const REAL_TOKEN = "9ZQK4M7X2VTB0HJN5RWY8DCP3FGS6AE1";
const OTHER_TOKEN = "1EA6SGF3PCD8YWR5NJH0BTV2X7M4KQZ9";

async function seedInvoice(
  t: ReturnType<typeof convexTest>,
  args: { agencyId: AgencyId; publicId: string; accessToken?: string },
) {
  return t.run((ctx) =>
    ctx.db.insert("invoices", {
      agencyId: args.agencyId,
      publicId: args.publicId,
      // Spread rather than assign so a legacy row has no `accessToken` key at
      // all — that, not an empty string, is what predates the field.
      ...(args.accessToken === undefined
        ? {}
        : {
            accessToken: args.accessToken,
            accessTokenExpiresAt: Date.now() + 86_400_000,
          }),
      periodMonth: "2026-07",
      issuedAt: "2026-07-01",
      dueDate: "2026-07-10",
      totalCents: 250000,
      state: { kind: "open" },
      lineItems: [],
    }),
  );
}

async function seedBankAccount(
  t: ReturnType<typeof convexTest>,
  args: { agencyId: AgencyId; accountHolderName: string },
) {
  return t.run(async (ctx) => {
    const anchorAccountId = await ctx.db.insert("anchorAccounts", {
      agencyId: args.agencyId,
      provider: "etherfuse",
      status: "approved",
      externalId: "cus_invoice_bearer",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      data: {
        provider: "etherfuse",
        publicKey: "GTEST",
        encryptedSecret: { ciphertext: "x", iv: "y", authTag: "z" },
        bankAccountId: "ba_invoice_bearer",
        kycStatus: "approved",
      },
    });
    return ctx.db.insert("agencyBankAccounts", {
      agencyId: args.agencyId,
      anchorAccountId,
      externalBankAccountId: "ext_bank_invoice_bearer",
      type: "pix",
      accountNumber: "12349876",
      accountHolderName: args.accountHolderName,
      etherfuseCreatedAt: "2026-07-01T00:00:00.000Z",
      syncedAt: "2026-07-01T00:00:00.000Z",
    });
  });
}

describe("invoices.useCases.listByAgency — list projection", () => {
  test("does not serialize the bearer token into the agency list payload", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedInvoice(t, { agencyId, publicId: "INV-2026-07-0001", accessToken: REAL_TOKEN });

    const result = await asUser.query(api.invoices.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0]).not.toHaveProperty("accessToken");
    expect(JSON.stringify(result)).not.toContain(REAL_TOKEN);
  });

  test("still carries every field the agency invoice table renders", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedInvoice(t, { agencyId, publicId: "INV-2026-07-0002", accessToken: REAL_TOKEN });

    const result = await asUser.query(api.invoices.useCases.listByAgency, {
      agencyId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page[0]).toMatchObject({
      agencyId,
      publicId: "INV-2026-07-0002",
      periodMonth: "2026-07",
      issuedAt: "2026-07-01",
      dueDate: "2026-07-10",
      totalCents: 250000,
      state: { kind: "open" },
      lineItems: [],
      method: null,
    });
  });
});

describe("invoices bearer resolution — a tokenless row is unreachable", () => {
  test("getPublicByAccessToken returns null for a blank token while a tokenless invoice exists", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedInvoice(t, { agencyId, publicId: "INV-LEGACY-0001" });

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: "" }),
    ).toBeNull();
    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: OTHER_TOKEN }),
    ).toBeNull();
  });

  test("consumeBearerAccess refuses a blank token while a tokenless invoice exists", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedInvoice(t, { agencyId, publicId: "INV-LEGACY-0002" });

    const result = await t.mutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: "",
    });
    expect(result.success).toBe(false);
  });

  test("listBanksForInvoice returns no banks for a blank token while a tokenless invoice exists", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedBankAccount(t, { agencyId, accountHolderName: "Legacy Holder" });
    await seedInvoice(t, { agencyId, publicId: "INV-LEGACY-0003" });

    expect(
      await t.query(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
        invoiceAccessToken: "",
      }),
    ).toEqual([]);
  });

  test("the by_accessToken index reaches a tokenless row only through an undefined key", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedInvoice(t, { agencyId, publicId: "INV-LEGACY-0004" });

    const byKey = async (accessToken: string | undefined) =>
      t.run((ctx) =>
        ctx.db
          .query("invoices")
          .withIndex("by_accessToken", (q) => q.eq("accessToken", accessToken))
          .collect(),
      );

    expect(await byKey("")).toHaveLength(0);
    expect(await byKey(OTHER_TOKEN)).toHaveLength(0);
    // The one key that does match is the one no `v.string()` argument can
    // carry — which is why the read paths reject a blank token up front.
    expect(await byKey(undefined)).toHaveLength(1);
  });
});

describe("invoices bearer resolution — a real token still resolves", () => {
  test("getPublicByAccessToken returns the tenant shape for the matching invoice", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedInvoice(t, { agencyId, publicId: "INV-2026-07-0003", accessToken: REAL_TOKEN });
    await seedInvoice(t, { agencyId, publicId: "INV-LEGACY-0005" });

    const invoice = await t.query(api.invoices.useCases.getPublicByAccessToken, {
      accessToken: REAL_TOKEN,
    });

    expect(invoice).toMatchObject({ publicId: "INV-2026-07-0003", agencyId });
  });

  test("listBanksForInvoice resolves the agency from a real token", async () => {
    const t = convexTest(schema);
    const { userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedBankAccount(t, { agencyId, accountHolderName: "Real Holder" });
    await seedInvoice(t, { agencyId, publicId: "INV-2026-07-0004", accessToken: REAL_TOKEN });
    await seedInvoice(t, { agencyId, publicId: "INV-LEGACY-0006" });

    const banks = await t.query(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
      invoiceAccessToken: REAL_TOKEN,
    });

    expect(banks).toHaveLength(1);
    expect(banks[0].accountHolderName).toBe("Real Holder");
  });
});
