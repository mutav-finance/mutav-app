// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { AgencyId, OnboardingState } from "../agencies/domain";
import type { GuaranteeId, GuaranteeState } from "../guarantees/domain";
import { registerGuaranteeAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import schema from "../schema";

type T = TestConvex<typeof schema>;

const RENT_CENTS = 100_000;
const STAFF_SUBJECT = "auth0|staff-billing";

function setup(): T {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  return t;
}

async function makeAgency(
  t: T,
  suffix: string,
  onboardingState: OnboardingState = "active",
): Promise<AgencyId> {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name: `Billing Agency ${suffix}`,
      cnpj: `1000000000000${suffix}`.slice(-14),
      agencyType: "empresa",
      email: `billing-${suffix}@agency.test.br`,
      onboardingState,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

async function seedGuarantee(
  t: T,
  {
    agencyId,
    publicId,
    status,
    activatedAt,
    activationFeePending = false,
  }: {
    agencyId: AgencyId;
    publicId: string;
    status: GuaranteeState;
    activatedAt: string | null;
    activationFeePending?: boolean;
  },
): Promise<GuaranteeId> {
  const { guaranteeId } = await seedGuaranteeWithLease(
    t,
    { agencyId, status, rentCents: RENT_CENTS, activatedAt },
    publicId,
  );
  if (activationFeePending) {
    await t.run((ctx) => ctx.db.patch(guaranteeId, { activationFee: { status: "pending" } }));
  }
  return guaranteeId;
}

async function invoicesOf(t: T, agencyId: AgencyId) {
  return t.run((ctx) =>
    ctx.db
      .query("invoices")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", agencyId))
      .collect(),
  );
}

function bill(t: T, periodMonth: string) {
  return t.mutation(internal.invoices.mutations.generateMonthlyInvoices, { periodMonth });
}

function nextPeriodMonth(from: Date): string {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

describe("generateMonthlyInvoices — activation fee", () => {
  let t: T;
  let agencyId: AgencyId;

  beforeEach(async () => {
    t = setup();
    agencyId = await makeAgency(t, "1");
  });

  test("a guarantee activated after the 1st is billed its fee on the next run, once", async () => {
    await seedGuarantee(t, {
      agencyId,
      publicId: "OLD1",
      status: "active",
      activatedAt: "2026-06-01T00:00:00.000Z",
    });
    await bill(t, "2026-10");
    const activatedMidMonth = await seedGuarantee(t, {
      agencyId,
      publicId: "MID1",
      status: "active",
      activatedAt: "2026-10-15T12:00:00.000Z",
      activationFeePending: true,
    });

    await bill(t, "2026-11");
    await bill(t, "2026-12");

    const invoices = await invoicesOf(t, agencyId);
    const activationLines = invoices.flatMap((invoice) =>
      invoice.lineItems
        .filter((item) => item.kind === "activation")
        .map((item) => ({ period: invoice.periodMonth, publicId: item.guaranteePublicId })),
    );
    expect(activationLines).toEqual([{ period: "2026-11", publicId: "MID1" }]);

    const november = invoices.find((invoice) => invoice.periodMonth === "2026-11");
    const guarantee = await t.run((ctx) => ctx.db.get(activatedMidMonth));
    expect(guarantee?.activationFee).toMatchObject({
      status: "invoiced",
      invoiceId: november?._id,
    });
  });

  test("re-running the same period never bills the fee twice", async () => {
    await seedGuarantee(t, {
      agencyId,
      publicId: "MID2",
      status: "active",
      activatedAt: "2026-10-15T12:00:00.000Z",
      activationFeePending: true,
    });

    await bill(t, "2026-11");
    const rerun = await bill(t, "2026-11");

    expect(rerun).toEqual([{ agencyId, skipped: true, reason: "already_invoiced" }]);
    const invoices = await invoicesOf(t, agencyId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.lineItems.filter((item) => item.kind === "activation")).toHaveLength(1);
  });

  test("a guarantee closed before its first invoice still pays the activation fee", async () => {
    await seedGuarantee(t, {
      agencyId,
      publicId: "CLS1",
      status: "closed",
      activatedAt: "2026-10-10T00:00:00.000Z",
      activationFeePending: true,
    });

    await bill(t, "2026-11");

    const invoices = await invoicesOf(t, agencyId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.lineItems.map((item) => item.kind)).toEqual(["activation"]);
  });

  test("a fee from a later activation is not billed on an earlier period", async () => {
    await seedGuarantee(t, {
      agencyId,
      publicId: "FUT1",
      status: "active",
      activatedAt: "2026-11-03T00:00:00.000Z",
      activationFeePending: true,
    });

    await bill(t, "2026-10");

    const invoices = await invoicesOf(t, agencyId);
    expect(invoices[0]?.lineItems.map((item) => item.kind)).toEqual(["recurring"]);
  });

  test("a confirmed registration marks the fee and the next month's run bills it", async () => {
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        publicId: "staff-billing",
        subject: STAFF_SUBJECT,
        name: "Billing Staff",
        email: "staff-billing@mutav.test",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await ctx.db.insert("mutavStaff", {
        userId,
        role: "compliance",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });
    const guaranteeId = await seedGuarantee(t, {
      agencyId,
      publicId: "E2E1",
      status: "drafted",
      activatedAt: null,
    });
    await t.run(async (ctx) => {
      const guarantee = await ctx.db.get(guaranteeId);
      if (!guarantee) throw new Error("guarantee vanished");
      await ctx.db.patch(guaranteeId, {
        underwriting: { ...guarantee.underwriting, review: "pending_registration" },
      });
      const storageId = await ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" }));
      const userId = (await ctx.db.query("users").first())?._id;
      if (!userId) throw new Error("no user");
      await ctx.db.insert("guaranteeDocuments", {
        guaranteeId,
        agencyId,
        key: "rentalContract",
        storageId,
        fileName: "contrato.pdf",
        contentType: "application/pdf",
        sizeBytes: 4,
        uploadedBy: { kind: "staff", userId },
        uploadedAt: "2026-10-01T00:00:00.000Z",
        status: "approved",
      });
    });

    // Activation is the on-chain registration (ADR 0010): the verified
    // transaction's write half is what puts the guarantee on risk and bills it.
    const activated = await t
      .withIdentity({ subject: STAFF_SUBJECT })
      .mutation(internal.guarantees.registration.recordRegistrationConfirmed, {
        publicId: "E2E1",
        txSignature: "5".repeat(88),
        slot: 1,
        registeredAt: new Date().toISOString(),
      });
    expect(activated.success).toBe(true);
    const nextPeriod = nextPeriodMonth(new Date());
    await bill(t, nextPeriod);

    const invoices = await invoicesOf(t, agencyId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.periodMonth).toBe(nextPeriod);
    expect(invoices[0]?.lineItems.map((item) => item.kind).sort()).toEqual([
      "activation",
      "recurring",
    ]);
  });
});

describe("generateMonthlyInvoices — who gets an invoice", () => {
  let t: T;

  beforeEach(() => {
    t = setup();
  });

  test("an active agency with nothing in force gets no R$0 invoice", async () => {
    const agencyId = await makeAgency(t, "1");
    await seedGuarantee(t, { agencyId, publicId: "DRF1", status: "drafted", activatedAt: null });

    const results = await bill(t, "2026-11");

    expect(results).toEqual([{ agencyId, skipped: true, reason: "nothing_to_bill" }]);
    expect(await invoicesOf(t, agencyId)).toEqual([]);
  });

  test("an agency that is not active is skipped even with guarantees in force", async () => {
    const agencyId = await makeAgency(t, "2", "under_review");
    await seedGuarantee(t, {
      agencyId,
      publicId: "INA1",
      status: "active",
      activatedAt: "2026-06-01T00:00:00.000Z",
    });

    const results = await bill(t, "2026-11");

    expect(results).toEqual([{ agencyId, skipped: true, reason: "agency_not_active" }]);
    expect(await invoicesOf(t, agencyId)).toEqual([]);
  });

  test("an active agency with a guarantee in force is billed its recurring fee", async () => {
    const agencyId = await makeAgency(t, "3");
    await seedGuarantee(t, {
      agencyId,
      publicId: "ACT1",
      status: "active",
      activatedAt: "2026-06-01T00:00:00.000Z",
    });

    await bill(t, "2026-11");

    const invoices = await invoicesOf(t, agencyId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.totalCents).toBeGreaterThan(0);
    expect(invoices[0]?.lineItems.map((item) => item.kind)).toEqual(["recurring"]);
  });
});
