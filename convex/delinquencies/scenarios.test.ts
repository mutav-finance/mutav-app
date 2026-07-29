// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import { registerContractAggregateComponents } from "../lib/testFixtures";
import schema from "../schema";
import type { UserId } from "../users/domain";
import type { AgencyId } from "../agencies/domain";
import type { ContractId } from "../contracts/domain";
import type { DelinquencyNoticeId } from "./domain";
import {
  NOTICE_CANCELLATION_REASON,
  NOTICE_EVIDENCE_SOURCE,
  NOTICE_RESOLUTION_KIND,
} from "./domain";
import type { DelinquencyNotice } from "./domain";
import { assertTransition, type DelinquencyStatus } from "./machine";

// The patch type ctx.db.patch expects for a notice row: a partial of the Doc
// with system fields omitted. Extracting it here means guardedPatch stays
// fully typed without touching `as`.
type NoticePatch = Partial<Omit<DelinquencyNotice, "_id" | "_creationTime">>;

// seedReset (used by the last describe block) hashes tenant taxIds through
// the PII crypto helpers; without these keys the first seeded insert throws.
beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64"); // hook-ok: test-only env fixture
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64"); // hook-ok: test-only env fixture
});

function setup() {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  return t;
}

// A fully-populated fixture the tests can lean on: one user, one agency with
// owner membership, one contract with a registry-linked tenant. Everything is
// inserted inline inside a single t.run so downstream tests can assume the
// row shape holds against the real schema validator.
type Fixture = {
  userId: UserId;
  agencyId: AgencyId;
  contractId: ContractId;
};

async function makeFixture(t: ReturnType<typeof setup>, suffix = "1"): Promise<Fixture> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      publicId: `user-${suffix}`,
      name: `Fixture User ${suffix}`,
      email: `fixture-${suffix}@test.br`,
      createdAt: "2024-01-01T00:00:00-03:00",
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: `Fixture Agency ${suffix}`,
      cnpj: `0000000000000${suffix}`.slice(-14),
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: "2024-01-01T00:00:00-03:00",
    });
    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: "owner",
      joinedAt: "2024-01-01T00:00:00-03:00",
    });
    const tenantId = await ctx.db.insert("tenants", {
      entityType: "pf",
      taxId: `1114447773${suffix}`.slice(-11),
      fullName: `Tenant ${suffix}`,
      birthDate: "1990-01-01",
      email: `tenant-${suffix}@test.br`,
      phone: "11999999999",
    });
    const contractId = await ctx.db.insert("contracts", {
      agencyId,
      publicId: `CT-${suffix}`,
      tenantId,
      tenantApproval: { status: "aprovado", termApprovedAt: "2024-06-01" },
      status: "ativo",
      activatedAt: "2024-06-01",
      deactivatedAt: null,
      nextRenewalDate: "2026-12-31",
      availableGuaranteeCents: 3_600_000,
      rental: {
        propertyKind: "residencial",
        plan: "basic",
        rentCents: 300_000,
        condoCents: 0,
        otherFeesCents: 0,
        totalRentCents: 300_000,
        feeCents: 1500,
        oneTimeActivationFeeCents: 0,
        setupInstallments: 1,
        exitCostMultiplier: "5x",
        rentMultiplier: "12x",
        payer: "inquilino",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
    });
    return { userId, agencyId, contractId };
  });
}

// Insert a second contract inside an existing agency. Used to prove
// by_contract_dueDate is truly scoped by contractId.
async function insertSecondContract(
  t: ReturnType<typeof setup>,
  agencyId: AgencyId,
  suffix: string,
): Promise<ContractId> {
  return t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      entityType: "pf",
      taxId: `2224447773${suffix}`.slice(-11),
      fullName: `Second Tenant ${suffix}`,
      birthDate: "1990-01-01",
      email: `second-tenant-${suffix}@test.br`,
      phone: "11888888888",
    });
    return ctx.db.insert("contracts", {
      agencyId,
      publicId: `CT-second-${suffix}`,
      tenantId,
      tenantApproval: { status: "aprovado", termApprovedAt: "2024-06-01" },
      status: "ativo",
      activatedAt: "2024-06-01",
      deactivatedAt: null,
      nextRenewalDate: "2026-12-31",
      availableGuaranteeCents: 3_600_000,
      rental: {
        propertyKind: "residencial",
        plan: "basic",
        rentCents: 300_000,
        condoCents: 0,
        otherFeesCents: 0,
        totalRentCents: 300_000,
        feeCents: 1500,
        oneTimeActivationFeeCents: 0,
        setupInstallments: 1,
        exitCostMultiplier: "5x",
        rentMultiplier: "12x",
        payer: "inquilino",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
    });
  });
}

// Mirrors the pattern the future mutation layer will use: check the machine
// guard, and only touch the DB when the guard approves. Returning the guard
// result lets the caller assert on it. This makes the composition tests
// depend on the guard actually blocking the write, not on a hand-written skip.
async function guardedPatch(
  t: ReturnType<typeof setup>,
  id: DelinquencyNoticeId,
  from: DelinquencyStatus,
  to: DelinquencyStatus,
  patch: NoticePatch,
) {
  const guard = assertTransition(from, to);
  if (guard.success) {
    await t.run((ctx) => ctx.db.patch(id, patch));
  }
  return guard;
}

// ---------------------------------------------------------------------------
// schema conformance
// ---------------------------------------------------------------------------

describe("schema conformance — the notice row shape holds under real DB writes", () => {
  test("inserts a minimal open notice with only required fields (no resolution / cancellation)", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-min-1",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row).not.toBeNull();
    expect(row?.status).toBe("open");
    expect(row?.publicId).toBe("DN-min-1");
    expect(row?.rentDueDate).toBe("2026-06-05");
    expect(row?.originalAmountCents).toBe(300_000);
    expect(row?.updatedAmountCents).toBe(300_000);
    expect(row?.evidenceSource).toBe("agency_reported");
    expect(row?.openedByUserId).toBe(userId);
    expect(row?.resolution).toBeUndefined();
    expect(row?.cancellation).toBeUndefined();
  });

  test("inserts a resolved notice carrying the full resolution envelope (tenant_cured)", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-resolved-tc",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-04-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 315_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-04-08T10:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "tenant_cured",
          resolvedAt: "2026-04-15T14:30:00-03:00",
          resolvedByUserId: userId,
          note: "Inquilino quitou diretamente com o proprietário.",
        },
      }),
    );

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("tenant_cured");
    expect(row?.resolution?.coverOperationPublicId).toBeUndefined();
    expect(row?.cancellation).toBeUndefined();
  });

  test("inserts a resolved notice with cover_committed + coverOperationPublicId set", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-resolved-cc",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-05-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 310_500,
        evidenceSource: "agency_reported",
        openedAt: "2026-05-10T09:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "cover_committed",
          resolvedAt: "2026-05-20T14:00:00-03:00",
          resolvedByUserId: userId,
          coverOperationPublicId: "CO-2026-05-0001",
          note: "Reserva acionada; recebível regressivo aberto.",
        },
      }),
    );

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("cover_committed");
    expect(row?.resolution?.coverOperationPublicId).toBe("CO-2026-05-0001");
  });

  test("inserts a canceled notice carrying the full cancellation envelope", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-canceled-aw",
        contractId,
        agencyId,
        status: "canceled",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
        cancellation: {
          reason: "agency_withdrew",
          canceledAt: "2026-06-11T09:00:00-03:00",
          canceledByUserId: userId,
          note: "Descobrimos que o pagamento havia sido feito diretamente.",
        },
      }),
    );

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("canceled");
    expect(row?.cancellation?.reason).toBe("agency_withdrew");
    expect(row?.resolution).toBeUndefined();
  });

  test("accepts every NOTICE_EVIDENCE_SOURCE value as evidenceSource", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const sources = Object.values(NOTICE_EVIDENCE_SOURCE);
    const ids = await t.run(async (ctx) => {
      const inserted: Array<{ source: string; id: DelinquencyNoticeId }> = [];
      let i = 0;
      for (const source of sources) {
        const id = await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-evsrc-${i}`,
          contractId,
          agencyId,
          status: "open",
          rentDueDate: "2026-06-05",
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: source,
          openedAt: `2026-06-${String(10 + i).padStart(2, "0")}T09:00:00-03:00`,
          openedByUserId: userId,
        });
        inserted.push({ source, id });
        i += 1;
      }
      return inserted;
    });

    expect(ids.length).toBe(sources.length);
    for (const { source, id } of ids) {
      const row = await t.run((ctx) => ctx.db.get(id));
      expect(row?.evidenceSource).toBe(source);
    }
  });

  test("accepts every NOTICE_RESOLUTION_KIND value in the resolution envelope", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const kinds = Object.values(NOTICE_RESOLUTION_KIND);
    const ids = await t.run(async (ctx) => {
      const inserted: Array<{ kind: string; id: DelinquencyNoticeId }> = [];
      let i = 0;
      for (const kind of kinds) {
        const id = await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-rkind-${i}`,
          contractId,
          agencyId,
          status: "resolved",
          rentDueDate: "2026-04-05",
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-04-${String(8 + i).padStart(2, "0")}T09:00:00-03:00`,
          openedByUserId: userId,
          resolution: {
            kind,
            resolvedAt: `2026-04-${String(15 + i).padStart(2, "0")}T14:00:00-03:00`,
            resolvedByUserId: userId,
          },
        });
        inserted.push({ kind, id });
        i += 1;
      }
      return inserted;
    });

    expect(ids.length).toBe(kinds.length);
    for (const { kind, id } of ids) {
      const row = await t.run((ctx) => ctx.db.get(id));
      expect(row?.resolution?.kind).toBe(kind);
    }
  });

  test("accepts every NOTICE_CANCELLATION_REASON value in the cancellation envelope", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const reasons = Object.values(NOTICE_CANCELLATION_REASON);
    const ids = await t.run(async (ctx) => {
      const inserted: Array<{ reason: string; id: DelinquencyNoticeId }> = [];
      let i = 0;
      for (const reason of reasons) {
        const id = await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-crsn-${i}`,
          contractId,
          agencyId,
          status: "canceled",
          rentDueDate: "2026-06-05",
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-06-${String(10 + i).padStart(2, "0")}T09:00:00-03:00`,
          openedByUserId: userId,
          cancellation: {
            reason,
            canceledAt: `2026-06-${String(11 + i).padStart(2, "0")}T09:00:00-03:00`,
            canceledByUserId: userId,
          },
        });
        inserted.push({ reason, id });
        i += 1;
      }
      return inserted;
    });

    expect(ids.length).toBe(reasons.length);
    for (const { reason, id } of ids) {
      const row = await t.run((ctx) => ctx.db.get(id));
      expect(row?.cancellation?.reason).toBe(reason);
    }
  });

  // Documents the SEMANTIC pairing between resolution.kind and
  // coverOperationPublicId — companion to the enum-sweep test above, which
  // proves the schema is permissive. The mutation layer will lift these
  // pairings into a Result<> guard; until then, this test documents intent.
  test("resolution.kind='cover_committed' round-trips WITH coverOperationPublicId; the other three kinds round-trip WITHOUT it", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    // cover_committed WITH the op ref.
    const ccId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-pair-cc",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-04-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-04-10T09:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "cover_committed",
          resolvedAt: "2026-04-20T09:00:00-03:00",
          resolvedByUserId: userId,
          coverOperationPublicId: "CO-pair-1",
        },
      }),
    );
    const ccRow = await t.run((ctx) => ctx.db.get(ccId));
    expect(ccRow?.resolution?.coverOperationPublicId).toBe("CO-pair-1");

    // tenant_cured, staff_dispute, stale — all WITHOUT coverOperationPublicId.
    const kindsWithoutOp: Array<"tenant_cured" | "staff_dispute" | "stale"> = [
      "tenant_cured",
      "staff_dispute",
      "stale",
    ];
    let i = 0;
    for (const kind of kindsWithoutOp) {
      const id = await t.run((ctx) =>
        ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-pair-nop-${i}`,
          contractId,
          agencyId,
          status: "resolved",
          rentDueDate: "2026-04-05",
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-05-${String(10 + i).padStart(2, "0")}T09:00:00-03:00`,
          openedByUserId: userId,
          resolution: {
            kind,
            resolvedAt: `2026-05-${String(20 + i).padStart(2, "0")}T09:00:00-03:00`,
            resolvedByUserId: userId,
          },
        }),
      );
      const row = await t.run((ctx) => ctx.db.get(id));
      expect(row?.resolution?.kind).toBe(kind);
      expect(row?.resolution?.coverOperationPublicId).toBeUndefined();
      i += 1;
    }
  });

  test("resolution and cancellation envelopes accept the note-absent shape", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const resolvedId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-nonote-res",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-04-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-04-10T09:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "tenant_cured",
          resolvedAt: "2026-04-15T09:00:00-03:00",
          resolvedByUserId: userId,
        },
      }),
    );
    const canceledId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-nonote-can",
        contractId,
        agencyId,
        status: "canceled",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
        cancellation: {
          reason: "agency_withdrew",
          canceledAt: "2026-06-11T09:00:00-03:00",
          canceledByUserId: userId,
        },
      }),
    );

    const resolvedRow = await t.run((ctx) => ctx.db.get(resolvedId));
    const canceledRow = await t.run((ctx) => ctx.db.get(canceledId));
    expect(resolvedRow?.resolution).toBeDefined();
    expect(resolvedRow?.resolution?.note).toBeUndefined();
    expect(canceledRow?.cancellation).toBeDefined();
    expect(canceledRow?.cancellation?.note).toBeUndefined();
  });

  // The schema module currently sets `schemaValidation: false` because the
  // app is pre-production and iterates on shape frequently (see CLAUDE.md
  // § Schema changes & migrations). That means db.insert / db.patch tolerate
  // unknown enum values at the storage layer — validation is deferred to the
  // mutation `args:` boundary. These four tests lock in two things:
  //   (1) The domain-exported validators are unions of the exact set of
  //       literals (not widened to v.string()), so once a mutation adopts
  //       them as `args.status: delinquencyStatusValidator`, unknown values
  //       WILL be rejected at the call site.
  //   (2) The current schema-layer permissiveness — so a future flip of
  //       `schemaValidation: true` shows up as one of these tests failing
  //       and prompts a review.
  test("delinquencyStatusValidator is a 3-literal union (open|resolved|canceled), not widened to v.string()", async () => {
    const { delinquencyStatusValidator } = await import("./domain");
    // Convex validators expose a `kind` discriminator and a `.members` array
    // for unions. If someone widened the validator to v.string(), .kind would
    // be "string" and .members would be undefined.
    expect(delinquencyStatusValidator.kind).toBe("union");
    const members = (delinquencyStatusValidator as unknown as { members: Array<{ value: string }> })
      .members;
    expect(members.map((m) => m.value).sort()).toEqual(["canceled", "open", "resolved"]);
  });

  test("noticeEvidenceSourceValidator is a 5-literal union matching NOTICE_EVIDENCE_SOURCE exactly", async () => {
    const { noticeEvidenceSourceValidator } = await import("./domain");
    expect(noticeEvidenceSourceValidator.kind).toBe("union");
    const members = (
      noticeEvidenceSourceValidator as unknown as { members: Array<{ value: string }> }
    ).members;
    expect(members.map((m) => m.value).sort()).toEqual(
      Object.values(NOTICE_EVIDENCE_SOURCE).sort(),
    );
  });

  test("noticeResolutionKindValidator is a 4-literal union matching NOTICE_RESOLUTION_KIND exactly", async () => {
    const { noticeResolutionKindValidator } = await import("./domain");
    expect(noticeResolutionKindValidator.kind).toBe("union");
    const members = (
      noticeResolutionKindValidator as unknown as { members: Array<{ value: string }> }
    ).members;
    expect(members.map((m) => m.value).sort()).toEqual(
      Object.values(NOTICE_RESOLUTION_KIND).sort(),
    );
  });

  test("noticeCancellationReasonValidator is a 4-literal union matching NOTICE_CANCELLATION_REASON exactly", async () => {
    const { noticeCancellationReasonValidator } = await import("./domain");
    expect(noticeCancellationReasonValidator.kind).toBe("union");
    const members = (
      noticeCancellationReasonValidator as unknown as { members: Array<{ value: string }> }
    ).members;
    expect(members.map((m) => m.value).sort()).toEqual(
      Object.values(NOTICE_CANCELLATION_REASON).sort(),
    );
  });

  // Companion to the validator tests above: prove the current schema-layer
  // permissiveness explicitly, so anyone flipping schemaValidation:true will
  // see this test fail and reconsider.
  test("schema-layer PERMITS unknown evidenceSource values today (schemaValidation:false) — this is intentional pre-production and will flip later", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const id = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-perm-evsrc",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        // hook-ok: deliberate schema-permissiveness test — proves that until
        // schemaValidation flips to true or a mutation wraps this insert,
        // unknown enum values reach storage.
        evidenceSource: "not_a_real_source" as unknown as "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.evidenceSource).toBe("not_a_real_source");
  });

  // The schema does NOT couple `status: 'resolved'` to a required `resolution`
  // envelope — both `resolution` and `cancellation` are v.optional(). This test
  // documents that gap so nobody assumes the schema is doing the work: a
  // resolved row with no envelope INSERTS successfully today, which is why the
  // future mutation layer must enforce the pairing before hitting db.insert.
  test("schema PERMITS status:'resolved' with no resolution envelope — documenting the mutation-layer responsibility", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const id = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-schema-gap-resolved",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution).toBeUndefined();
    // ^ This is the invariant the mutation layer must enforce, not the schema.
  });

  // Convex enforces PK/document-id uniqueness but does NOT enforce that our
  // application-layer `publicId` is globally unique. by_publicId is a lookup
  // index only. This test locks in that fact so future mutation code knows it
  // must assert uniqueness explicitly before inserting.
  test("by_publicId does NOT enforce uniqueness at the schema layer — two rows can share a publicId", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-collision",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-collision",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-07-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-07-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const rows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", "DN-collision"))
        .collect(),
    );
    expect(rows.length).toBe(2);
    // ^ Callers of getByPublicId must assert uniqueness before assuming .first().
  });
});

// ---------------------------------------------------------------------------
// index coverage
// ---------------------------------------------------------------------------

describe("index coverage — each of the four indexes returns the rows a realistic query needs", () => {
  test("by_publicId resolves a single notice by its 'DN-…' public identifier", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const targetPublicId = "DN-lookup-target";
    const targetId = await t.run(async (ctx) => {
      const insertedIds: DelinquencyNoticeId[] = [];
      const publicIds = ["DN-lookup-other-1", targetPublicId, "DN-lookup-other-2"];
      let i = 0;
      for (const pid of publicIds) {
        const id = await ctx.db.insert("contractDelinquencyNotices", {
          publicId: pid,
          contractId,
          agencyId,
          status: "open",
          rentDueDate: "2026-06-05",
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-06-${String(10 + i).padStart(2, "0")}T09:00:00-03:00`,
          openedByUserId: userId,
        });
        insertedIds.push(id);
        i += 1;
      }
      return insertedIds[1];
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", targetPublicId))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]._id).toBe(targetId);
  });

  test("by_publicId returns an empty result when the publicId does not exist", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-exists",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const rows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", "DN-does-not-exist"))
        .collect(),
    );
    expect(rows).toEqual([]);
  });

  // by_publicId is application-scoped, not agency-scoped. The lookup returns
  // whatever row matches the publicId — the caller is responsible for calling
  // assertAgencyAccess on the result. This test documents that security
  // contract explicitly so a future refactor doesn't accidentally rely on the
  // index to do isolation for it.
  test("by_publicId returns a row regardless of agency — callers must assertAgencyAccess (documents the security contract)", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");

    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-x-agency",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: b.userId,
      });
    });

    // Agency A queries by publicId — Convex hands back B's row. A caller
    // acting on agency A's behalf must then reject the row by comparing
    // agencyId; the index does not (and cannot) do that itself.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_publicId", (q) => q.eq("publicId", "DN-x-agency"))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].agencyId).toBe(b.agencyId);
    expect(rows[0].agencyId).not.toBe(a.agencyId);
  });

  test("by_agency_status returns only open notices for the given agency", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-open-a",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-open-b",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-06",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-11T09:00:00-03:00",
        openedByUserId: userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-res-a",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-05-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-05-10T09:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "tenant_cured",
          resolvedAt: "2026-05-15T09:00:00-03:00",
          resolvedByUserId: userId,
        },
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-can-a",
        contractId,
        agencyId,
        status: "canceled",
        rentDueDate: "2026-04-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-04-10T09:00:00-03:00",
        openedByUserId: userId,
        cancellation: {
          reason: "agency_withdrew",
          canceledAt: "2026-04-11T09:00:00-03:00",
          canceledByUserId: userId,
        },
      });
    });

    const openRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", "open"))
        .collect(),
    );

    expect(openRows.length).toBe(2);
    expect(openRows.map((r) => r.publicId).sort()).toEqual(["DN-open-a", "DN-open-b"]);
  });

  test("by_agency_status with status='canceled' returns only canceled notices for the agency", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-can-list-a",
        contractId,
        agencyId,
        status: "canceled",
        rentDueDate: "2026-04-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-04-10T09:00:00-03:00",
        openedByUserId: userId,
        cancellation: {
          reason: "agency_withdrew",
          canceledAt: "2026-04-11T09:00:00-03:00",
          canceledByUserId: userId,
        },
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-can-list-b",
        contractId,
        agencyId,
        status: "canceled",
        rentDueDate: "2026-05-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-05-10T09:00:00-03:00",
        openedByUserId: userId,
        cancellation: {
          reason: "duplicate",
          canceledAt: "2026-05-11T09:00:00-03:00",
          canceledByUserId: userId,
        },
      });
      // Non-canceled negative control.
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-can-list-open",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      });
    });

    const canceledRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", "canceled"))
        .collect(),
    );
    expect(canceledRows.length).toBe(2);
    expect(canceledRows.every((r) => r.status === "canceled")).toBe(true);
    expect(canceledRows.map((r) => r.publicId).sort()).toEqual(["DN-can-list-a", "DN-can-list-b"]);
  });

  test("by_contract_dueDate returns a single contract's notices ordered by rentDueDate AND excludes notices on a second contract in the same agency", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);
    const contractBId = await insertSecondContract(t, agencyId, "1");

    await t.run(async (ctx) => {
      // Contract A — dates deliberately out of chronological order.
      const aDueDates = ["2026-05-05", "2026-03-05", "2026-06-05", "2026-04-05"];
      let i = 0;
      for (const rentDueDate of aDueDates) {
        await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-orderA-${i}`,
          contractId,
          agencyId,
          status: "open",
          rentDueDate,
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-0${i + 1}-15T09:00:00-03:00`,
          openedByUserId: userId,
        });
        i += 1;
      }
      // Contract B — dates that would interleave with A if scoping breaks.
      const bDueDates = ["2026-02-05", "2026-05-15", "2026-07-05"];
      let j = 0;
      for (const rentDueDate of bDueDates) {
        await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-orderB-${j}`,
          contractId: contractBId,
          agencyId,
          status: "open",
          rentDueDate,
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-0${j + 2}-20T09:00:00-03:00`,
          openedByUserId: userId,
        });
        j += 1;
      }
    });

    const aRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", contractId))
        .collect(),
    );
    expect(aRows.map((r) => r.rentDueDate)).toEqual([
      "2026-03-05",
      "2026-04-05",
      "2026-05-05",
      "2026-06-05",
    ]);
    expect(aRows.every((r) => r.contractId === contractId)).toBe(true);

    const bRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", contractBId))
        .collect(),
    );
    expect(bRows.map((r) => r.rentDueDate)).toEqual(["2026-02-05", "2026-05-15", "2026-07-05"]);
    expect(bRows.every((r) => r.contractId === contractBId)).toBe(true);
  });

  test("by_contract_dueDate scoped to contract A excludes notices on contract B for the same agency (dedicated isolation control)", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);
    const contractBId = await insertSecondContract(t, agencyId, "iso");

    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-isoAB-A",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-isoAB-B",
        contractId: contractBId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-11T09:00:00-03:00",
        openedByUserId: userId,
      });
    });

    const aRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", contractId))
        .collect(),
    );
    expect(aRows.length).toBe(1);
    expect(aRows[0].publicId).toBe("DN-isoAB-A");
  });

  test("by_contract_dueDate answers a rentDueDate range query (gte/lte) returning the in-range subset in order", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    await t.run(async (ctx) => {
      const dueDates = [
        "2026-01-05",
        "2026-02-05",
        "2026-03-05",
        "2026-04-05",
        "2026-05-05",
        "2026-06-05",
      ];
      let i = 0;
      for (const rentDueDate of dueDates) {
        await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-range-${i}`,
          contractId,
          agencyId,
          status: "open",
          rentDueDate,
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-${String(i + 1).padStart(2, "0")}-10T09:00:00-03:00`,
          openedByUserId: userId,
        });
        i += 1;
      }
    });

    // "Q2 notices for this contract" — 2026-03 through 2026-05.
    const q2Rows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) =>
          q
            .eq("contractId", contractId)
            .gte("rentDueDate", "2026-03-01")
            .lte("rentDueDate", "2026-05-31"),
        )
        .collect(),
    );
    expect(q2Rows.map((r) => r.rentDueDate)).toEqual(["2026-03-05", "2026-04-05", "2026-05-05"]);
  });

  test("by_status_openedAt orders open notices by openedAt (not publicId) across agencies", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");

    // publicId sort order (a, b, c, d) is deliberately misaligned with openedAt:
    // - DN-triage-z  earliest  (2025-11-10)
    // - DN-triage-a  early     (2026-06-10)
    // - DN-triage-c  middle    (2026-06-11)
    // - DN-triage-b  latest    (2026-08-15)
    // If the index returned publicId sort order, the sequence would be a,b,c,z.
    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-triage-b",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "open",
        rentDueDate: "2026-08-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-08-15T09:00:00-03:00",
        openedByUserId: a.userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-triage-a",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: a.userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-triage-z",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "open",
        rentDueDate: "2025-11-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2025-11-10T09:00:00-03:00",
        openedByUserId: b.userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-triage-c",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "open",
        rentDueDate: "2026-06-06",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-11T09:00:00-03:00",
        openedByUserId: b.userId,
      });
      // Negative control: resolved notice must be excluded from status='open'.
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-triage-resolved",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "resolved",
        rentDueDate: "2026-05-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-05-10T09:00:00-03:00",
        openedByUserId: b.userId,
        resolution: {
          kind: "tenant_cured",
          resolvedAt: "2026-05-15T09:00:00-03:00",
          resolvedByUserId: b.userId,
        },
      });
    });

    const openRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_status_openedAt", (q) => q.eq("status", "open"))
        .collect(),
    );

    // If publicId sort leaked through, this would be [a, b, c, z].
    // The index MUST return openedAt-ordered rows: earliest first.
    expect(openRows.map((r) => r.publicId)).toEqual([
      "DN-triage-z",
      "DN-triage-a",
      "DN-triage-c",
      "DN-triage-b",
    ]);
    expect(openRows.every((r) => r.status === "open")).toBe(true);
  });

  test("by_status_openedAt includes open notices from every agency (no per-agency filter at this index)", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");

    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-inc-a",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: a.userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-inc-b",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-11T09:00:00-03:00",
        openedByUserId: b.userId,
      });
    });

    const openRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_status_openedAt", (q) => q.eq("status", "open"))
        .collect(),
    );
    const agencyIds = new Set(openRows.map((r) => r.agencyId));
    expect(agencyIds.has(a.agencyId)).toBe(true);
    expect(agencyIds.has(b.agencyId)).toBe(true);
  });

  test("by_status_openedAt with status='resolved' returns resolved-only rows in openedAt order, mutually exclusive from other statuses", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");

    await t.run(async (ctx) => {
      // Two resolved rows, misaligned publicId order.
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-res-y",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "resolved",
        rentDueDate: "2026-05-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-05-10T09:00:00-03:00",
        openedByUserId: a.userId,
        resolution: {
          kind: "tenant_cured",
          resolvedAt: "2026-05-15T09:00:00-03:00",
          resolvedByUserId: a.userId,
        },
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-res-a",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "resolved",
        rentDueDate: "2026-03-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-03-10T09:00:00-03:00",
        openedByUserId: b.userId,
        resolution: {
          kind: "cover_committed",
          resolvedAt: "2026-03-15T09:00:00-03:00",
          resolvedByUserId: b.userId,
          coverOperationPublicId: "CO-early",
        },
      });
      // Open and canceled negative controls — must be excluded.
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-neg-open",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: a.userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-neg-can",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "canceled",
        rentDueDate: "2026-04-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-04-10T09:00:00-03:00",
        openedByUserId: b.userId,
        cancellation: {
          reason: "agency_withdrew",
          canceledAt: "2026-04-11T09:00:00-03:00",
          canceledByUserId: b.userId,
        },
      });
    });

    const resolvedRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_status_openedAt", (q) => q.eq("status", "resolved"))
        .collect(),
    );
    expect(resolvedRows.map((r) => r.publicId)).toEqual(["DN-res-a", "DN-res-y"]);
    expect(resolvedRows.every((r) => r.status === "resolved")).toBe(true);
  });

  test("by_status_openedAt with status='canceled' returns canceled-only rows in openedAt order, mutually exclusive from other statuses", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");

    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-can-y",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "canceled",
        rentDueDate: "2026-05-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-05-10T09:00:00-03:00",
        openedByUserId: a.userId,
        cancellation: {
          reason: "duplicate",
          canceledAt: "2026-05-11T09:00:00-03:00",
          canceledByUserId: a.userId,
        },
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-can-a",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "canceled",
        rentDueDate: "2026-03-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-03-10T09:00:00-03:00",
        openedByUserId: b.userId,
        cancellation: {
          reason: "staff_dismissed",
          canceledAt: "2026-03-11T09:00:00-03:00",
          canceledByUserId: b.userId,
        },
      });
      // Open negative control.
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-can-neg-open",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: a.userId,
      });
    });

    const canceledRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_status_openedAt", (q) => q.eq("status", "canceled"))
        .collect(),
    );
    expect(canceledRows.map((r) => r.publicId)).toEqual(["DN-can-a", "DN-can-y"]);
    expect(canceledRows.every((r) => r.status === "canceled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cross-agency isolation
// ---------------------------------------------------------------------------

describe("cross-agency isolation — the by_agency_status index cannot leak across tenants", () => {
  test("by_agency_status scoped to agency A excludes agency B's notices with the same status", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");

    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-iso-a",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: a.userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-iso-b",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-11T09:00:00-03:00",
        openedByUserId: b.userId,
      });
    });

    const rowsForA = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", a.agencyId).eq("status", "open"))
        .collect(),
    );

    expect(rowsForA.length).toBe(1);
    expect(rowsForA[0].publicId).toBe("DN-iso-a");
    expect(rowsForA[0].agencyId).toBe(a.agencyId);
  });

  // by_contract_dueDate is keyed on contractId only. If the caller passes
  // agency B's contractId to a handler acting as agency A, the index will
  // happily return B's rows. This test documents that the caller must gate
  // the query on contract ownership (assertAgencyAccess on the contract row)
  // before ever hitting this index.
  test("by_contract_dueDate lookup with agency B's contractId returns B's notices — callers must first verify the contract belongs to the acting agency", async () => {
    const t = setup();
    const a = await makeFixture(t, "1");
    const b = await makeFixture(t, "2");

    await t.run(async (ctx) => {
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-xiso-a",
        contractId: a.contractId,
        agencyId: a.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: a.userId,
      });
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-xiso-b",
        contractId: b.contractId,
        agencyId: b.agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-11T09:00:00-03:00",
        openedByUserId: b.userId,
      });
    });

    // Query targeting agency B's contract returns agency B's rows regardless
    // of who's asking — the index has no notion of an "acting agency".
    const rowsForBContract = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", b.contractId))
        .collect(),
    );
    expect(rowsForBContract.length).toBe(1);
    expect(rowsForBContract[0].agencyId).toBe(b.agencyId);
    expect(rowsForBContract[0].agencyId).not.toBe(a.agencyId);
  });
});

// ---------------------------------------------------------------------------
// update-in-place invariants
// ---------------------------------------------------------------------------

describe("update-in-place — patching updatedAmountCents must not drift identity or audit fields", () => {
  test("updatedAmountCents patch preserves openedAt, openedByUserId, and originalAmountCents", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-audit",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const before = await t.run((ctx) => ctx.db.get(noticeId));
    expect(before?.openedAt).toBe("2026-06-10T09:00:00-03:00");
    expect(before?.openedByUserId).toBe(userId);
    expect(before?.originalAmountCents).toBe(300_000);

    await t.run((ctx) => ctx.db.patch(noticeId, { updatedAmountCents: 305_000 }));
    await t.run((ctx) => ctx.db.patch(noticeId, { updatedAmountCents: 312_000 }));

    const after = await t.run((ctx) => ctx.db.get(noticeId));
    expect(after?.updatedAmountCents).toBe(312_000);
    // Identity / audit fields must be identical to before.
    expect(after?.openedAt).toBe(before?.openedAt);
    expect(after?.openedByUserId).toBe(before?.openedByUserId);
    expect(after?.originalAmountCents).toBe(before?.originalAmountCents);
    expect(after?.publicId).toBe(before?.publicId);
    expect(after?.evidenceSource).toBe(before?.evidenceSource);
  });
});

// ---------------------------------------------------------------------------
// multi-notice lifecycle (scenario matrix rows)
// ---------------------------------------------------------------------------

describe("multi-notice lifecycle — one contract accumulating notices across cycles (scenario matrix)", () => {
  test("row 1 cure with bank evidence — an open notice resolves tenant_cured while carrying evidenceSource='bank_attested'", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row1-bank",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "bank_attested",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const guard = await guardedPatch(t, noticeId, "open", "resolved", {
      status: "resolved",
      resolution: {
        kind: "tenant_cured",
        resolvedAt: "2026-06-15T09:00:00-03:00",
        resolvedByUserId: userId,
      },
    });
    expect(guard.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("tenant_cured");
    // The (evidenceSource, resolution.kind) pair round-trips together.
    expect(row?.evidenceSource).toBe("bank_attested");
  });

  test("row 2 partial cure — updatedAmountCents can grow on an open notice via db.patch", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-partial",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    await t.run((ctx) => ctx.db.patch(noticeId, { updatedAmountCents: 305_000 }));
    const afterFirst = await t.run((ctx) => ctx.db.get(noticeId));
    expect(afterFirst?.originalAmountCents).toBe(300_000);
    expect(afterFirst?.updatedAmountCents).toBe(305_000);
    expect(afterFirst?.status).toBe("open");

    await t.run((ctx) => ctx.db.patch(noticeId, { updatedAmountCents: 312_000 }));
    const afterSecond = await t.run((ctx) => ctx.db.get(noticeId));
    expect(afterSecond?.originalAmountCents).toBe(300_000);
    expect(afterSecond?.updatedAmountCents).toBe(312_000);
    expect(afterSecond?.status).toBe("open");
  });

  test("row 3 chronic late payment — one contract accumulates multiple tenant_cured notices over successive cycles", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    // Three separate cycles: report → cure → next month → report → cure → …
    const cycles = [
      {
        due: "2026-03-05",
        openedAt: "2026-03-10T09:00:00-03:00",
        resolvedAt: "2026-03-15T09:00:00-03:00",
      },
      {
        due: "2026-04-05",
        openedAt: "2026-04-10T09:00:00-03:00",
        resolvedAt: "2026-04-15T09:00:00-03:00",
      },
      {
        due: "2026-05-05",
        openedAt: "2026-05-10T09:00:00-03:00",
        resolvedAt: "2026-05-16T09:00:00-03:00",
      },
    ];

    let i = 0;
    for (const c of cycles) {
      const id = await t.run((ctx) =>
        ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-row3-${i}`,
          contractId,
          agencyId,
          status: "open",
          rentDueDate: c.due,
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: c.openedAt,
          openedByUserId: userId,
        }),
      );
      const guard = await guardedPatch(t, id, "open", "resolved", {
        status: "resolved",
        resolution: {
          kind: "tenant_cured",
          resolvedAt: c.resolvedAt,
          resolvedByUserId: userId,
        },
      });
      expect(guard.success).toBe(true);
      i += 1;
    }

    const rows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", contractId))
        .collect(),
    );
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.status).toBe("resolved");
      expect(r.resolution?.kind).toBe("tenant_cured");
      expect(r.resolution?.coverOperationPublicId).toBeUndefined();
    }
  });

  test("cover resolution — an open notice moves to resolved(cover_committed) carrying the cover op ref; the notice-layer cycle is then closed", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-cover-close",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 306_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const guard = await guardedPatch(t, noticeId, "open", "resolved", {
      status: "resolved",
      resolution: {
        kind: "cover_committed",
        resolvedAt: "2026-06-20T09:00:00-03:00",
        resolvedByUserId: userId,
        coverOperationPublicId: "CO-2026-06-0001",
      },
    });
    expect(guard.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.coverOperationPublicId).toBe("CO-2026-06-0001");

    // Cycle closed at the notice layer: no open notices remain on this contract.
    const stillOpen = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", "open"))
        .collect(),
    );
    expect(stillOpen.filter((r) => r.contractId === contractId).length).toBe(0);
  });

  test("row 6 re-default after cover — a new open notice can be added to the same contract after prior notice is resolved", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeAId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row6-A",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-05-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 306_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-05-10T09:00:00-03:00",
        openedByUserId: userId,
      });
      await ctx.db.patch(id, {
        status: "resolved",
        resolution: {
          kind: "cover_committed",
          resolvedAt: "2026-05-20T09:00:00-03:00",
          resolvedByUserId: userId,
          coverOperationPublicId: "CO-2026-05-0001",
        },
      });
      return id;
    });

    const noticeBId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row6-B",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const rows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", contractId))
        .collect(),
    );

    expect(rows.length).toBe(2);
    expect(noticeAId).not.toBe(noticeBId);
    const byPublic = new Map(rows.map((r) => [r.publicId, r]));
    expect(byPublic.get("DN-row6-A")?.status).toBe("resolved");
    expect(byPublic.get("DN-row6-B")?.status).toBe("open");
  });

  test("row 7 batched cover — multiple open notices resolve to the same coverOperationPublicId", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeIds = await t.run(async (ctx) => {
      const dueDates = ["2026-04-05", "2026-05-05", "2026-06-05"];
      const inserted: DelinquencyNoticeId[] = [];
      let i = 0;
      for (const rentDueDate of dueDates) {
        const id = await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-row7-${i}`,
          contractId,
          agencyId,
          status: "open",
          rentDueDate,
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-0${4 + i}-15T09:00:00-03:00`,
          openedByUserId: userId,
        });
        inserted.push(id);
        i += 1;
      }
      return inserted;
    });

    const batchOp = "CO-2026-06-BATCH-01";

    for (const id of noticeIds) {
      const guard = await guardedPatch(t, id, "open", "resolved", {
        status: "resolved",
        resolution: {
          kind: "cover_committed",
          resolvedAt: "2026-06-25T09:00:00-03:00",
          resolvedByUserId: userId,
          coverOperationPublicId: batchOp,
        },
      });
      expect(guard.success).toBe(true);
    }

    const rows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", contractId))
        .collect(),
    );

    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.status).toBe("resolved");
      expect(r.resolution?.kind).toBe("cover_committed");
      expect(r.resolution?.coverOperationPublicId).toBe(batchOp);
    }
    expect(rows.map((r) => r.rentDueDate)).toEqual(["2026-04-05", "2026-05-05", "2026-06-05"]);
  });

  test("row 7 batched cover idempotency — the guard blocks a second patch on an already-resolved notice, so the audit trail (resolvedAt/resolvedByUserId) survives an operator retry", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);
    const retryUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "user-retry",
        name: "Retry Daemon",
        email: "retry@mutav.finance",
        createdAt: "2024-01-01T00:00:00-03:00",
      }),
    );

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row7-idem",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const firstGuard = await guardedPatch(t, noticeId, "open", "resolved", {
      status: "resolved",
      resolution: {
        kind: "cover_committed",
        resolvedAt: "2026-06-25T09:00:00-03:00",
        resolvedByUserId: userId,
        coverOperationPublicId: "CO-BATCH-idem",
      },
    });
    expect(firstGuard.success).toBe(true);

    const afterFirst = await t.run((ctx) => ctx.db.get(noticeId));
    expect(afterFirst?.resolution?.resolvedByUserId).toBe(userId);
    expect(afterFirst?.resolution?.resolvedAt).toBe("2026-06-25T09:00:00-03:00");

    // Operator retry: guard MUST block. If the guard fires the write anyway,
    // resolvedByUserId + resolvedAt would drift to the retry values.
    const secondGuard = await guardedPatch(t, noticeId, "resolved", "resolved", {
      status: "resolved",
      resolution: {
        kind: "cover_committed",
        resolvedAt: "2026-07-01T09:00:00-03:00",
        resolvedByUserId: retryUserId,
        coverOperationPublicId: "CO-BATCH-idem",
      },
    });
    expect(secondGuard.success).toBe(false);
    if (!secondGuard.success) {
      // resolved→resolved is a self-transition first; the machine returns that
      // code before checking terminality.
      expect(secondGuard.error.code).toBe("SELF_TRANSITION");
    }

    const afterSecond = await t.run((ctx) => ctx.db.get(noticeId));
    expect(afterSecond?.resolution?.resolvedByUserId).toBe(userId);
    expect(afterSecond?.resolution?.resolvedAt).toBe("2026-06-25T09:00:00-03:00");
  });

  test("row 7 batched cover with mixed resolutions — two notices share a coverOperationPublicId, one resolves separately via tenant_cured", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    // Three open notices, then split resolutions.
    const [n1Id, n2Id, n3Id] = await t.run(async (ctx) => {
      const dueDates = ["2026-04-05", "2026-05-05", "2026-06-05"];
      const inserted: DelinquencyNoticeId[] = [];
      let i = 0;
      for (const rentDueDate of dueDates) {
        const id = await ctx.db.insert("contractDelinquencyNotices", {
          publicId: `DN-row7-mixed-${i}`,
          contractId,
          agencyId,
          status: "open",
          rentDueDate,
          originalAmountCents: 300_000,
          updatedAmountCents: 300_000,
          evidenceSource: "agency_reported",
          openedAt: `2026-0${4 + i}-15T09:00:00-03:00`,
          openedByUserId: userId,
        });
        inserted.push(id);
        i += 1;
      }
      return inserted;
    });

    const batchOp = "CO-BATCH-mixed";

    // N1 + N3 batched via cover.
    for (const id of [n1Id, n3Id]) {
      const guard = await guardedPatch(t, id, "open", "resolved", {
        status: "resolved",
        resolution: {
          kind: "cover_committed",
          resolvedAt: "2026-06-25T09:00:00-03:00",
          resolvedByUserId: userId,
          coverOperationPublicId: batchOp,
        },
      });
      expect(guard.success).toBe(true);
    }
    // N2 paid separately by the tenant.
    const n2Guard = await guardedPatch(t, n2Id, "open", "resolved", {
      status: "resolved",
      resolution: {
        kind: "tenant_cured",
        resolvedAt: "2026-05-20T09:00:00-03:00",
        resolvedByUserId: userId,
      },
    });
    expect(n2Guard.success).toBe(true);

    // Reverse-lookup by coverOperationPublicId (filter in memory — there is no
    // dedicated index for the cover op, which is intentional).
    const all = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", contractId))
        .collect(),
    );
    const batched = all.filter((r) => r.resolution?.coverOperationPublicId === batchOp);
    expect(batched.length).toBe(2);
    expect(batched.map((r) => r.publicId).sort()).toEqual(["DN-row7-mixed-0", "DN-row7-mixed-2"]);

    const cured = all.filter((r) => r.resolution?.kind === "tenant_cured");
    expect(cured.length).toBe(1);
    expect(cured[0].publicId).toBe("DN-row7-mixed-1");
    expect(cured[0].resolution?.coverOperationPublicId).toBeUndefined();
  });

  test("row 8 multiple cover cycles — same contract carries alternating resolved and open notices over time", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    await t.run(async (ctx) => {
      // N1 — resolved(cover_committed, CO-1)
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row8-N1",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-03-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 306_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-03-10T09:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "cover_committed",
          resolvedAt: "2026-03-20T09:00:00-03:00",
          resolvedByUserId: userId,
          coverOperationPublicId: "CO-1",
        },
      });
      // N2 — resolved(tenant_cured)
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row8-N2",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-04-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 306_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-04-10T09:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "tenant_cured",
          resolvedAt: "2026-04-20T09:00:00-03:00",
          resolvedByUserId: userId,
        },
      });
      // N3 — resolved(cover_committed, CO-2)
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row8-N3",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-05-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 306_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-05-10T09:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "cover_committed",
          resolvedAt: "2026-05-20T09:00:00-03:00",
          resolvedByUserId: userId,
          coverOperationPublicId: "CO-2",
        },
      });
      // N4 — open
      await ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row8-N4",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      });
    });

    const chronology = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) => q.eq("contractId", contractId))
        .collect(),
    );
    expect(chronology.map((r) => r.publicId)).toEqual([
      "DN-row8-N1",
      "DN-row8-N2",
      "DN-row8-N3",
      "DN-row8-N4",
    ]);
    expect(chronology[0].resolution?.kind).toBe("cover_committed");
    expect(chronology[0].resolution?.coverOperationPublicId).toBe("CO-1");
    expect(chronology[1].resolution?.kind).toBe("tenant_cured");
    expect(chronology[2].resolution?.kind).toBe("cover_committed");
    expect(chronology[2].resolution?.coverOperationPublicId).toBe("CO-2");
    expect(chronology[3].status).toBe("open");

    const openOnly = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", "open"))
        .collect(),
    );
    expect(openOnly.length).toBe(1);
    expect(openOnly[0].publicId).toBe("DN-row8-N4");
  });

  test("row 12 tenant abandonment — an open notice persists after we simulate the contract closing", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-row12",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    // Close the contract. `encerrado` is the terminal status per contractStatus.
    await t.run((ctx) =>
      ctx.db.patch(contractId, { status: "encerrado", deactivatedAt: "2026-06-15" }),
    );

    const stillOpen = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", "open"))
        .collect(),
    );
    expect(stillOpen.length).toBe(1);
    expect(stillOpen[0]._id).toBe(noticeId);

    const contract = await t.run((ctx) => ctx.db.get(contractId));
    expect(contract?.status).toBe("encerrado");
  });
});

// ---------------------------------------------------------------------------
// resolution cause coverage — end-to-end flows for every NOTICE_RESOLUTION_KIND
// ---------------------------------------------------------------------------

describe("resolution cause coverage — each NOTICE_RESOLUTION_KIND has a documented end-to-end flow", () => {
  test("staff_dispute — an open notice resolves via staff_dispute with a staff user as resolvedByUserId", async () => {
    const t = setup();
    const { userId: agencyOwnerId, agencyId, contractId } = await makeFixture(t);
    const staffUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "user-staff-dispute",
        name: "Mutav Staff Dispute Reviewer",
        email: "dispute@mutav.finance",
        createdAt: "2024-01-01T00:00:00-03:00",
      }),
    );

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-staffdispute",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: agencyOwnerId,
      }),
    );

    const guard = await guardedPatch(t, noticeId, "open", "resolved", {
      status: "resolved",
      resolution: {
        kind: "staff_dispute",
        resolvedAt: "2026-06-20T09:00:00-03:00",
        resolvedByUserId: staffUserId,
        note: "Tenant provided proof of payment; agency claim rejected.",
      },
    });
    expect(guard.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("staff_dispute");
    expect(row?.resolution?.resolvedByUserId).toBe(staffUserId);
    expect(row?.resolution?.resolvedByUserId).not.toBe(row?.openedByUserId);
    expect(row?.resolution?.coverOperationPublicId).toBeUndefined();
  });

  test("stale resolution — an aged open notice resolves via stale with no coverOperationPublicId", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-stale",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2024-01-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2024-01-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const guard = await guardedPatch(t, noticeId, "open", "resolved", {
      status: "resolved",
      resolution: {
        kind: "stale",
        resolvedAt: "2026-06-01T09:00:00-03:00",
        resolvedByUserId: userId,
        note: "Contract closed 18 months ago; no follow-up possible.",
      },
    });
    expect(guard.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("stale");
    expect(row?.resolution?.coverOperationPublicId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cancellation cause coverage
// ---------------------------------------------------------------------------

describe("cancellation cause coverage — each NOTICE_CANCELLATION_REASON is a real end-to-end flow", () => {
  test("agency_withdrew — open notice cancels with agency_withdrew and preserves the withdrawer identity", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-cancel-aw",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const guard = await guardedPatch(t, noticeId, "open", "canceled", {
      status: "canceled",
      cancellation: {
        reason: "agency_withdrew",
        canceledAt: "2026-06-11T09:00:00-03:00",
        canceledByUserId: userId,
        note: "Descobrimos que o pagamento havia sido feito.",
      },
    });
    expect(guard.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("canceled");
    expect(row?.cancellation?.reason).toBe("agency_withdrew");
    expect(row?.cancellation?.canceledByUserId).toBe(userId);
    expect(row?.resolution).toBeUndefined();
  });

  test("staff_dismissed — a distinct canceledByUserId can be recorded, encoding the staff-vs-agency distinction", async () => {
    const t = setup();
    const { userId: agencyOwnerId, agencyId, contractId } = await makeFixture(t);
    const staffUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "user-staff-1",
        name: "Mutav Staff",
        email: "staff@mutav.finance",
        createdAt: "2024-01-01T00:00:00-03:00",
      }),
    );

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-cancel-sd",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: agencyOwnerId,
      }),
    );

    const guard = await guardedPatch(t, noticeId, "open", "canceled", {
      status: "canceled",
      cancellation: {
        reason: "staff_dismissed",
        canceledAt: "2026-06-12T09:00:00-03:00",
        canceledByUserId: staffUserId,
        note: "Notice lacks the required evidence attachment.",
      },
    });
    expect(guard.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("canceled");
    expect(row?.cancellation?.reason).toBe("staff_dismissed");
    expect(row?.cancellation?.canceledByUserId).toBe(staffUserId);
    expect(row?.openedByUserId).toBe(agencyOwnerId);
    expect(row?.cancellation?.canceledByUserId).not.toBe(row?.openedByUserId);
  });

  test("duplicate — a second notice for the same rentDueDate cancels with reason='duplicate' while the original stays open", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    // Original — filed first, stays open.
    const originalId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-dup-original",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    // Duplicate — same contract, same rentDueDate, filed shortly after.
    const duplicateId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-dup-second",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T11:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const guard = await guardedPatch(t, duplicateId, "open", "canceled", {
      status: "canceled",
      cancellation: {
        reason: "duplicate",
        canceledAt: "2026-06-10T12:00:00-03:00",
        canceledByUserId: userId,
        note: "Duplicate of DN-dup-original — same contract, same rentDueDate.",
      },
    });
    expect(guard.success).toBe(true);

    const original = await t.run((ctx) => ctx.db.get(originalId));
    const duplicate = await t.run((ctx) => ctx.db.get(duplicateId));
    expect(original?.status).toBe("open");
    expect(duplicate?.status).toBe("canceled");
    expect(duplicate?.cancellation?.reason).toBe("duplicate");

    // Both rows are queryable by the same rentDueDate on the composite index.
    const forDueDate = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) =>
          q.eq("contractId", contractId).eq("rentDueDate", "2026-06-05"),
        )
        .collect(),
    );
    expect(forDueDate.length).toBe(2);
  });

  test("data_error — a notice cancels with reason='data_error' and a replacement notice opens on the same contract", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    // Wrong-data notice: originalAmountCents was mis-entered (e.g. missing a zero).
    const badNoticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-de-bad",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 30_000, // typo — should have been 300_000
        updatedAmountCents: 30_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    const cancelGuard = await guardedPatch(t, badNoticeId, "open", "canceled", {
      status: "canceled",
      cancellation: {
        reason: "data_error",
        canceledAt: "2026-06-10T09:30:00-03:00",
        canceledByUserId: userId,
        note: "Typo em originalAmountCents; abrindo notice corrigido.",
      },
    });
    expect(cancelGuard.success).toBe(true);

    // Replacement notice, correct amount, same rentDueDate.
    const goodNoticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-de-good",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:35:00-03:00",
        openedByUserId: userId,
      }),
    );

    const bad = await t.run((ctx) => ctx.db.get(badNoticeId));
    const good = await t.run((ctx) => ctx.db.get(goodNoticeId));
    expect(bad?.status).toBe("canceled");
    expect(bad?.cancellation?.reason).toBe("data_error");
    expect(good?.status).toBe("open");
    expect(good?.originalAmountCents).toBe(300_000);

    // Audit trail: both rows survive so the correction is traceable.
    const trail = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_contract_dueDate", (q) =>
          q.eq("contractId", contractId).eq("rentDueDate", "2026-06-05"),
        )
        .collect(),
    );
    expect(trail.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// composition — machine guard + db.patch
// ---------------------------------------------------------------------------

describe("composition — assertTransition gates the write, so terminal / self-transition attempts do not touch the row", () => {
  test("an already-resolved notice cannot be transitioned again — guardedPatch skips the write and the row is preserved", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-terminal-res",
        contractId,
        agencyId,
        status: "resolved",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
        resolution: {
          kind: "tenant_cured",
          resolvedAt: "2026-06-15T09:00:00-03:00",
          resolvedByUserId: userId,
        },
      }),
    );

    // Attempt to cancel a resolved row through the same conditional the
    // mutation layer will use. The guard MUST block; the row MUST NOT flip.
    const guard = await guardedPatch(t, noticeId, "resolved", "canceled", {
      status: "canceled",
      cancellation: {
        reason: "staff_dismissed",
        canceledAt: "2026-06-20T09:00:00-03:00",
        canceledByUserId: userId,
      },
    });
    expect(guard.success).toBe(false);
    if (!guard.success) {
      expect(guard.error.code).toBe("TERMINAL_STATE");
    }

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("tenant_cured");
    expect(row?.cancellation).toBeUndefined();
  });

  test("an already-canceled notice cannot be transitioned again — TERMINAL_STATE protects the other terminal too", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-terminal-can",
        contractId,
        agencyId,
        status: "canceled",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
        cancellation: {
          reason: "agency_withdrew",
          canceledAt: "2026-06-11T09:00:00-03:00",
          canceledByUserId: userId,
        },
      }),
    );

    // Try to "un-cancel" by resolving. Guard must block symmetrically.
    const guard = await guardedPatch(t, noticeId, "canceled", "resolved", {
      status: "resolved",
      resolution: {
        kind: "tenant_cured",
        resolvedAt: "2026-06-20T09:00:00-03:00",
        resolvedByUserId: userId,
      },
    });
    expect(guard.success).toBe(false);
    if (!guard.success) {
      expect(guard.error.code).toBe("TERMINAL_STATE");
    }

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("canceled");
    expect(row?.cancellation?.reason).toBe("agency_withdrew");
    expect(row?.resolution).toBeUndefined();
  });

  test("self-transition guard — assertTransition(open, open) rejects with SELF_TRANSITION and the row is not touched", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-self-open",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    // A bug-shaped patch that would try to "re-open" an open row. If the
    // guard didn't block, updatedAmountCents would be overwritten.
    const guard = await guardedPatch(t, noticeId, "open", "open", {
      status: "open",
      updatedAmountCents: 999_999,
    });
    expect(guard.success).toBe(false);
    if (!guard.success) {
      expect(guard.error.code).toBe("SELF_TRANSITION");
    }

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("open");
    expect(row?.updatedAmountCents).toBe(300_000);
  });

  test("an open notice is patched WHEN AND ONLY WHEN assertTransition returns success — happy path via the same conditional", async () => {
    const t = setup();
    const { userId, agencyId, contractId } = await makeFixture(t);

    const noticeId = await t.run((ctx) =>
      ctx.db.insert("contractDelinquencyNotices", {
        publicId: "DN-happy",
        contractId,
        agencyId,
        status: "open",
        rentDueDate: "2026-06-05",
        originalAmountCents: 300_000,
        updatedAmountCents: 300_000,
        evidenceSource: "agency_reported",
        openedAt: "2026-06-10T09:00:00-03:00",
        openedByUserId: userId,
      }),
    );

    // Same guardedPatch helper the negative tests use. If it stops running
    // the write, this test breaks — that mirrors what would happen if a
    // regression removed the conditional.
    const guard = await guardedPatch(t, noticeId, "open", "resolved", {
      status: "resolved",
      resolution: {
        kind: "tenant_cured",
        resolvedAt: "2026-06-15T09:00:00-03:00",
        resolvedByUserId: userId,
      },
    });
    expect(guard.success).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(noticeId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolution?.kind).toBe("tenant_cured");
  });
});

// ---------------------------------------------------------------------------
// seed integration
// ---------------------------------------------------------------------------

describe("seed integration — the seeded delinquency book matches the scenario doc's realistic shape", () => {
  test("seedReset populates the agencyowner's agency with the expected notice mix (2 open + 1 resolved-tenant_cured), and resolvedByUserId points to a live user row", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const aprovada = await t.run(async (ctx) => {
      const rows = await ctx.db.query("agencies").collect();
      return rows.find((a) => a.name === "Imobiliária Aprovada") ?? null;
    });
    expect(aprovada).not.toBeNull();
    if (!aprovada) return;

    const openRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", aprovada._id).eq("status", "open"))
        .collect(),
    );
    const resolvedRows = await t.run((ctx) =>
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) =>
          q.eq("agencyId", aprovada._id).eq("status", "resolved"),
        )
        .collect(),
    );

    expect(openRows.length).toBe(2);
    expect(resolvedRows.length).toBe(1);
    expect(resolvedRows[0].resolution?.kind).toBe("tenant_cured");
    for (const r of [...openRows, ...resolvedRows]) {
      expect(r.publicId.startsWith("DN-")).toBe(true);
    }

    // No dangling FKs — resolvedByUserId and openedByUserId must resolve to
    // real seeded users. A regression that dropped the resolvedByUserId to a
    // stale id (or forgot to reseed the user) would fail this.
    const resolved = resolvedRows[0];
    const resolution = resolved.resolution;
    if (!resolution) {
      throw new Error("Expected resolved notice to have a resolution envelope, got null.");
    }
    const resolver = await t.run((ctx) => ctx.db.get(resolution.resolvedByUserId));
    expect(resolver).not.toBeNull();
    const opener = await t.run((ctx) => ctx.db.get(resolved.openedByUserId));
    expect(opener).not.toBeNull();
  });
});
