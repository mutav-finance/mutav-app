import { AGENCY_TYPE, KYB_CHECK_ITEM, isKybChecklistComplete } from "@convex/agencies/domain";
import type { AgencyType, KybCheckItem } from "@convex/agencies/domain";

/**
 * Every error code the onboarding review mutations put on the wire. An unknown
 * code falls back to `errors.unexpected` rather than echoing the server's
 * English operator sentence.
 */
export const REVIEW_ERROR_CODES = [
  "NOT_FOUND",
  "NOT_REVIEWABLE",
  "REJECTION_REASON_REQUIRED",
  "KYB_CHECKLIST_INCOMPLETE",
] as const;

export const UNEXPECTED_MESSAGE_KEY = "errors.unexpected";

const TRANSLATED_CODES: ReadonlySet<string> = new Set(REVIEW_ERROR_CODES);

export function reviewErrorMessageKey(code: string): string {
  return TRANSLATED_CODES.has(code) ? `errors.${code}` : UNEXPECTED_MESSAGE_KEY;
}

/** Approve stays disabled until every Phase-0 KYB check is ticked; the server enforces the same rule. */
export function canApprove(checks: readonly { item: KybCheckItem }[]): boolean {
  return isKybChecklistComplete(checks);
}

/** The label variant for an item: an autonomo is checked as a person, an empresa as a company. */
export function kybItemLabelKey({
  item,
  agencyType,
}: {
  item: KybCheckItem;
  agencyType: AgencyType | undefined;
}): string {
  const variant = agencyType === AGENCY_TYPE.AUTONOMO ? AGENCY_TYPE.AUTONOMO : AGENCY_TYPE.EMPRESA;
  return `kyb.items.${item}.${variant}`;
}

export const KYB_LOOKUP = {
  RECEITA_CNPJ: "receitaCnpj",
  RECEITA_CPF: "receitaCpf",
  SANCTIONS: "sanctions",
  RECLAME_AQUI: "reclameAqui",
  GOOGLE: "google",
} as const;

export type KybLookup = (typeof KYB_LOOKUP)[keyof typeof KYB_LOOKUP];

const RECEITA_CNPJ_URL =
  "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp";
const RECEITA_CPF_URL =
  "https://servicos.receita.fazenda.gov.br/servicos/cpf/consultasituacao/consultapublica.asp";
const SANCTIONS_URL = "https://portaldatransparencia.gov.br/sancoes/ceis";
const RECLAME_AQUI_SEARCH_URL = "https://www.reclameaqui.com.br/busca/";
const GOOGLE_SEARCH_URL = "https://www.google.com/search";

const digitsOnly = (value: string) => value.replace(/\D/g, "");

/**
 * Public lookups a reviewer opens next to a checklist item. Prefilled where the
 * source accepts it in the URL (Receita's CNPJ card, the search engines);
 * the CPF and sanctions consultations need a captcha or extra fields, so those
 * link to the empty form. CRECI has no single national lookup — each regional
 * council runs its own — so it gets none.
 */
export function kybLookups({
  item,
  agency,
}: {
  item: KybCheckItem;
  agency: { name: string; agencyType?: AgencyType; cnpj?: string };
}): { key: KybLookup; href: string }[] {
  switch (item) {
    case KYB_CHECK_ITEM.TAX_ID_ACTIVE:
      if (agency.agencyType === AGENCY_TYPE.AUTONOMO) {
        return [{ key: KYB_LOOKUP.RECEITA_CPF, href: RECEITA_CPF_URL }];
      }
      return [
        {
          key: KYB_LOOKUP.RECEITA_CNPJ,
          href: agency.cnpj
            ? `${RECEITA_CNPJ_URL}?${new URLSearchParams({ cnpj: digitsOnly(agency.cnpj) })}`
            : RECEITA_CNPJ_URL,
        },
      ];
    case KYB_CHECK_ITEM.SANCTIONS_PEP:
      return [{ key: KYB_LOOKUP.SANCTIONS, href: SANCTIONS_URL }];
    case KYB_CHECK_ITEM.REPUTATION:
      return [
        {
          key: KYB_LOOKUP.RECLAME_AQUI,
          href: `${RECLAME_AQUI_SEARCH_URL}?${new URLSearchParams({ q: agency.name })}`,
        },
        {
          key: KYB_LOOKUP.GOOGLE,
          href: `${GOOGLE_SEARCH_URL}?${new URLSearchParams({ q: agency.name })}`,
        },
      ];
    case KYB_CHECK_ITEM.CRECI_ACTIVE:
    case KYB_CHECK_ITEM.BANK_ACCOUNT_OWNER:
      return [];
  }
}
