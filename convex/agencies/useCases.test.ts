// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { hashPii } from "../lib/pii";
import { setupAuthenticatedUser, type SeededUserId } from "../lib/testFixtures";
import schema from "../schema";

// PII crypto keys must be present before any handler calls hashPii.
// The submitOnboarding path computes the documentHash for the CPF/CNPJ
// claim row; without these, every happy-path submit test would throw.
beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

// Real-valid checksums — the validators reject zero/all-same digit strings.
const VALID_CPF = "11144477735";
const VALID_CPF_2 = "52998224725";
const VALID_CNPJ = "11222333000181";

function autonomoArgs(overrides: Partial<Record<string, string>> = {}) {
  return {
    agencyType: "autonomo" as const,
    name: "Corretor Teste",
    email: "corretor@test.br",
    phone: "11999999999",
    creci: "CRECI-F 12345",
    cpf: VALID_CPF,
    ...overrides,
  };
}

function empresaArgs(overrides: Partial<Record<string, string>> = {}) {
  return {
    agencyType: "empresa" as const,
    name: "Imobiliária Teste",
    email: "imob@test.br",
    phone: "11988887777",
    creci: "CRECI-J 12345",
    cnpj: VALID_CNPJ,
    representanteName: "Sócio Responsável",
    representanteCpf: VALID_CPF_2,
    ...overrides,
  };
}

describe("startOnboarding", () => {
  test("creates a new autonomo agency + owner membership on first call", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const result = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.resumed).toBe(false);

    // Verify the agency + membership landed
    const agencies = await t.run((ctx) => ctx.db.query("agencies").collect());
    expect(agencies).toHaveLength(1);
    expect(agencies[0].cpf).toBe(VALID_CPF);
    expect(agencies[0].agencyType).toBe("autonomo");
    expect(agencies[0].onboardingState).toBe("in_progress");
    // Digits-only storage convention
    expect(agencies[0].phone).toBe("11999999999");

    const memberships = await t.run((ctx) => ctx.db.query("memberships").collect());
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("owner");
  });

  test("creates an empresa agency with representante fields", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const result = await asUser.mutation(api.agencies.useCases.startOnboarding, empresaArgs());

    expect(result.success).toBe(true);
    if (!result.success) return;

    const agencies = await t.run((ctx) => ctx.db.query("agencies").collect());
    expect(agencies[0].cnpj).toBe(VALID_CNPJ);
    expect(agencies[0].representanteCpf).toBe(VALID_CPF_2);
    expect(agencies[0].agencyType).toBe("empresa");
  });

  test("resumes (idempotent) when called twice with same type — no duplicate agency", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const first = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = await asUser.mutation(
      api.agencies.useCases.startOnboarding,
      autonomoArgs({ name: "Updated Name" }),
    );
    expect(second.success).toBe(true);
    if (!second.success) return;

    expect(second.data.resumed).toBe(true);
    expect(second.data.agencyId).toBe(first.data.agencyId);

    const agencies = await t.run((ctx) => ctx.db.query("agencies").collect());
    expect(agencies).toHaveLength(1);
    expect(agencies[0].name).toBe("Updated Name");
  });

  test("returns AGENCY_TYPE_CONFLICT when switching type mid-session", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const first = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(first.success).toBe(true);

    const second = await asUser.mutation(api.agencies.useCases.startOnboarding, empresaArgs());
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.code).toBe("AGENCY_TYPE_CONFLICT");
  });

  test("rejects invalid CPF before writing anything", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const result = await asUser.mutation(
      api.agencies.useCases.startOnboarding,
      autonomoArgs({ cpf: "11111111111" }), // all-same digits — fails checksum
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CPF_INVALID");

    const agencies = await t.run((ctx) => ctx.db.query("agencies").collect());
    expect(agencies).toHaveLength(0);
  });

  test("rejects invalid CNPJ before writing anything", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const result = await asUser.mutation(
      api.agencies.useCases.startOnboarding,
      empresaArgs({ cnpj: "11111111111111" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CNPJ_INVALID");
  });

  test("ALREADY_REGISTERED blocks new registration with same CPF after another agency submitted", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    // Simulate a prior submitted agency with the same CPF (different user — different membership)
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        name: "Other Agency",
        cpf: VALID_CPF,
        agencyType: "autonomo",
        onboardingState: "submitted",
        onboardingSubmittedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    });

    const result = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("ALREADY_REGISTERED");
  });

  test("strips CPF formatting before storage and validation", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const result = await asUser.mutation(
      api.agencies.useCases.startOnboarding,
      autonomoArgs({ cpf: "111.444.777-35" }),
    );
    expect(result.success).toBe(true);

    const agencies = await t.run((ctx) => ctx.db.query("agencies").collect());
    expect(agencies[0].cpf).toBe("11144477735"); // digits-only stored
  });
});

describe("submitOnboarding", () => {
  test("rejects NOT_IN_PROGRESS when agency already submitted", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    // Start + manually flip to submitted
    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    await t.run((ctx) =>
      ctx.db.patch(agencyId, {
        onboardingState: "submitted",
        onboardingSubmittedAt: new Date().toISOString(),
      }),
    );

    const result = await asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOT_IN_PROGRESS");
  });

  test("rejects BANKING_INFO_REQUIRED when bankingInfo not saved", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;

    const result = await asUser.mutation(api.agencies.useCases.submitOnboarding, {
      agencyId: start.data.agencyId,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("BANKING_INFO_REQUIRED");
  });

  test("rejects MISSING_DOCUMENTS for empresa when uploads incomplete", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, empresaArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    await asUser.mutation(api.agencies.useCases.saveBankingInfo, {
      agencyId,
      bankingInfo: {
        bank: "Test Bank",
        branch: "0001",
        account: "12345-6",
        accountType: "corrente",
      },
    });

    const result = await asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("MISSING_DOCUMENTS");
    if (result.error.code !== "MISSING_DOCUMENTS") return;
    expect(result.error.missing).toContain("documento_empresa");
    expect(result.error.missing).toContain("responsavel_id");
  });

  test("autonomo: full happy path → submitted", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    const banking = await asUser.mutation(api.agencies.useCases.saveBankingInfo, {
      agencyId,
      bankingInfo: {
        bank: "Nubank",
        branch: "0001",
        account: "12345-6",
        accountType: "corrente",
      },
    });
    expect(banking.success).toBe(true);

    const submit = await asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId });
    expect(submit.success).toBe(true);
    if (!submit.success) return;
    expect(submit.data.agencyId).toBe(agencyId);

    const agency = await t.run((ctx) => ctx.db.get(agencyId));
    expect(agency?.onboardingState).toBe("submitted");
    expect(agency?.onboardingSubmittedAt).toBeTruthy();
    expect(agency?.consentMarketing).toBe(false);
  });

  test("consentMarketing flag is persisted", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    await asUser.mutation(api.agencies.useCases.saveBankingInfo, {
      agencyId,
      bankingInfo: {
        bank: "Nubank",
        branch: "0001",
        account: "12345-6",
        accountType: "corrente",
      },
    });

    await asUser.mutation(api.agencies.useCases.submitOnboarding, {
      agencyId,
      consentMarketing: true,
    });

    const agency = await t.run((ctx) => ctx.db.get(agencyId));
    expect(agency?.consentMarketing).toBe(true);
  });

  test("inserts a claimedDocuments row carrying the HMAC, not the plaintext", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    await asUser.mutation(api.agencies.useCases.saveBankingInfo, {
      agencyId,
      bankingInfo: { bank: "Nu", branch: "1", account: "1", accountType: "corrente" },
    });
    await asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId });

    const claims = await t.run((ctx) => ctx.db.query("claimedDocuments").collect());
    expect(claims).toHaveLength(1);
    expect(claims[0].agencyId).toBe(agencyId);
    expect(claims[0].documentHash).not.toBe(VALID_CPF);
    expect(claims[0].documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(claims[0].documentHash).toBe(await hashPii(VALID_CPF));
  });

  test("ALREADY_REGISTERED when a concurrent agency claimed the same CPF first", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);

    const [agencyA, agencyB] = await Promise.all([
      seedReadyAutonomoAgency(t, userId, VALID_CPF, "Agency A"),
      seedReadyAutonomoAgency(t, userId, VALID_CPF, "Agency B"),
    ]);

    // Sequential, but the second one observes the first's claim row — same
    // semantic outcome as Convex OCC retrying the loser.
    const [resultA, resultB] = await Promise.all([
      asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId: agencyA }),
      asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId: agencyB }),
    ]);

    const successes = [resultA, resultB].filter((r) => r.success);
    const failures = [resultA, resultB].filter((r) => !r.success);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const failure = failures[0];
    if (failure.success) return;
    expect(failure.error.code).toBe("ALREADY_REGISTERED");

    const claims = await t.run((ctx) => ctx.db.query("claimedDocuments").collect());
    expect(claims).toHaveLength(1);
  });

  test("submitting twice for the same agency is idempotent at the claim layer", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedReadyAutonomoAgency(t, userId, VALID_CPF, "Solo");

    const first = await asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId });
    expect(first.success).toBe(true);

    // Manually flip back to in_progress to exercise the "same-agency" branch
    // of the claim check; in production this can't happen, but it exercises
    // the `existingClaim.agencyId === agencyId` short-circuit.
    await t.run((ctx) => ctx.db.patch(agencyId, { onboardingState: "in_progress" }));
    const second = await asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId });
    expect(second.success).toBe(true);

    const claims = await t.run((ctx) => ctx.db.query("claimedDocuments").collect());
    expect(claims).toHaveLength(1);
  });
});

describe("reviewOnboarding (claim lifecycle)", () => {
  test("rejecting frees the claim so the same CPF can re-register", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);

    const agencyA = await seedReadyAutonomoAgency(t, userId, VALID_CPF, "Agency A");
    const submitA = await asUser.mutation(api.agencies.useCases.submitOnboarding, {
      agencyId: agencyA,
    });
    expect(submitA.success).toBe(true);

    const reject = await asUser.mutation(internal.agencies.adminUseCases.reviewOnboarding, {
      agencyId: agencyA,
      decision: "rejected",
      rejectionReason: "test",
    });
    expect(reject.success).toBe(true);

    const claimsAfterReject = await t.run((ctx) => ctx.db.query("claimedDocuments").collect());
    expect(claimsAfterReject).toHaveLength(0);

    // A fresh agency claims the now-free CPF.
    const agencyB = await seedReadyAutonomoAgency(t, userId, VALID_CPF, "Agency B");
    const submitB = await asUser.mutation(api.agencies.useCases.submitOnboarding, {
      agencyId: agencyB,
    });
    expect(submitB.success).toBe(true);

    const finalClaims = await t.run((ctx) => ctx.db.query("claimedDocuments").collect());
    expect(finalClaims).toHaveLength(1);
    expect(finalClaims[0].agencyId).toBe(agencyB);
  });

  test("approving retains the claim — no other agency can take the CPF", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);

    const agencyA = await seedReadyAutonomoAgency(t, userId, VALID_CPF, "Agency A");
    await asUser.mutation(api.agencies.useCases.submitOnboarding, { agencyId: agencyA });
    const approve = await asUser.mutation(internal.agencies.adminUseCases.reviewOnboarding, {
      agencyId: agencyA,
      decision: "approved",
    });
    expect(approve.success).toBe(true);

    const claims = await t.run((ctx) => ctx.db.query("claimedDocuments").collect());
    expect(claims).toHaveLength(1);
    expect(claims[0].agencyId).toBe(agencyA);

    const agencyB = await seedReadyAutonomoAgency(t, userId, VALID_CPF, "Agency B");
    const submitB = await asUser.mutation(api.agencies.useCases.submitOnboarding, {
      agencyId: agencyB,
    });
    expect(submitB.success).toBe(false);
    if (submitB.success) return;
    expect(submitB.error.code).toBe("ALREADY_REGISTERED");
  });
});

async function seedReadyAutonomoAgency(
  t: ReturnType<typeof convexTest>,
  userId: SeededUserId,
  cpf: string,
  name: string,
) {
  return t.run(async (ctx) => {
    const agencyId = await ctx.db.insert("agencies", {
      name,
      cpf,
      email: `${name.toLowerCase().replace(/\s+/g, "")}@test.br`,
      phone: "11999999999",
      creci: "CRECI-F 12345",
      agencyType: "autonomo",
      onboardingState: "in_progress",
      createdAt: new Date().toISOString(),
      bankingInfo: { bank: "Test", branch: "0001", account: "12345-6", accountType: "corrente" },
    });
    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: "owner",
      joinedAt: new Date().toISOString(),
    });
    return agencyId;
  });
}

describe("saveBankingInfo (agency-scope wrapper)", () => {
  test("succeeds when caller is a member of the agency", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;

    const result = await asUser.mutation(api.agencies.useCases.saveBankingInfo, {
      agencyId: start.data.agencyId,
      bankingInfo: {
        bank: "Nubank",
        branch: "0001",
        account: "12345-6",
        accountType: "corrente",
      },
    });

    expect(result.success).toBe(true);
  });

  test("throws ForbiddenError when caller is not a member of the agency", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    // Create an agency that the test user has NO membership in
    const foreignAgencyId = await t.run(async (ctx) => {
      return ctx.db.insert("agencies", {
        name: "Foreign Agency",
        cnpj: VALID_CNPJ,
        agencyType: "empresa",
        onboardingState: "in_progress",
        createdAt: new Date().toISOString(),
      });
    });

    await expect(
      asUser.mutation(api.agencies.useCases.saveBankingInfo, {
        agencyId: foreignAgencyId,
        bankingInfo: {
          bank: "Attacker Bank",
          branch: "0001",
          account: "00000-0",
          accountType: "corrente",
        },
      }),
    ).rejects.toThrow(/Forbidden|not a member/i);

    // Confirm the foreign agency was NOT patched
    const agency = await t.run((ctx) => ctx.db.get(foreignAgencyId));
    expect(agency?.bankingInfo).toBeUndefined();
  });
});

describe("saveDocument", () => {
  test("replaces existing document of same kind — deletes old storage + row, inserts new", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, empresaArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    // Seed two storage blobs and a pre-existing agencyDocuments row pointing at one.
    const firstStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["original PDF"])));
    const secondStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["replacement PDF"])));

    await t.run((ctx) =>
      ctx.db.insert("agencyDocuments", {
        agencyId,
        kind: "documento_empresa",
        storageId: firstStorageId,
        fileName: "original.pdf",
        uploadedAt: new Date().toISOString(),
      }),
    );

    // Sanity — first blob exists before replace
    const beforeUrl = await t.run((ctx) => ctx.storage.getUrl(firstStorageId));
    expect(beforeUrl).toBeTruthy();

    // Replace via saveDocument with same kind, different storageId
    const result = await asUser.mutation(api.agencies.useCases.saveDocument, {
      agencyId,
      kind: "documento_empresa",
      storageId: secondStorageId,
      fileName: "replacement.pdf",
    });
    expect(result.success).toBe(true);

    // Exactly one agencyDocuments row for this (agency, kind), pointing at the new storageId
    const docs = await t.run((ctx) =>
      ctx.db
        .query("agencyDocuments")
        .withIndex("by_agency_kind", (q) =>
          q.eq("agencyId", agencyId).eq("kind", "documento_empresa"),
        )
        .collect(),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].storageId).toBe(secondStorageId);
    expect(docs[0].fileName).toBe("replacement.pdf");

    // The orphaned old blob is gone (no orphans, no leak)
    const afterUrl = await t.run((ctx) => ctx.storage.getUrl(firstStorageId));
    expect(afterUrl).toBeNull();
  });

  test("first upload of a kind does NOT delete unrelated storage", async () => {
    const t = convexTest(schema);
    const { asUser } = await setupAuthenticatedUser(t);

    const start = await asUser.mutation(api.agencies.useCases.startOnboarding, empresaArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    // An unrelated blob in storage
    const unrelatedStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["unrelated"])));
    const newStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["new doc"])));

    await asUser.mutation(api.agencies.useCases.saveDocument, {
      agencyId,
      kind: "documento_empresa",
      storageId: newStorageId,
      fileName: "doc.pdf",
    });

    // The unrelated blob is untouched
    const url = await t.run((ctx) => ctx.storage.getUrl(unrelatedStorageId));
    expect(url).toBeTruthy();
  });
});

describe("auth0OrgId index", () => {
  test("by_auth0OrgId index lookup finds an agency by its Auth0 org id", async () => {
    const t = convexTest(schema);

    const agencyId = await t.run((ctx) =>
      ctx.db.insert("agencies", {
        name: "Test Org-Backed Agency",
        cnpj: "00000000000111",
        createdAt: new Date().toISOString(),
        auth0OrgId: "org_test_123",
      }),
    );

    const found = await t.run((ctx) =>
      ctx.db
        .query("agencies")
        .withIndex("by_auth0OrgId", (q) => q.eq("auth0OrgId", "org_test_123"))
        .unique(),
    );

    expect(found?._id).toBe(agencyId);
  });

  test("an agency without auth0OrgId is not returned by the index", async () => {
    const t = convexTest(schema);

    await t.run((ctx) =>
      ctx.db.insert("agencies", {
        name: "Legacy Agency",
        cnpj: "00000000000222",
        createdAt: new Date().toISOString(),
      }),
    );

    const found = await t.run((ctx) =>
      ctx.db
        .query("agencies")
        .withIndex("by_auth0OrgId", (q) => q.eq("auth0OrgId", "org_does_not_exist"))
        .unique(),
    );

    expect(found).toBeNull();
  });
});
