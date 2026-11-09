import { describe, expect, test } from "vitest";
import {
  buildDocumentRejectedEmail,
  buildProposalEmail,
  buildProposalWhatsApp,
  type ProposalNotice,
} from "./notifications";

const APP_URL = "https://app.mutav.test";

function expectBrandedShell(html: string) {
  expect(html).toContain('src="https://app.mutav.test/email/mutav-lockup.png"');
  expect(html).toContain('alt="MUTAV"');
  expect(html).not.toMatch(/>mutav<\/span>/i);
  expect(html).toContain("MUTAV · Garantia locatícia");
  expect(html).toContain('href="mailto:contato@mutav.finance"');
  expect(html).toContain("Você recebeu este e-mail porque");
}

const NOTICE: ProposalNotice = {
  publicId: "1000042",
  tenantName: "Ana <Souza>",
  agencyName: "Imobiliária Centro",
  rentCents: 250_000,
  feeCents: 22_500,
  coverageCents: 3_750_000,
};

const NBSP = " ";

describe("buildProposalEmail", () => {
  const email = buildProposalEmail(NOTICE, { appUrl: APP_URL });

  test("renders inside the branded shell", () => {
    expectBrandedShell(email.html);
  });

  test("links nowhere but support: no agency-app page, no button", () => {
    const hrefs = [...email.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["mailto:contato@mutav.finance"]);
    expect(email.html).not.toContain("/guarantees/");
    expect(email.html).not.toContain('bgcolor="#c47e10"');
  });

  test("names the agency and the guarantee in the subject", () => {
    expect(email.subject).toBe("Garantia locatícia solicitada pela Imobiliária Centro — 1000042");
  });

  test("carries the key data formatted as BRL", () => {
    expect(email.html).toContain(`R$${NBSP}2.500,00`);
    expect(email.html).toContain(`R$${NBSP}225,00`);
    expect(email.html).toContain(`até R$${NBSP}37.500,00`);
    expect(email.html).toContain("1000042");
  });

  test("says the agency will reach out to sign, with no tenant action", () => {
    expect(email.html).toContain("Você não precisa fazer nada agora");
    expect(email.html).toContain("A imobiliária vai entrar em contato");
    expect(email.html).not.toContain("Assinar minha garantia");
  });

  test("escapes the tenant name", () => {
    expect(email.html).toContain("Ana &lt;Souza&gt;");
    expect(email.html).not.toContain("Ana <Souza>");
  });
});

describe("buildDocumentRejectedEmail", () => {
  const email = buildDocumentRejectedEmail(
    {
      guaranteePublicId: "1000042",
      documentKey: "inspection",
      rejectionReason: "Foto <ilegível>",
    },
    { appUrl: APP_URL },
  );

  test("renders inside the branded shell", () => {
    expectBrandedShell(email.html);
  });

  test("names the document and guarantee, with the escaped reason", () => {
    expect(email.subject).toBe("Documento recusado — garantia 1000042");
    expect(email.html).toContain("<strong>Vistoria</strong>");
    expect(email.html).toContain("recusado pela equipe MUTAV");
    expect(email.html).toContain("Foto &lt;ilegível&gt;");
    expect(email.html).not.toContain("Foto <ilegível>");
  });

  test("links to the guarantee page", () => {
    expect(email.html).toContain('href="https://app.mutav.test/guarantees/1000042"');
    expect(email.html).toContain("Abrir a garantia");
  });
});

describe("buildProposalWhatsApp", () => {
  const message = buildProposalWhatsApp(NOTICE);

  test("has no link", () => {
    expect(message).not.toMatch(/https?:\/\//);
    expect(message).not.toContain("/guarantees/");
  });

  test("names the agency and says it will reach out", () => {
    expect(message).toContain("*Imobiliária Centro*");
    expect(message).toContain("a imobiliária vai entrar em contato");
  });
});
