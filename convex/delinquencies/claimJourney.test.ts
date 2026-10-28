// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  registerGuaranteeAggregateComponents,
  seedAgencyWithMembership,
  seedDefaultProduct,
  seedFreshCreditAssessment,
  setupAuthenticatedUser,
} from "../lib/testFixtures";
import type { StorageId } from "../lib/storage";
import type { AgencyCaseStatus } from "./domain";

/**
 * The whole late-rent → payout journey through the real mutations, as each
 * actor would drive it from the apps, asserting after every step the case
 * status the agency sees. Unit tests cover each rule; this one proves the
 * pieces hand off to each other and that the status never lies on the way.
 */

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

const VALID_CPF = "52998224725";
const RENT_CENTS = 300_000;
const DUE_DAY = 5;
const STAFF_SUBJECT = "auth0|journey-compliance";

function brazilMonthsAgo(months: number): string {
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, 1))
    .toISOString()
    .slice(0, 7);
}

async function setup() {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  await seedDefaultProduct(t);
  const { asUser: agency, userId } = await setupAuthenticatedUser(t);
  const agencyId = await seedAgencyWithMembership(t, userId);
  await seedFreshCreditAssessment(t, { agencyId, document: VALID_CPF, score: 750 });
  await t.run(async (ctx) => {
    const staffUserId = await ctx.db.insert("users", {
      publicId: "journey-compliance",
      subject: STAFF_SUBJECT,
      name: "Compliance Staff",
      email: "compliance@mutav.finance",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.db.insert("mutavStaff", {
      userId: staffUserId,
      role: "compliance",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
  return { t, agency, agencyId, staff: t.withIdentity({ subject: STAFF_SUBJECT }) };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function storePdf(t: Setup["t"]): Promise<StorageId> {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }),
    );
    // convex-test leaves `contentType` off the `_storage` row; see
    // guarantees/documents.test.ts for why this goes through Reflect.apply.
    await Reflect.apply(ctx.db.patch, ctx.db, [
      "_storage",
      storageId,
      { contentType: "application/pdf" },
    ]);
    return storageId;
  });
}

function unwrap<T>(result: { success: true; data: T } | { success: false; message: string }): T {
  if (!result.success) throw new Error(result.message);
  return result.data;
}

describe("claim journey: late rent to payout", () => {
  test("every step hands off and the agency always sees the true status", async () => {
    const { t, agency, agencyId, staff } = await setup();

    // 1. The agency writes the guarantee, due day included, and activates it.
    const { publicId: guaranteePublicId } = unwrap(
      await agency.mutation(api.guarantees.useCases.create, {
        agencyId,
        lease: {
          propertyKind: "residential",
          property: {
            cep: "01310100",
            streetAndNumber: "Rua Harmonia, 410",
            neighborhood: "Vila Madalena",
            cityUF: "São Paulo / SP",
            complement: "Apto 32",
          },
          tag: "",
          description: "",
          rent: { rentCents: RENT_CENTS, condoCents: 0, otherFeesCents: 0, dueDay: DUE_DAY },
        },
        plan: "basic",
        tenant: {
          entityType: "pf",
          fullName: "Marina Costa",
          cpf: VALID_CPF,
          cnpj: undefined,
          birthDate: "1990-05-12",
          email: "marina@example.com",
          phone: "11900000001",
        },
      }),
    );
    unwrap(
      await agency.mutation(api.guarantees.mutations.activate, {
        agencyId,
        publicId: guaranteePublicId,
      }),
    );
    // The guarantee has been in force for a while before the rent goes unpaid.
    await t.run(async (ctx) => {
      const guarantee = await ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", guaranteePublicId))
        .unique();
      if (!guarantee) throw new Error("guarantee missing");
      await ctx.db.patch(guarantee._id, { activatedAt: "2025-01-01T00:00:00.000Z" });
    });

    // The signed contract is approved — the claim's one precondition on the guarantee.
    const contract = unwrap(
      await agency.mutation(api.guarantees.documents.attachGuaranteeDocument, {
        agencyId,
        publicId: guaranteePublicId,
        key: "rentalContract",
        storageId: await storePdf(t),
        fileName: "contrato-assinado.pdf",
      }),
    );
    unwrap(
      await staff.mutation(api.guarantees.staffDocuments.approveGuaranteeDocument, {
        documentId: contract.documentId,
      }),
    );

    // 2. The picker finds it by tenant, and the agency reports a month that is
    // past the grace period.
    const pickable = await agency.query(api.delinquencies.useCases.listReportableGuarantees, {
      agencyId,
    });
    expect(pickable.map((row) => [row.tenantName, row.eligible])).toEqual([["Marina Costa", true]]);

    const referenceMonth = brazilMonthsAgo(2);
    const { publicId: noticePublicId } = unwrap(
      await agency.mutation(api.delinquencies.mutations.openNotice, {
        agencyId,
        guaranteePublicId,
        referenceMonth,
        originalAmountCents: RENT_CENTS,
      }),
    );

    const caseStatus = async (): Promise<AgencyCaseStatus | undefined> =>
      (await agency.query(api.delinquencies.useCases.getByPublicId, { publicId: noticePublicId }))
        ?.caseStatus;
    const guaranteeStatus = async () =>
      (await agency.query(api.guarantees.useCases.getByPublicId, { publicId: guaranteePublicId }))
        ?.status;

    expect(await caseStatus()).toBe("ready_to_claim");
    expect(await guaranteeStatus()).toBe("in_arrears");

    // 3. Both files, then the claim.
    for (const kind of ["nonPaymentProof", "tenantNotice"] as const) {
      unwrap(
        await agency.mutation(api.delinquencies.claimEvidence.attachClaimEvidence, {
          noticePublicId,
          kind,
          storageId: await storePdf(t),
          fileName: `${kind}.pdf`,
        }),
      );
    }
    unwrap(
      await agency.mutation(api.delinquencies.claims.submitClaim, {
        noticePublicId,
        claimedAmountCents: RENT_CENTS,
        declarationAccepted: true,
      }),
    );
    expect(await caseStatus()).toBe("under_review");

    // 4. Staff send one file back; the agency answers and resends.
    unwrap(
      await staff.mutation(api.delinquencies.claims.staffRequestClaimInfo, {
        noticePublicId,
        requests: [{ evidenceKind: "tenantNotice", reason: "Data ilegível." }],
        dueAt: "2099-01-01",
      }),
    );
    expect(await caseStatus()).toBe("info_requested");

    unwrap(
      await agency.mutation(api.delinquencies.claimEvidence.attachClaimEvidence, {
        noticePublicId,
        kind: "tenantNotice",
        storageId: await storePdf(t),
        fileName: "notificacao-legivel.pdf",
      }),
    );
    unwrap(await agency.mutation(api.delinquencies.claims.resubmitClaim, { noticePublicId }));
    expect(await caseStatus()).toBe("under_review");

    // 5. Staff confirm the default, commit cover, and record the payout.
    unwrap(
      await staff.mutation(api.delinquencies.mutations.staffVerifyDefault, { noticePublicId }),
    );
    expect(await caseStatus()).toBe("under_review");
    expect(await guaranteeStatus()).toBe("default_verified");

    const cover = unwrap(
      await staff.mutation(api.coverOperations.mutations.staffRecordCover, { noticePublicId }),
    );
    expect(await caseStatus()).toBe("approved");
    expect(await guaranteeStatus()).toBe("cover_committed");

    unwrap(
      await staff.mutation(api.coverOperations.mutations.staffMarkCoverExecuted, {
        operationPublicId: cover.operationPublicId,
        paymentReference: "E00000000202610261200abcdef",
      }),
    );

    const detail = await agency.query(api.delinquencies.useCases.getByPublicId, {
      publicId: noticePublicId,
    });
    expect(detail?.caseStatus).toBe("paid");
    expect(detail?.canAct).toBe(false);
    expect(detail?.cover).toMatchObject({
      status: "executed",
      requestedCents: RENT_CENTS,
      appliedCents: RENT_CENTS,
      paymentReference: "E00000000202610261200abcdef",
    });

    // The guarantee's own history tells the same story in order.
    const history = await t.run((ctx) =>
      ctx.db
        .query("guaranteeHistory")
        .withIndex("by_agency_guarantee", (q) =>
          q.eq("agencyId", agencyId).eq("guaranteePublicId", guaranteePublicId),
        )
        .collect(),
    );
    expect(history.map((row) => row.message)).toEqual(
      expect.arrayContaining([
        "Garantia ativada",
        "Garantia acionada",
        "Pendência no acionamento",
        "Acionamento reenviado para análise",
      ]),
    );
  });
});
