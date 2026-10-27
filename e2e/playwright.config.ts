import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys across the agency and admin apps. They run against servers
 * you start yourself (`bun run dev`) on a Convex deployment that was just
 * reseeded (`bun run seed`) — never the shared dev deployment in CI, where a
 * per-run preview deployment is used instead. See e2e/README.md.
 */
export default defineConfig({
  testDir: ".",
  outputDir: "./test-results",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "journeys",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
