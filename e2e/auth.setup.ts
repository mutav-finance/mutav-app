import { test as setup, expect, type Page } from "@playwright/test";
import { ADMIN_URL, AGENCY_STATE, AGENCY_URL, STAFF_STATE } from "./personas";

/**
 * Signs each persona in once through Auth0 Universal Login and saves the
 * session, so the journeys start already authenticated. Personas and their
 * seeded state: docs/test-personas.md. The password comes from the
 * environment, never from the repo.
 */
function personaPassword(): string {
  const password = process.env.E2E_PERSONA_PASSWORD;
  if (!password) throw new Error("Set E2E_PERSONA_PASSWORD to the dev-tenant persona password.");
  return password;
}

async function signIn(page: Page, { appUrl, email }: { appUrl: string; email: string }) {
  await page.goto(`${appUrl}/auth/login`);
  await page.locator("#username").fill(email);
  await page.locator("#password").fill(personaPassword());
  await page.locator('button[type="submit"][name="action"]').first().click();
  await page.waitForURL((url) => url.origin === new URL(appUrl).origin, { timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

setup("agency owner", async ({ page }) => {
  await signIn(page, { appUrl: AGENCY_URL, email: "agencyowner@mutav.finance" });
  await page.context().storageState({ path: AGENCY_STATE });
});

setup("mutav staff", async ({ page }) => {
  await signIn(page, { appUrl: ADMIN_URL, email: "systemadmin@mutav.finance" });
  await page.context().storageState({ path: STAFF_STATE });
});
