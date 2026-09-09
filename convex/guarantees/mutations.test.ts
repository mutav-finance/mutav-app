// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import type { UserId } from "../users/domain";
import type { MutavStaffRole } from "../mutavStaff/domain";
import { registerContractAggregateComponents, seedGuaranteeWithLease } from "../lib/testFixtures";
import {
  CLOSE_REASON,
  GUARANTEE_STATE,
  type Guarantee,
  type GuaranteeId,
  type GuaranteeState,
} from "./domain";
import schema from "../schema";

type T = TestConvex<typeof schema>;

const RENT_CENTS = 100_000;
// 30x the fixture rent under `DEFAULT_PRICING_TABLE`.
const CEILING_CENTS = 3_000_000;

function setup(): T {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  return t;
}

type Fixture = {
  subject: string;
  userId: UserId;
  agencyId: AgencyId;
};

async function makeFixture(t: T, suffix: string): Promise<Fixture> {
  const subject = `auth0|user-${suffix}`;
  const { userId, agencyId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `user-${suffix}`,
      subject,
      name: `Fixture User ${suffix}`,
      email: `fixture-${suffix}@test.br`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: `Fixture Agency ${suffix}`,
      cnpj: `0000000000000${suffix}`.slice(-14),
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: "owner",
      joinedAt: "2026-01-01T00:00:00.000Z",
    });
    return { userId, agencyId };
  });
  return { subject, userId, agencyId };
}

async function grantStaffRole(t: T, userId: UserId, role: MutavStaffRole): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("mutavStaff", { userId, role, createdAt: "2026-01-01T00:00:00.000Z" }),
  );
}

async function readGuarantee(t: T, guaranteeId: GuaranteeId): Promise<Guarantee> {
  const doc = await t.run((ctx) => ctx.db.get(guaranteeId));
  if (!doc) throw new Error("guarantee vanished");
  return doc;
}

async function seedGuarantee(
  t: T,
  fx: Fixture,
  publicId: string,
  status: GuaranteeState,
  extra: { availableCents?: number } = {},
) {
  return seedGuaranteeWithLease(
    t,
    {
      agencyId: fx.agencyId,
      status,
      rentCents: RENT_CENTS,
      tenantTaxId: "11144477735",
      activatedAt: status === GUARANTEE_STATE.DRAFTED ? null : "2026-02-01T00:00:00.000Z",
      ...extra,
    },
    publicId,
  );
}

describe("guarantees.activate", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
  });

  test("moves a draft on risk and initializes capacity from the terms snapshot", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "A1", GUARANTEE_STATE.DRAFTED);
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.guarantees.mutations.activate, {
      agencyId: fx.agencyId,
      publicId: "A1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.capacity).toEqual({
      ceilingCents: CEILING_CENTS,
      availableCents: CEILING_CENTS,
      reservedCents: 0,
    });

    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe(GUARANTEE_STATE.ACTIVE);
    expect(after.activatedAt).not.toBeNull();
    expect(after.capacity.ceilingCents).toBe(after.terms.coverageCeilingCents);
  });

  test("refuses to activate a guarantee that is already in force", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "A2", GUARANTEE_STATE.ACTIVE);
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.guarantees.mutations.activate, {
      agencyId: fx.agencyId,
      publicId: "A2",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("SELF_TRANSITION");
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.ACTIVE);
  });

  test("returns NOT_FOUND for another agency's draft without revealing it", async () => {
    const other = await makeFixture(t, "2");
    await seedGuarantee(t, other, "A3", GUARANTEE_STATE.DRAFTED);
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.guarantees.mutations.activate, {
      agencyId: fx.agencyId,
      publicId: "A3",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("guarantees.closeEndOfLease", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
  });

  test("an agency closes its own in-force guarantee and frees the lease", async () => {
    const { guaranteeId, leaseId } = await seedGuarantee(t, fx, "B1", GUARANTEE_STATE.ACTIVE);
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.guarantees.mutations.closeEndOfLease, {
      agencyId: fx.agencyId,
      publicId: "B1",
    });

    expect(result.success).toBe(true);
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe(GUARANTEE_STATE.CLOSED);
    expect(after.closure?.reason).toBe(CLOSE_REASON.END_OF_LEASE);
    expect((await t.run((ctx) => ctx.db.get(leaseId)))?.openGuaranteeId).toBeNull();
  });

  test("a draft cannot be ended as end_of_lease — it can only be canceled", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "B2", GUARANTEE_STATE.DRAFTED);
    const asUser = t.withIdentity({ subject: fx.subject });

    const result = await asUser.mutation(api.guarantees.mutations.closeEndOfLease, {
      agencyId: fx.agencyId,
      publicId: "B2",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("REASON_NOT_ALLOWED_FROM_STATE");
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.DRAFTED);
  });
});

describe("guarantees.close — staff", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
  });

  test("compliance staff close a verified default as dispute_reversal", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "S1", GUARANTEE_STATE.DEFAULT_VERIFIED);
    await grantStaffRole(t, fx.userId, "compliance");
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.close, {
      publicId: "S1",
      reason: CLOSE_REASON.DISPUTE_REVERSAL,
    });

    expect(result.success).toBe(true);
    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe(GUARANTEE_STATE.CLOSED);
    expect(after.closure?.reason).toBe(CLOSE_REASON.DISPUTE_REVERSAL);
  });

  test("eviction is only a legal reason from in_eviction", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "S2", GUARANTEE_STATE.ACTIVE);
    await grantStaffRole(t, fx.userId, "compliance");
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.close, {
      publicId: "S2",
      reason: CLOSE_REASON.EVICTION,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("REASON_NOT_ALLOWED_FROM_STATE");
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.ACTIVE);
  });

  test("a support-role staff member cannot close", async () => {
    await seedGuarantee(t, fx, "S3", GUARANTEE_STATE.ACTIVE);
    await grantStaffRole(t, fx.userId, "support");
    const asStaff = t.withIdentity({ subject: fx.subject });

    await expect(
      asStaff.mutation(api.guarantees.mutations.close, {
        publicId: "S3",
        reason: CLOSE_REASON.RESCISSION,
      }),
    ).rejects.toThrow();
  });

  test("an agency member with no staff row cannot close", async () => {
    await seedGuarantee(t, fx, "S4", GUARANTEE_STATE.ACTIVE);
    const asUser = t.withIdentity({ subject: fx.subject });

    await expect(
      asUser.mutation(api.guarantees.mutations.close, {
        publicId: "S4",
        reason: CLOSE_REASON.RESCISSION,
      }),
    ).rejects.toThrow();
  });
});

describe("guarantees.enterEviction", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
  });

  test("compliance staff take a verified default to eviction", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "E1", GUARANTEE_STATE.DEFAULT_VERIFIED);
    await grantStaffRole(t, fx.userId, "compliance");
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.enterEviction, {
      publicId: "E1",
    });

    expect(result.success).toBe(true);
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.IN_EVICTION);
  });

  test("a draft cannot go straight to eviction", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "E2", GUARANTEE_STATE.DRAFTED);
    await grantStaffRole(t, fx.userId, "compliance");
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.enterEviction, {
      publicId: "E2",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    expect((await readGuarantee(t, guaranteeId)).status).toBe(GUARANTEE_STATE.DRAFTED);
  });
});

describe("guarantees.reprice", () => {
  let t: T;
  let fx: Fixture;

  beforeEach(async () => {
    t = setup();
    fx = await makeFixture(t, "1");
    await grantStaffRole(t, fx.userId, "compliance");
  });

  test("writes a new terms snapshot and renewal date without moving reserved cents", async () => {
    // 1,000,000 available means 2,000,000 already reserved against the 3,000,000 ceiling.
    const { guaranteeId } = await seedGuarantee(t, fx, "R1", GUARANTEE_STATE.ACTIVE, {
      availableCents: 1_000_000,
    });
    const before = await readGuarantee(t, guaranteeId);
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.reprice, {
      publicId: "R1",
      rentCents: 200_000,
      nextRenewalDate: "2027-06-30",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.capacity).toEqual({
      ceilingCents: 6_000_000,
      availableCents: 4_000_000,
      reservedCents: 2_000_000,
    });

    const after = await readGuarantee(t, guaranteeId);
    expect(after.status).toBe(GUARANTEE_STATE.ACTIVE);
    expect(after.nextRenewalDate).toBe("2027-06-30");
    expect(after.terms.rentCents).toBe(200_000);
    expect(after.terms.coverageCeilingCents).toBe(6_000_000);
    expect(after.terms.appliedAt).not.toBe(before.terms.appliedAt);
    expect(after.capacity.reservedCents).toBe(before.capacity.reservedCents);
    expect(after.capacity.availableCents + after.capacity.reservedCents).toBe(
      after.capacity.ceilingCents,
    );
  });

  test("refuses a new ceiling that would fall below what is already reserved", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "R2", GUARANTEE_STATE.ACTIVE, {
      availableCents: 1_000_000,
    });
    const before = await readGuarantee(t, guaranteeId);
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.reprice, {
      publicId: "R2",
      rentCents: 50_000,
      nextRenewalDate: "2027-06-30",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CEILING_BELOW_RESERVED");
    expect((await readGuarantee(t, guaranteeId)).terms).toEqual(before.terms);
    expect((await readGuarantee(t, guaranteeId)).capacity).toEqual(before.capacity);
  });

  test("refuses to reprice a closed guarantee", async () => {
    await seedGuarantee(t, fx, "R3", GUARANTEE_STATE.CLOSED);
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.reprice, {
      publicId: "R3",
      nextRenewalDate: "2027-06-30",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("GUARANTEE_CLOSED");
  });

  test.each([
    { label: "a malformed renewal date", args: { nextRenewalDate: "30/06/2027" } },
    { label: "an impossible calendar date", args: { nextRenewalDate: "2027-13-40" } },
  ])("refuses $label", async ({ args }) => {
    await seedGuarantee(t, fx, "R4", GUARANTEE_STATE.ACTIVE);
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.reprice, {
      publicId: "R4",
      ...args,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_RENEWAL_DATE");
  });

  test("refuses a non-positive rent", async () => {
    await seedGuarantee(t, fx, "R5", GUARANTEE_STATE.ACTIVE);
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.reprice, {
      publicId: "R5",
      rentCents: 0,
      nextRenewalDate: "2027-06-30",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_RENT");
  });

  test("keeps the current rent when the caller only moves the renewal date", async () => {
    const { guaranteeId } = await seedGuarantee(t, fx, "R6", GUARANTEE_STATE.ACTIVE);
    const before = await readGuarantee(t, guaranteeId);
    const asStaff = t.withIdentity({ subject: fx.subject });

    const result = await asStaff.mutation(api.guarantees.mutations.reprice, {
      publicId: "R6",
      nextRenewalDate: "2028-01-15",
    });

    expect(result.success).toBe(true);
    const after = await readGuarantee(t, guaranteeId);
    expect(after.terms.rentCents).toBe(before.terms.rentCents);
    expect(after.capacity).toEqual(before.capacity);
    expect(after.nextRenewalDate).toBe("2028-01-15");
  });

  test("a support-role staff member cannot reprice", async () => {
    const second = await makeFixture(t, "2");
    await seedGuarantee(t, second, "R7", GUARANTEE_STATE.ACTIVE);
    await grantStaffRole(t, second.userId, "support");
    const asStaff = t.withIdentity({ subject: second.subject });

    await expect(
      asStaff.mutation(api.guarantees.mutations.reprice, {
        publicId: "R7",
        nextRenewalDate: "2027-06-30",
      }),
    ).rejects.toThrow();
  });
});
