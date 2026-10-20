// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { OnboardingState } from "../agencies/domain";
import { GUARANTEE_STATE } from "../guarantees/domain";
import schema from "../schema";
import {
  registerGuaranteeAggregateComponents,
  seedAgencyWithMembership,
  seedGuaranteeWithLease,
  setupAuthenticatedUser,
} from "./testFixtures";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

const APPLICATION_ARGS = {
  document: "12345678901",
  entityType: "pf",
  propertyKind: "residential",
  cep: "01310-100",
  rentCents: 250_000,
} as const;

async function setupAgencyInState(state: OnboardingState | undefined) {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  const { asUser, userId } = await setupAuthenticatedUser(t);
  const agencyId = await seedAgencyWithMembership(t, userId);
  await t.run((ctx) => ctx.db.patch(agencyId, { onboardingState: state }));
  return { t, asUser, agencyId };
}

describe("mutationWithActiveAgency", () => {
  test("lets a member of an active agency write", async () => {
    const { asUser, agencyId } = await setupAgencyInState("active");

    const result = await asUser.mutation(api.guarantees.useCases.openContractApplication, {
      agencyId,
      ...APPLICATION_ARGS,
    });

    expect(result.success).toBe(true);
  });

  test.each<OnboardingState | undefined>([
    "not_started",
    "in_progress",
    "submitted",
    "under_review",
    "rejected",
    undefined,
  ])("refuses a member of an agency in onboarding state %s", async (state) => {
    const { asUser, agencyId } = await setupAgencyInState(state);

    await expect(
      asUser.mutation(api.guarantees.useCases.openContractApplication, {
        agencyId,
        ...APPLICATION_ARGS,
      }),
    ).rejects.toThrow("Agency is not active");
  });

  test("leaves onboarding mutations open to an agency still in onboarding", async () => {
    const { asUser, agencyId } = await setupAgencyInState("in_progress");

    await expect(
      asUser.mutation(api.agencies.useCases.generateDocumentUploadUrl, { agencyId }),
    ).resolves.not.toThrow();
  });
});

describe("assertActiveAgencyAccess", () => {
  test("refuses a resource-by-id write once the agency is no longer active", async () => {
    const { t, asUser, agencyId } = await setupAgencyInState("active");
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, availableCents: 10_000 },
      "C1",
    );
    const opened = await asUser.mutation(api.delinquencies.mutations.openNotice, {
      agencyId,
      guaranteePublicId: "C1",
      rentDueDate: "2026-06-05",
      originalAmountCents: 300_000,
    });
    if (!opened.success) throw new Error(opened.message);
    await t.run((ctx) => ctx.db.patch(agencyId, { onboardingState: "rejected" }));

    await expect(
      asUser.mutation(api.delinquencies.mutations.markResolved, {
        noticePublicId: opened.data.publicId,
        resolution: { kind: "tenant_cured" },
      }),
    ).rejects.toThrow("Agency is not active");
  });
});
