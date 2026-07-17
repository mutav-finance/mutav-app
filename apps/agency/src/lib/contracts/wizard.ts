import {
  PROPERTY_KIND,
  TENANT_ENTITY_TYPE,
  type PropertyKind,
  type ScoreTier,
  type TenantEntityType,
} from "@convex/contracts/domain";
import { isValidCPF, isValidCNPJ } from "@mutav/i18n/brazil";
import type { Result } from "@/lib/result";

export type DraftWizardData = {
  entityType: TenantEntityType | "";
  propertyKind: PropertyKind | "";
  cpf: string;
  cnpj: string;
  cep: string;
  street: string;
  addressNumber: string;
  neighborhood: string;
  city: string;
  uf: string;
  complement: string;
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  fullName: string;
  birthDate: string;
  email: string;
  phone: string;
  score: number | null;
  scoreTier: ScoreTier | null;
};

export type ValidatedWizardTenant =
  | {
      entityType: typeof TENANT_ENTITY_TYPE.PF;
      fullName: string;
      cpf: string;
      birthDate: string;
      email: string;
      phone: string;
      score: number;
    }
  | {
      entityType: typeof TENANT_ENTITY_TYPE.PJ;
      fullName: string;
      cnpj: string;
      email: string;
      phone: string;
      score: number;
    };

export type ValidatedWizardData = {
  propertyKind: PropertyKind;
  cep: string;
  street: string;
  addressNumber: string;
  neighborhood: string;
  city: string;
  uf: string;
  complement: string;
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  tenant: ValidatedWizardTenant;
  scoreTier: ScoreTier;
};

export type WizardValidationCode =
  | "required"
  | "cpfInvalid"
  | "cnpjInvalid"
  | "cepInvalid"
  | "rentRequired"
  | "scoreRequired"
  | "emailInvalid"
  | "phoneInvalid";

export type WizardValidationError = {
  code: WizardValidationCode;
  field?: keyof DraftWizardData;
};

export function isTenantEntityType(value: string): value is TenantEntityType {
  return value === TENANT_ENTITY_TYPE.PF || value === TENANT_ENTITY_TYPE.PJ;
}

export function isPropertyKind(value: string): value is PropertyKind {
  return value === PROPERTY_KIND.RESIDENCIAL || value === PROPERTY_KIND.COMERCIAL;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CEP_LENGTH = 8;
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 11;

const REQUIRED_ADDRESS_FIELDS = ["street", "addressNumber", "neighborhood", "city", "uf"] as const;

export function validateWizard(
  draft: DraftWizardData,
): Result<ValidatedWizardData, WizardValidationError[]> {
  const errors: WizardValidationError[] = [];

  const propertyKind = isPropertyKind(draft.propertyKind) ? draft.propertyKind : null;
  if (propertyKind === null) errors.push({ code: "required", field: "propertyKind" });

  const entityType = isTenantEntityType(draft.entityType) ? draft.entityType : null;
  if (entityType === null) errors.push({ code: "required", field: "entityType" });

  const fullName = draft.fullName.trim();
  if (!fullName) errors.push({ code: "required", field: "fullName" });

  const email = draft.email.trim();
  if (!email) errors.push({ code: "required", field: "email" });
  else if (!EMAIL_PATTERN.test(email)) errors.push({ code: "emailInvalid", field: "email" });

  const phone = draft.phone.replace(/\D/g, "");
  if (!phone) errors.push({ code: "required", field: "phone" });
  else if (phone.length < PHONE_MIN_DIGITS || phone.length > PHONE_MAX_DIGITS) {
    errors.push({ code: "phoneInvalid", field: "phone" });
  }

  const cep = draft.cep.replace(/\D/g, "");
  if (cep.length !== CEP_LENGTH) errors.push({ code: "cepInvalid", field: "cep" });

  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (!draft[field].trim()) errors.push({ code: "required", field });
  }

  if (draft.rentCents <= 0) errors.push({ code: "rentRequired", field: "rentCents" });

  const score = draft.score;
  const scoreTier = draft.scoreTier;
  if (score === null || scoreTier === null) errors.push({ code: "scoreRequired", field: "score" });

  let tenant: ValidatedWizardTenant | null = null;
  if (entityType === TENANT_ENTITY_TYPE.PJ) {
    if (!isValidCNPJ(draft.cnpj)) {
      errors.push({ code: "cnpjInvalid", field: "cnpj" });
    } else if (score !== null) {
      tenant = {
        entityType: TENANT_ENTITY_TYPE.PJ,
        fullName,
        cnpj: draft.cnpj.replace(/\D/g, ""),
        email,
        phone,
        score,
      };
    }
  } else if (entityType === TENANT_ENTITY_TYPE.PF) {
    if (!isValidCPF(draft.cpf)) errors.push({ code: "cpfInvalid", field: "cpf" });
    if (!draft.birthDate) errors.push({ code: "required", field: "birthDate" });
    if (isValidCPF(draft.cpf) && draft.birthDate && score !== null) {
      tenant = {
        entityType: TENANT_ENTITY_TYPE.PF,
        fullName,
        cpf: draft.cpf.replace(/\D/g, ""),
        birthDate: draft.birthDate,
        email,
        phone,
        score,
      };
    }
  }

  if (errors.length > 0 || propertyKind === null || tenant === null || scoreTier === null) {
    return { success: false, error: errors, message: "Wizard draft failed validation" };
  }

  return {
    success: true,
    data: {
      propertyKind,
      cep,
      street: draft.street.trim(),
      addressNumber: draft.addressNumber.trim(),
      neighborhood: draft.neighborhood.trim(),
      city: draft.city.trim(),
      uf: draft.uf.trim(),
      complement: draft.complement,
      rentCents: draft.rentCents,
      condoCents: draft.condoCents,
      otherFeesCents: draft.otherFeesCents,
      tenant,
      scoreTier,
    },
    message: "Wizard draft validated",
  };
}

export type WizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  data: DraftWizardData;
  publicId?: string;
};

export type WizardAction =
  | { type: "PATCH"; patch: Partial<DraftWizardData> }
  | { type: "GO_TO"; step: 1 | 2 | 3 | 4 | 5 }
  | { type: "COMPLETE"; publicId: string }
  | { type: "RESET" };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "PATCH":
      return { ...state, data: { ...state.data, ...action.patch } };
    case "GO_TO":
      return { ...state, step: action.step };
    case "COMPLETE":
      return { ...state, step: 5, publicId: action.publicId };
    case "RESET":
      return { step: 1, data: INITIAL_WIZARD_DATA };
  }
}

export type ReviewBlockKind = "property" | "rental" | "tenant";

export type EditingState =
  | { kind: "viewing" }
  | { kind: "editing"; block: ReviewBlockKind; draft: DraftWizardData };

export const WIZARD_VIEWING: EditingState = { kind: "viewing" };

export function startBlockEdit(block: ReviewBlockKind, data: DraftWizardData): EditingState {
  return { kind: "editing", block, draft: { ...data } };
}

export function patchBlockDraft(
  state: EditingState,
  patch: Partial<DraftWizardData>,
): EditingState {
  if (state.kind !== "editing") return state;
  return { ...state, draft: { ...state.draft, ...patch } };
}

export const INITIAL_WIZARD_DATA: DraftWizardData = {
  entityType: "",
  propertyKind: "",
  cpf: "",
  cnpj: "",
  cep: "",
  street: "",
  addressNumber: "",
  neighborhood: "",
  city: "",
  uf: "",
  complement: "",
  rentCents: 0,
  condoCents: 0,
  otherFeesCents: 0,
  fullName: "",
  birthDate: "",
  email: "",
  phone: "",
  score: null,
  scoreTier: null,
};

export function parseBRLInput(raw: string): number {
  const clean = raw.replace(/[^\d,]/g, "").replace(",", ".");
  const reais = parseFloat(clean);
  return isNaN(reais) ? 0 : Math.round(reais * 100);
}

export { isValidCPF, isValidCNPJ } from "@mutav/i18n/brazil";
