import type { ScoreTier } from "@convex/contracts/domain";

export type WizardData = {
  entityType: "pf" | "pj" | "";
  propertyKind: "residencial" | "comercial" | "";
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

export type WizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  data: WizardData;
  publicId?: string;
};

export type WizardAction =
  | { type: "PATCH"; patch: Partial<WizardData> }
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

export const INITIAL_WIZARD_DATA: WizardData = {
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
