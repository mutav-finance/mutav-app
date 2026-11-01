# Browser journeys (Playwright)

End-to-end checks that drive the agency and admin apps in a real browser. The
same journey runs without a browser, in seconds, in
`convex/delinquencies/claimJourney.test.ts`; these specs add the screens.

## Run locally

1. Point the apps at a deployment you can wipe, and reseed it: `bun run seed`.
   Do not run this against the shared dev deployment while others use it.
2. Start the apps: `bun run dev` (agency on :3000, admin on :3003).
3. Install the browser once: `bunx playwright install chromium`.
4. Run: `E2E_PERSONA_PASSWORD=… bun run test:e2e`.

`auth.setup.ts` signs in `agencyowner@` and `systemadmin@` through Auth0 once
and saves their sessions under `e2e/.auth/` (gitignored). Override the URLs
with `E2E_AGENCY_URL` / `E2E_ADMIN_URL`.

## In CI

Planned: on a PR label or nightly, with a Convex preview deployment per run
(`CONVEX_DEPLOY_KEY`) seeded before the specs, and the persona password as
`E2E_PERSONA_PASSWORD`. Both are repository secrets.
