export type RentMultiplier = "20x" | "30x" | "40x";
export type ExitCostMultiplier = "3x" | "5x" | "7x";
export type ScoreTier = "bom" | "regular" | "ruim";

export type WizardData = {
  propertyKind: "residencial" | "comercial" | "";
  cep: string;
  streetAndNumber: string;
  neighborhood: string;
  cityUF: string;
  complement: string;
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  fullName: string;
  cpf: string;
  birthDate: string;
  email: string;
  phone: string;
  score: number | null;
  scoreTier: ScoreTier | null;
  rentMultiplier: RentMultiplier | "";
  exitCostMultiplier: ExitCostMultiplier | "";
};

export type WizardState = {
  step: 1 | 2 | 3;
  data: WizardData;
};

export type WizardAction =
  | { type: "PATCH"; patch: Partial<WizardData> }
  | { type: "GO_TO"; step: 1 | 2 | 3 };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "PATCH":
      return { ...state, data: { ...state.data, ...action.patch } };
    case "GO_TO":
      return { ...state, step: action.step };
  }
}

export const INITIAL_WIZARD_DATA: WizardData = {
  propertyKind: "",
  cep: "",
  streetAndNumber: "",
  neighborhood: "",
  cityUF: "",
  complement: "",
  rentCents: 0,
  condoCents: 0,
  otherFeesCents: 0,
  fullName: "",
  cpf: "",
  birthDate: "",
  email: "",
  phone: "",
  score: null,
  scoreTier: null,
  rentMultiplier: "",
  exitCostMultiplier: "",
};

const COVERAGE_MULT: Record<RentMultiplier, number> = { "20x": 1.0, "30x": 1.35, "40x": 1.75 };
const EXIT_MULT: Record<ExitCostMultiplier, number> = { "3x": 1.0, "5x": 1.25, "7x": 1.55 };
const RENT_MULT_VALUE: Record<RentMultiplier, number> = { "20x": 20, "30x": 30, "40x": 40 };

export function calcFeePreview(
  rentCents: number,
  score: number,
  rentMultiplier: RentMultiplier,
  exitCostMultiplier: ExitCostMultiplier,
) {
  const scoreFactor = score >= 700 ? 0.9 : score >= 500 ? 1.0 : 1.3;
  const feeCents = Math.round(
    rentCents * 0.08 * COVERAGE_MULT[rentMultiplier] * EXIT_MULT[exitCostMultiplier] * scoreFactor,
  );
  return {
    feeCents,
    oneTimeActivationFeeCents: feeCents * 2,
    availableGuaranteeCents: rentCents * RENT_MULT_VALUE[rentMultiplier],
  };
}

export function formatBRLCentsDisplay(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function parseBRLInput(raw: string): number {
  const clean = raw.replace(/[^\d,]/g, "").replace(",", ".");
  const reais = parseFloat(clean);
  return isNaN(reais) ? 0 : Math.round(reais * 100);
}

export function isValidCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  let s1 = 0;
  for (let i = 0; i < 9; i++) s1 += (d[i] ?? 0) * (10 - i);
  const c1 = s1 % 11 < 2 ? 0 : 11 - (s1 % 11);
  if (c1 !== d[9]) return false;
  let s2 = 0;
  for (let i = 0; i < 10; i++) s2 += (d[i] ?? 0) * (11 - i);
  const c2 = s2 % 11 < 2 ? 0 : 11 - (s2 % 11);
  return c2 === d[10];
}
