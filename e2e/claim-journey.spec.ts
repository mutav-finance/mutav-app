import { test, expect, type Browser, type Page } from "@playwright/test";
import { ADMIN_URL, AGENCY_STATE, AGENCY_URL, STAFF_STATE } from "./personas";

/**
 * The claim journey in the real apps, the browser twin of
 * convex/delinquencies/claimJourney.test.ts: the agency reports a month,
 * gets the signed contract approved, files the claim, answers a staff
 * request, and sees the payout — with the status checked on screen at every
 * hand-off. Starts from `bun run seed`; reports a month on whichever seeded
 * guarantee the picker lists first.
 */

const PDF = "e2e/fixtures/evidence.pdf";

async function asPersona(browser: Browser, storageState: string): Promise<Page> {
  const context = await browser.newContext({ storageState });
  return context.newPage();
}

function sheet(page: Page) {
  return page.getByRole("dialog");
}

async function expectCaseStatus(page: Page, label: string) {
  await expect(sheet(page).getByText(label, { exact: true }).first()).toBeVisible();
}

test("late rent to payout across the agency and admin apps", async ({ browser }) => {
  const agency = await asPersona(browser, AGENCY_STATE);
  const staff = await asPersona(browser, STAFF_STATE);

  // 1. Report late rent from the queue, picking the guarantee by tenant.
  await agency.goto(`${AGENCY_URL}/claims`);
  await agency.getByRole("button", { name: "Informar atraso" }).click();
  await expect(sheet(agency).getByText("Qual garantia?")).toBeVisible();
  await sheet(agency).locator("ul li button").first().click();

  // Three months back is overdue and past the grace period on any seeded lease.
  await sheet(agency).getByRole("combobox").click();
  await agency.getByRole("option").nth(2).click();
  await sheet(agency).getByRole("button", { name: "Informar atraso" }).click();

  // The report hands over to the new case.
  await agency.waitForURL(/[?&]case=DN-/);
  const casePublicId = new URL(agency.url()).searchParams.get("case");
  expect(casePublicId).toBeTruthy();
  await expectCaseStatus(agency, "Pronto para acionar");

  // 2. The signed contract is a precondition: upload it on the guarantee page…
  await sheet(agency).getByRole("link", { name: "Ver documentos da garantia" }).click();
  await agency.getByLabel("Escolher arquivo para Contrato de locação assinado").setInputFiles(PDF);
  await expect(agency.getByText("Documento enviado para análise da Mutav.")).toBeVisible();
  const guaranteeUrl = agency.url();

  // …and staff approve it.
  await staff.goto(`${ADMIN_URL}/documents`);
  await staff.getByRole("button", { name: "Aprovar" }).first().click();

  // 3. Evidence, declaration, claim.
  await agency.goto(`${AGENCY_URL}/claims?case=${casePublicId}`);
  await sheet(agency).getByLabel("Comprovante de não pagamento").setInputFiles(PDF);
  await sheet(agency).getByLabel("Notificação ao inquilino").setInputFiles(PDF);
  await sheet(agency).getByRole("checkbox").check();
  await sheet(agency).getByRole("button", { name: "Acionar garantia" }).click();
  await expectCaseStatus(agency, "Em análise");

  // 4. Staff send the tenant notice back.
  await staff.goto(`${ADMIN_URL}/defaults`);
  const row = staff.getByRole("row").filter({ hasText: casePublicId ?? "" });
  await expect(row.getByText("Acionada — pronta para análise")).toBeVisible();
  await row.getByRole("button", { name: "Ver acionamento" }).click();
  await staff.getByRole("checkbox").nth(1).check();
  await staff.getByLabel("Motivo para Notificação ao inquilino").fill("Data ilegível.");
  await staff.getByLabel("Prazo para a imobiliária responder").fill("2099-01-01");
  await staff.getByRole("button", { name: "Pedir informação" }).click();

  // 5. The agency answers and resends.
  await agency.reload();
  await expectCaseStatus(agency, "Pendência");
  await expect(sheet(agency).getByText("Data ilegível.").first()).toBeVisible();
  await sheet(agency).getByLabel("Notificação ao inquilino").setInputFiles(PDF);
  await sheet(agency).getByRole("button", { name: "Reenviar para análise" }).click();
  await expectCaseStatus(agency, "Em análise");

  // 6. Staff confirm, commit cover and record the payout.
  await staff.reload();
  await row.getByRole("button", { name: "Confirmar" }).click();
  await row.getByRole("button", { name: "Registrar cobertura" }).click();
  await staff.getByRole("alertdialog").getByRole("button", { name: "Registrar cobertura" }).click();
  await agency.reload();
  await expectCaseStatus(agency, "Aprovado");

  const payout = staff
    .getByRole("row")
    .filter({ hasText: casePublicId ?? "" })
    .last();
  await payout.getByRole("button", { name: "Marcar pagamento executado" }).click();
  await staff.getByLabel("Referência do pagamento").fill("E2E-REF-0001");
  await staff.getByRole("button", { name: "Marcar executado" }).click();

  // 7. The agency sees it paid, on the case and on the guarantee page.
  await agency.reload();
  await expectCaseStatus(agency, "Pago");
  await expect(sheet(agency).getByText("E2E-REF-0001")).toBeVisible();
  await agency.goto(guaranteeUrl);
  await expect(agency.getByText("Aluguel e acionamentos")).toBeVisible();
});
