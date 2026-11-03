import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KYB_CHECK_ITEMS } from "@convex/agencies/domain";
import {
  REVIEW_ERROR_CODES,
  UNEXPECTED_MESSAGE_KEY,
  canApprove,
  kybItemLabelKey,
  kybLookups,
  reviewErrorMessageKey,
} from "./view-model";

const MESSAGES_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../messages");

function readAdminReview(locale: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("adminReview" in parsed)) {
    throw new Error(`${locale}.json has no adminReview namespace`);
  }
  return parsed.adminReview;
}

function lookupKey(root: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((node, segment) => {
    if (typeof node !== "object" || node === null || !(segment in node)) return undefined;
    return Object.fromEntries(Object.entries(node))[segment];
  }, root);
}

const COMPANY = {
  name: "Imobiliária X",
  agencyType: "empresa",
  cnpj: "12.345.678/0001-90",
} as const;
const BROKER = { name: "Ana Corretora", agencyType: "autonomo" } as const;

describe("canApprove", () => {
  it("is true only once every item is ticked", () => {
    expect(canApprove(KYB_CHECK_ITEMS.map((item) => ({ item })))).toBe(true);
    expect(canApprove(KYB_CHECK_ITEMS.slice(1).map((item) => ({ item })))).toBe(false);
    expect(canApprove([])).toBe(false);
  });
});

describe("reviewErrorMessageKey", () => {
  it("maps a known code to its key", () => {
    expect(reviewErrorMessageKey("KYB_CHECKLIST_INCOMPLETE")).toBe(
      "errors.KYB_CHECKLIST_INCOMPLETE",
    );
  });

  it("falls back for an unknown code", () => {
    expect(reviewErrorMessageKey("SOMETHING_NEW")).toBe(UNEXPECTED_MESSAGE_KEY);
  });
});

describe("kybItemLabelKey", () => {
  it("uses the person variant for an autonomo", () => {
    expect(kybItemLabelKey({ item: "tax_id_active", agencyType: "autonomo" })).toBe(
      "kyb.items.tax_id_active.autonomo",
    );
  });

  it("uses the company variant for an empresa or an unknown type", () => {
    expect(kybItemLabelKey({ item: "tax_id_active", agencyType: "empresa" })).toBe(
      "kyb.items.tax_id_active.empresa",
    );
    expect(kybItemLabelKey({ item: "tax_id_active", agencyType: undefined })).toBe(
      "kyb.items.tax_id_active.empresa",
    );
  });
});

describe("kybLookups", () => {
  it("prefills the Receita CNPJ card with digits only", () => {
    expect(kybLookups({ item: "tax_id_active", agency: COMPANY })).toEqual([
      {
        key: "receitaCnpj",
        href: "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp?cnpj=12345678000190",
      },
    ]);
  });

  it("links an autonomo to the CPF consultation", () => {
    expect(kybLookups({ item: "tax_id_active", agency: BROKER })[0]?.key).toBe("receitaCpf");
  });

  it("searches reputation by the agency name", () => {
    expect(kybLookups({ item: "reputation", agency: COMPANY })).toEqual([
      { key: "reclameAqui", href: "https://www.reclameaqui.com.br/busca/?q=Imobili%C3%A1ria+X" },
      { key: "google", href: "https://www.google.com/search?q=Imobili%C3%A1ria+X" },
    ]);
  });

  it.each(["creci_active", "bank_account_owner"] as const)("offers no lookup for %s", (item) => {
    expect(kybLookups({ item, agency: COMPANY })).toEqual([]);
  });
});

describe.each(["pt-BR", "en"])("adminReview messages in %s", (locale) => {
  const namespace = readAdminReview(locale);

  it("translates every error code plus the fallback", () => {
    for (const code of REVIEW_ERROR_CODES) {
      expect(typeof lookupKey(namespace, reviewErrorMessageKey(code))).toBe("string");
    }
    expect(typeof lookupKey(namespace, UNEXPECTED_MESSAGE_KEY)).toBe("string");
  });

  it("labels every checklist item for both agency types", () => {
    for (const item of KYB_CHECK_ITEMS) {
      for (const agencyType of ["empresa", "autonomo"] as const) {
        expect(typeof lookupKey(namespace, kybItemLabelKey({ item, agencyType }))).toBe("string");
      }
    }
  });

  it("names every lookup link", () => {
    const keys = KYB_CHECK_ITEMS.flatMap((item) =>
      [COMPANY, BROKER].flatMap((agency) => kybLookups({ item, agency })),
    ).map((lookup) => lookup.key);
    for (const key of keys) {
      expect(typeof lookupKey(namespace, `kyb.lookups.${key}`)).toBe("string");
    }
  });
});
