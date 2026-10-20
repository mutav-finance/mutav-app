import { describe, expect, test } from "vitest";
import { buildProposalEmail, buildProposalWhatsApp, type ProposalNotice } from "./notifications";

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
  const email = buildProposalEmail(NOTICE);

  test("links nowhere: no agency-app URL and no anchor at all", () => {
    expect(email.html).not.toMatch(/<a\s/i);
    expect(email.html).not.toMatch(/href=/i);
    expect(email.html).not.toContain("/guarantees/");
    expect(email.html).not.toMatch(/https?:\/\//);
  });

  test("names the agency and the guarantee in the subject", () => {
    expect(email.subject).toBe("Garantia locatícia registrada pela Imobiliária Centro — 1000042");
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
