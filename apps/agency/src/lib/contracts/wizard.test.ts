import { describe, expect, test } from "vitest";
import {
  isPropertyKind,
  isTenantEntityType,
  patchBlockDraft,
  startBlockEdit,
  validateWizard,
  WIZARD_VIEWING,
  type DraftWizardData,
  type ReviewBlockKind,
} from "@/lib/contracts/wizard";

const VALID_PF_DRAFT: DraftWizardData = {
  entityType: "pf",
  propertyKind: "residencial",
  cpf: "390.533.447-05",
  cnpj: "",
  cep: "01310-100",
  street: "Av. Paulista",
  addressNumber: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  uf: "SP",
  complement: "",
  rentCents: 250_000,
  condoCents: 30_000,
  otherFeesCents: 0,
  plan: "plus",
  fullName: "João Pereira",
  birthDate: "1991-03-04",
  email: "joao@example.com",
  phone: "(11) 98888-7777",
  score: 720,
  scoreTier: "regular",
};

const VALID_PJ_DRAFT: DraftWizardData = {
  ...VALID_PF_DRAFT,
  entityType: "pj",
  cpf: "",
  cnpj: "12.345.678/0001-95",
  birthDate: "",
  fullName: "Comercial Nova Ltda",
  email: "contato@nova.example.com",
};

describe("validateWizard", () => {
  test("accepts a valid pf draft and emits a digits-only pf tenant", () => {
    const result = validateWizard(VALID_PF_DRAFT);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.data.tenant.entityType).toBe("pf");
    if (result.data.tenant.entityType !== "pf") throw new Error("expected pf tenant");
    expect(result.data.tenant.cpf).toBe("39053344705");
    expect(result.data.tenant.birthDate).toBe("1991-03-04");
    expect(result.data.tenant.phone).toBe("11988887777");
    expect(result.data.cep).toBe("01310100");
    expect(result.data.propertyKind).toBe("residencial");
    expect(result.data.scoreTier).toBe("regular");
  });

  test("accepts a valid pj draft without birthDate and emits a cnpj-only tenant", () => {
    const result = validateWizard(VALID_PJ_DRAFT);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.data.tenant.entityType).toBe("pj");
    if (result.data.tenant.entityType !== "pj") throw new Error("expected pj tenant");
    expect(result.data.tenant.cnpj).toBe("12345678000195");
    expect(result.data.tenant).not.toHaveProperty("cpf");
    expect(result.data.tenant).not.toHaveProperty("birthDate");
  });

  test("rejects a pf draft whose cpf fails the checksum", () => {
    const result = validateWizard({ ...VALID_PF_DRAFT, cpf: "111.111.111-11" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContainEqual({ code: "cpfInvalid", field: "cpf" });
  });

  test("rejects a pj draft with an empty cnpj without demanding a birthDate", () => {
    const result = validateWizard({ ...VALID_PJ_DRAFT, cnpj: "" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContainEqual({ code: "cnpjInvalid", field: "cnpj" });
    expect(result.error.every((e) => e.field !== "birthDate")).toBe(true);
  });

  test("rejects a zero rent", () => {
    const result = validateWizard({ ...VALID_PF_DRAFT, rentCents: 0 });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContainEqual({ code: "rentRequired", field: "rentCents" });
  });

  test("catches a step-4 edit that corrupts a previously valid cpf", () => {
    const step1Validated = validateWizard(VALID_PF_DRAFT);
    expect(step1Validated.success).toBe(true);

    const corrupted = validateWizard({ ...VALID_PF_DRAFT, cpf: "390.533.447-00" });
    expect(corrupted.success).toBe(false);
    if (corrupted.success) throw new Error("expected failure");
    expect(corrupted.error).toContainEqual({ code: "cpfInvalid", field: "cpf" });
  });

  test("rejects a draft with no entityType selected", () => {
    const result = validateWizard({ ...VALID_PF_DRAFT, entityType: "" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContainEqual({ code: "required", field: "entityType" });
  });

  test("rejects a missing score", () => {
    const result = validateWizard({ ...VALID_PF_DRAFT, score: null, scoreTier: null });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContainEqual({ code: "scoreRequired", field: "score" });
  });

  test("rejects when no plan is selected", () => {
    const result = validateWizard({ ...VALID_PF_DRAFT, plan: null });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContainEqual({ code: "planRequired", field: "plan" });
  });
});

describe("EditingState", () => {
  test("startBlockEdit copies the full data into a distinct draft", () => {
    const state = startBlockEdit("property", VALID_PF_DRAFT);
    expect(state.kind).toBe("editing");
    if (state.kind !== "editing") throw new Error("expected editing state");
    expect(state.block).toBe("property");
    expect(state.draft).toEqual(VALID_PF_DRAFT);
    expect(state.draft).not.toBe(VALID_PF_DRAFT);
  });

  test("startBlockEdit sets the matching block discriminant for every block kind", () => {
    const blocks: ReviewBlockKind[] = ["property", "rental", "tenant"];
    for (const block of blocks) {
      const state = startBlockEdit(block, VALID_PF_DRAFT);
      if (state.kind !== "editing") throw new Error("expected editing state");
      expect(state.block).toBe(block);
    }
  });

  test("patchBlockDraft merges the patch immutably", () => {
    const state = startBlockEdit("tenant", VALID_PF_DRAFT);
    if (state.kind !== "editing") throw new Error("expected editing state");
    const before = state.draft;

    const patched = patchBlockDraft(state, { email: "novo@example.com" });
    if (patched.kind !== "editing") throw new Error("expected editing state");
    expect(patched.draft.email).toBe("novo@example.com");
    expect(patched.draft.fullName).toBe(VALID_PF_DRAFT.fullName);
    expect(before.email).toBe(VALID_PF_DRAFT.email);
  });

  test("patchBlockDraft on the viewing state is a no-op", () => {
    const result = patchBlockDraft(WIZARD_VIEWING, { email: "ignored@example.com" });
    expect(result).toEqual({ kind: "viewing" });
  });

  test("start → patch round-trip yields data with only the patched fields changed", () => {
    const state = startBlockEdit("rental", VALID_PF_DRAFT);
    const patched = patchBlockDraft(state, { rentCents: 300_000 });
    if (patched.kind !== "editing") throw new Error("expected editing state");
    expect(patched.draft).toEqual({ ...VALID_PF_DRAFT, rentCents: 300_000 });
  });
});

describe("isTenantEntityType / isPropertyKind", () => {
  test("accepts the canonical values", () => {
    expect(isTenantEntityType("pf")).toBe(true);
    expect(isTenantEntityType("pj")).toBe(true);
    expect(isPropertyKind("residencial")).toBe(true);
    expect(isPropertyKind("comercial")).toBe(true);
  });

  test("rejects sentinels and arbitrary strings", () => {
    expect(isTenantEntityType("")).toBe(false);
    expect(isTenantEntityType("px")).toBe(false);
    expect(isPropertyKind("")).toBe(false);
    expect(isPropertyKind("casa")).toBe(false);
  });
});
