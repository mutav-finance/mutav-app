// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

// Pre-Auth0: convex/lib/auth.ts resolves to a hardcoded "dev-user" row when no
// JWT identity is present. These tests seed that row before exercising the
// public mutations, mirroring the production dev-user pattern. Post-Auth0, the
// wrapper will use ctx.auth.getUserIdentity() and we'll switch to
// `t.withIdentity(...)`.

const DEV_USER_PUBLIC_ID = "dev-user";

// Real-valid checksums — the validators reject zero/all-same digit strings.
const VALID_CPF = "11144477735";
const VALID_CPF_2 = "52998224725";
const VALID_CNPJ = "11222333000181";

async function seedDevUser(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("users", {
      publicId: DEV_USER_PUBLIC_ID,
      name: "Dev User",
      email: "dev@mutav.test",
      createdAt: new Date().toISOString(),
    });
  });
}

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
    await seedDevUser(t);

    const result = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());

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
    await seedDevUser(t);

    const result = await t.mutation(api.agencies.useCases.startOnboarding, empresaArgs());

    expect(result.success).toBe(true);
    if (!result.success) return;

    const agencies = await t.run((ctx) => ctx.db.query("agencies").collect());
    expect(agencies[0].cnpj).toBe(VALID_CNPJ);
    expect(agencies[0].representanteCpf).toBe(VALID_CPF_2);
    expect(agencies[0].agencyType).toBe("empresa");
  });

  test("resumes (idempotent) when called twice with same type — no duplicate agency", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);

    const first = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = await t.mutation(
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
    await seedDevUser(t);

    const first = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(first.success).toBe(true);

    const second = await t.mutation(api.agencies.useCases.startOnboarding, empresaArgs());
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.code).toBe("AGENCY_TYPE_CONFLICT");
  });

  test("rejects invalid CPF before writing anything", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);

    const result = await t.mutation(
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
    await seedDevUser(t);

    const result = await t.mutation(
      api.agencies.useCases.startOnboarding,
      empresaArgs({ cnpj: "11111111111111" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CNPJ_INVALID");
  });

  test("ALREADY_REGISTERED blocks new registration with same CPF after another agency submitted", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);

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

    const result = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("ALREADY_REGISTERED");
  });

  test("strips CPF formatting before storage and validation", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);

    const result = await t.mutation(
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
    await seedDevUser(t);

    // Start + manually flip to submitted
    const start = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    await t.run((ctx) =>
      ctx.db.patch(agencyId, {
        onboardingState: "submitted",
        onboardingSubmittedAt: new Date().toISOString(),
      }),
    );

    const result = await t.mutation(api.agencies.useCases.submitOnboarding, { agencyId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOT_IN_PROGRESS");
  });

  test("rejects BANKING_INFO_REQUIRED when bankingInfo not saved", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);

    const start = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;

    const result = await t.mutation(api.agencies.useCases.submitOnboarding, {
      agencyId: start.data.agencyId,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("BANKING_INFO_REQUIRED");
  });

  test("rejects MISSING_DOCUMENTS for empresa when uploads incomplete", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);

    const start = await t.mutation(api.agencies.useCases.startOnboarding, empresaArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    await t.mutation(api.agencies.useCases.saveBankingInfo, {
      agencyId,
      bankingInfo: {
        bank: "Test Bank",
        branch: "0001",
        account: "12345-6",
        accountType: "corrente",
      },
    });

    const result = await t.mutation(api.agencies.useCases.submitOnboarding, { agencyId });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("MISSING_DOCUMENTS");
    if (result.error.code !== "MISSING_DOCUMENTS") return;
    expect(result.error.missing).toContain("documento_empresa");
    expect(result.error.missing).toContain("responsavel_id");
  });

  test("autonomo: full happy path → submitted", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);

    const start = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    const banking = await t.mutation(api.agencies.useCases.saveBankingInfo, {
      agencyId,
      bankingInfo: {
        bank: "Nubank",
        branch: "0001",
        account: "12345-6",
        accountType: "corrente",
      },
    });
    expect(banking.success).toBe(true);

    const submit = await t.mutation(api.agencies.useCases.submitOnboarding, { agencyId });
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
    await seedDevUser(t);

    const start = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    await t.mutation(api.agencies.useCases.saveBankingInfo, {
      agencyId,
      bankingInfo: {
        bank: "Nubank",
        branch: "0001",
        account: "12345-6",
        accountType: "corrente",
      },
    });

    await t.mutation(api.agencies.useCases.submitOnboarding, {
      agencyId,
      consentMarketing: true,
    });

    const agency = await t.run((ctx) => ctx.db.get(agencyId));
    expect(agency?.consentMarketing).toBe(true);
  });
});

describe("saveBankingInfo (agency-scope wrapper)", () => {
  test("succeeds when caller is a member of the agency", async () => {
    const t = convexTest(schema);
    await seedDevUser(t);

    const start = await t.mutation(api.agencies.useCases.startOnboarding, autonomoArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;

    const result = await t.mutation(api.agencies.useCases.saveBankingInfo, {
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
    await seedDevUser(t);

    // Create an agency that dev-user has NO membership in
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
      t.mutation(api.agencies.useCases.saveBankingInfo, {
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
    await seedDevUser(t);

    const start = await t.mutation(api.agencies.useCases.startOnboarding, empresaArgs());
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
    const result = await t.mutation(api.agencies.useCases.saveDocument, {
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
    await seedDevUser(t);

    const start = await t.mutation(api.agencies.useCases.startOnboarding, empresaArgs());
    expect(start.success).toBe(true);
    if (!start.success) return;
    const agencyId = start.data.agencyId;

    // An unrelated blob in storage
    const unrelatedStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["unrelated"])));
    const newStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["new doc"])));

    await t.mutation(api.agencies.useCases.saveDocument, {
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
