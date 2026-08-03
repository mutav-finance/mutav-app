// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import {
  registerContractAggregateComponents,
  seedAgencyWithMembership,
  setupAuthenticatedUser,
} from "../lib/testFixtures";
import schema from "../schema";

const TOKEN = "4KQZ9M7X2VTB0HJN5RWY8DCP3FGS6AE1";
const DAY_MS = 86_400_000;

/**
 * LGPD-96 — the bearer credential has a lifecycle. Every case here asserts a
 * refusal that only holds because a specific check exists; delete the check
 * and the corresponding case fails rather than merely losing coverage.
 */

type InvoiceOverrides = {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  accessTokenRevokedAt?: number;
  state?: { kind: "open" } | { kind: "paid"; paidAt: string } | { kind: "void" };
};

async function seedInvoice(
  t: ReturnType<typeof convexTest>,
  agencyId: AgencyId,
  overrides: InvoiceOverrides = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("invoices", {
      agencyId,
      publicId: "INV-2026-08-0100",
      accessToken: overrides.accessToken ?? TOKEN,
      accessTokenExpiresAt: overrides.accessTokenExpiresAt ?? Date.now() + 30 * DAY_MS,
      ...(overrides.accessTokenRevokedAt === undefined
        ? {}
        : { accessTokenRevokedAt: overrides.accessTokenRevokedAt }),
      periodMonth: "2026-08",
      issuedAt: "2026-08-01",
      dueDate: "2026-08-10",
      totalCents: 250000,
      state: overrides.state ?? { kind: "open" },
      lineItems: [],
    }),
  );
}

async function seedBankAccount(t: ReturnType<typeof convexTest>, agencyId: AgencyId) {
  return t.run(async (ctx) => {
    const anchorAccountId = await ctx.db.insert("anchorAccounts", {
      agencyId,
      provider: "etherfuse",
      status: "approved",
      externalId: "cus_bearer_lifecycle",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      data: {
        provider: "etherfuse",
        publicKey: "GTEST",
        encryptedSecret: { ciphertext: "x", iv: "y", authTag: "z" },
        bankAccountId: "ba_bearer_lifecycle",
        kycStatus: "approved",
      },
    });
    return ctx.db.insert("agencyBankAccounts", {
      agencyId,
      anchorAccountId,
      externalBankAccountId: "ext_bank_bearer_lifecycle",
      type: "pix",
      accountNumber: "12349876",
      accountHolderName: "Lifecycle Holder",
      etherfuseCreatedAt: "2026-08-01T00:00:00.000Z",
      syncedAt: "2026-08-01T00:00:00.000Z",
    });
  });
}

async function setup() {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  const { userId } = await setupAuthenticatedUser(t);
  const agencyId = await seedAgencyWithMembership(t, userId);
  return { t, agencyId };
}

describe("bearer lifecycle — a live token still works", () => {
  test("an unexpired, unrevoked token resolves on every bearer entry point", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId);
    await seedBankAccount(t, agencyId);

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).toMatchObject({ publicId: "INV-2026-08-0100" });

    expect(
      await t.query(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
        invoiceAccessToken: TOKEN,
      }),
    ).toHaveLength(1);

    const granted = await t.mutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: TOKEN,
    });
    expect(granted.success).toBe(true);
  });

  test("the public invoice read does not hand the payer the invoice id", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId);

    const invoice = await t.query(api.invoices.useCases.getPublicByAccessToken, {
      accessToken: TOKEN,
    });
    expect(invoice).not.toBeNull();
    expect(invoice).not.toHaveProperty("invoiceId");
  });
});

describe("bearer lifecycle — an expired token is rejected", () => {
  test("the read paths return nothing once the expiry has passed", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId, { accessTokenExpiresAt: Date.now() - 1000 });
    await seedBankAccount(t, agencyId);

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).toBeNull();
    expect(
      await t.query(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
        invoiceAccessToken: TOKEN,
      }),
    ).toEqual([]);
  });

  test("the checkout write path refuses with EXPIRED", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId, { accessTokenExpiresAt: Date.now() - 1000 });

    const result = await t.mutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: TOKEN,
    });
    expect(result).toMatchObject({ success: false, error: { code: "EXPIRED" } });
  });

  // A row that predates the lifecycle carries no expiry at all. Absence has to
  // read as expired, or the columns are decorative for exactly the rows that
  // were minted before anyone was thinking about revocation.
  test("a row with no expiry at all is treated as expired", async () => {
    const { t, agencyId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("invoices", {
        agencyId,
        publicId: "INV-LEGACY-0900",
        accessToken: TOKEN,
        periodMonth: "2026-08",
        issuedAt: "2026-08-01",
        dueDate: "2026-08-10",
        totalCents: 1000,
        state: { kind: "open" },
        lineItems: [],
      }),
    );

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).toBeNull();
  });
});

describe("bearer lifecycle — a revoked token is rejected", () => {
  test("revocation denies an otherwise unexpired token on every entry point", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId, {
      accessTokenExpiresAt: Date.now() + 30 * DAY_MS,
      accessTokenRevokedAt: Date.now() - 1000,
    });
    await seedBankAccount(t, agencyId);

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).toBeNull();
    expect(
      await t.query(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
        invoiceAccessToken: TOKEN,
      }),
    ).toEqual([]);

    const result = await t.mutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: TOKEN,
    });
    expect(result).toMatchObject({ success: false, error: { code: "REVOKED" } });
  });

  test("revokeAccessToken takes effect on the next request", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    const invoiceId = await seedInvoice(t, agencyId);

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).not.toBeNull();

    await asUser.mutation(api.invoices.mutations.revokeAccessToken, { agencyId, invoiceId });

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).toBeNull();
  });

  test("rotateAccessToken retires the leaked token and issues a working one", async () => {
    const t = convexTest(schema);
    registerContractAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    const invoiceId = await seedInvoice(t, agencyId, { accessTokenRevokedAt: Date.now() - 1000 });

    const rotated = await asUser.mutation(api.invoices.mutations.rotateAccessToken, {
      agencyId,
      invoiceId,
    });
    if (!rotated.success) throw new Error("expected rotation to succeed");

    expect(rotated.data.accessToken).not.toBe(TOKEN);
    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).toBeNull();
    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, {
        accessToken: rotated.data.accessToken,
      }),
    ).not.toBeNull();
  });
});

describe("bearer lifecycle — the rate limit trips", () => {
  test("the 31st attempt on one token in a window is denied and recorded", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId);

    for (let attempt = 1; attempt <= 30; attempt++) {
      const allowed = await t.mutation(internal.invoices.mutations.consumeBearerAccess, {
        accessToken: TOKEN,
      });
      expect(allowed.success).toBe(true);
    }

    const denied = await t.mutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: TOKEN,
    });
    expect(denied).toMatchObject({ success: false, error: { code: "RATE_LIMITED" } });

    const window = await t.run((ctx) =>
      ctx.db
        .query("bearerAccessAttempts")
        .withIndex("by_scope_key", (q) => q.eq("scope", "token").eq("key", TOKEN))
        .unique(),
    );
    expect(window?.count).toBe(31);
    expect(window?.deniedCount).toBe(1);
    expect(window?.lastDeniedAt).toBeTypeOf("number");
  });

  test("a tripped token window locks the read paths too", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId);
    await seedBankAccount(t, agencyId);
    await t.run((ctx) =>
      ctx.db.insert("bearerAccessAttempts", {
        scope: "token",
        key: TOKEN,
        windowStartedAt: Date.now(),
        count: 30,
        deniedCount: 0,
      }),
    );

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).toBeNull();
    expect(
      await t.query(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
        invoiceAccessToken: TOKEN,
      }),
    ).toEqual([]);
  });

  test("a source IP at its cap is denied even when it presents a valid token", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId);
    await t.run((ctx) =>
      ctx.db.insert("bearerAccessAttempts", {
        scope: "ip",
        key: "203.0.113.7",
        windowStartedAt: Date.now(),
        count: 120,
        deniedCount: 0,
      }),
    );

    const capped = await t.mutation(api.invoices.mutations.recordBearerPageView, {
      accessToken: TOKEN,
      sourceIp: "203.0.113.7",
    });
    // The public surface reports one opaque code, so the control below is what
    // pins the denial on the IP cap rather than on the token.
    expect(capped).toMatchObject({ success: false, error: { code: "DENIED" } });

    const fromAnotherAddress = await t.mutation(api.invoices.mutations.recordBearerPageView, {
      accessToken: TOKEN,
      sourceIp: "203.0.113.8",
    });
    expect(fromAnotherAddress).toMatchObject({ success: true });
  });

  test("an unknown token mints no counter row, so a sweep cannot amplify writes", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId);

    await t.mutation(api.invoices.mutations.recordBearerPageView, {
      accessToken: "NOTATOKEN0000000000000000000000A",
    });

    const rows = await t.run((ctx) => ctx.db.query("bearerAccessAttempts").collect());
    expect(rows).toEqual([]);
  });

  test("an unknown token mints no counter row even when it supplies a source IP", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId);

    // `sourceIp` arrives over a public mutation, so its cardinality is the
    // caller's to choose. Counting it before the token resolved let a caller
    // holding no valid token insert one row per address it cared to invent.
    for (const octet of [11, 22, 33]) {
      await t.mutation(api.invoices.mutations.recordBearerPageView, {
        accessToken: "NOTATOKEN0000000000000000000000A",
        sourceIp: `198.51.100.${octet}`,
      });
    }

    const rows = await t.run((ctx) => ctx.db.query("bearerAccessAttempts").collect());
    expect(rows).toEqual([]);
  });

  test("every refusal collapses to one opaque code, so expiry is not an existence oracle", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId, { accessTokenExpiresAt: Date.now() - 1 });

    const expired = await t.mutation(api.invoices.mutations.recordBearerPageView, {
      accessToken: TOKEN,
    });
    const unknown = await t.mutation(api.invoices.mutations.recordBearerPageView, {
      accessToken: "NOTATOKEN0000000000000000000000A",
    });

    // A token that expired once existed; one that was never issued did not.
    // Distinguishable refusals would confirm which, over the token space.
    expect(expired).toMatchObject({ success: false, error: { code: "DENIED" } });
    expect(unknown).toMatchObject({ success: false, error: { code: "DENIED" } });
  });

  test("the window rolls over once it is older than a minute", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId);
    await t.run((ctx) =>
      ctx.db.insert("bearerAccessAttempts", {
        scope: "token",
        key: TOKEN,
        windowStartedAt: Date.now() - 60_000,
        count: 30,
        deniedCount: 1,
      }),
    );

    const result = await t.mutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: TOKEN,
    });
    expect(result.success).toBe(true);
  });
});

describe("bearer lifecycle — settlement puts the token on its own clock", () => {
  test("marking an invoice paid collapses the expiry to a seven-day receipt window", async () => {
    const { t, agencyId } = await setup();
    const invoiceId = await seedInvoice(t, agencyId, {
      accessTokenExpiresAt: Date.now() + 180 * DAY_MS,
    });

    const settledAt = Date.now();
    await t.mutation(internal.invoices.mutations.markPaidByAnchor, {
      invoiceId,
      anchorTxId: "anchor_tx_bearer_lifecycle",
      pixKey: "pix-key",
      paidAt: "2026-08-02T12:00:00.000Z",
    });

    const invoice = await t.run((ctx) => ctx.db.get(invoiceId));
    const expiresAt = invoice?.accessTokenExpiresAt ?? 0;
    expect(expiresAt).toBeGreaterThan(settledAt + 7 * DAY_MS - 5_000);
    expect(expiresAt).toBeLessThan(settledAt + 7 * DAY_MS + 5_000);
  });

  test("a settled invoice's token stops resolving once the receipt window closes", async () => {
    const { t, agencyId } = await setup();
    await seedInvoice(t, agencyId, {
      state: { kind: "paid", paidAt: "2026-06-01T12:00:00.000Z" },
      accessTokenExpiresAt: Date.now() - 8 * DAY_MS,
    });

    expect(
      await t.query(api.invoices.useCases.getPublicByAccessToken, { accessToken: TOKEN }),
    ).toBeNull();
  });

  test("settlement never extends a deadline that is already sooner", async () => {
    const { t, agencyId } = await setup();
    const soonExpiry = Date.now() + 2 * DAY_MS;
    const invoiceId = await seedInvoice(t, agencyId, { accessTokenExpiresAt: soonExpiry });

    await t.mutation(internal.invoices.mutations.markPaidByAnchor, {
      invoiceId,
      anchorTxId: "anchor_tx_bearer_lifecycle_2",
      pixKey: "pix-key",
      paidAt: "2026-08-02T12:00:00.000Z",
    });

    const invoice = await t.run((ctx) => ctx.db.get(invoiceId));
    expect(invoice?.accessTokenExpiresAt).toBe(soonExpiry);
  });
});
