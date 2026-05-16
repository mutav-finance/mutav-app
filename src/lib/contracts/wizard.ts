export type RentMultiplier = "24x" | "36x" | "48x";
export type ExitCostMultiplier = "3x" | "5x" | "7x";
export type ScoreTier = "bom" | "regular" | "ruim" | "negado";

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
  rentMultiplier: RentMultiplier | null;
  exitCostMultiplier: ExitCostMultiplier | null;
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
  rentMultiplier: null,
  exitCostMultiplier: null,
};

const COVERAGE_MULT: Record<RentMultiplier, number> = { "24x": 1.0, "36x": 1.05, "48x": 1.1 };
const EXIT_MULT: Record<ExitCostMultiplier, number> = { "3x": 1.0, "5x": 1.02, "7x": 1.05 };
const RENT_MULT_VALUE: Record<RentMultiplier, number> = { "24x": 24, "36x": 36, "48x": 48 };

export function calcFeePreview({
  rentCents,
  score,
  rentMultiplier,
  exitCostMultiplier,
}: {
  rentCents: number;
  score: number;
  rentMultiplier: RentMultiplier;
  exitCostMultiplier: ExitCostMultiplier;
}) {
  const feeRate = score >= 800 ? 0.075 : score >= 600 ? 0.1 : 0.125;
  const feeCents = Math.round(
    rentCents * feeRate * COVERAGE_MULT[rentMultiplier] * EXIT_MULT[exitCostMultiplier],
  );
  return {
    feeCents,
    oneTimeActivationFeeCents: 15_000,
    availableGuaranteeCents: rentCents * RENT_MULT_VALUE[rentMultiplier],
  };
}

export function lookupTenantScore(document: string): { score: number; tier: ScoreTier } {
  const digits = document.replace(/\D/g, "");
  const score = (parseInt(digits.slice(-4), 10) % 601) + 300;
  const tier: ScoreTier =
    score >= 800 ? "bom" : score >= 600 ? "regular" : score >= 400 ? "ruim" : "negado";
  return { score, tier };
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

export function isValidCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  const weight1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weight2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum1 = weight1.reduce((acc, w, i) => acc + (d[i] ?? 0) * w, 0);
  const rem1 = sum1 % 11;
  const c1 = rem1 < 2 ? 0 : 11 - rem1;
  if (c1 !== d[12]) return false;
  const sum2 = weight2.reduce((acc, w, i) => acc + (d[i] ?? 0) * w, 0);
  const rem2 = sum2 % 11;
  const c2 = rem2 < 2 ? 0 : 11 - rem2;
  return c2 === d[13];
}
