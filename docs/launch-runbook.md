# Launch runbook — first real agency

The ordered steps that take production from the demo state to accepting the first real agency. Run them top to bottom; each step says how to check it worked. The final gate is `launch/useCases:readiness` returning `ready: true`.

Scope: agency onboarding → staff approval → guarantee request → Mutav underwriting → signed contract → staff activation. Payment rails (Pix, Stellar mainnet) are out of scope and show up as readiness **warnings**, not blockers.

## 0. Before you start

- The launch PR sequence is merged and deployed to prod:
  - #371: active-agency gate and seed lock
  - the members, onboarding, underwriting, documents and activation PRs that follow it
- You have: Auth0 tenant-admin access, the Convex prod deploy key, Vercel admin on the four projects, and the team password manager.
- Nobody else is deploying.

## 1. Cut the production Auth0 tenant (#119, #206)

Production must stop trusting the dev tenant (`dev-ay46ib0hhi1mdwpw.us.auth0.com`). Its test personas share a password that is published in this repo, and one of them holds the Mutav `admin` role.

1. Create the tenant `mutav-prod` (region US, matching dev).
2. **Agency application** (Regular Web Application):
   - Callback `https://app.mutav.finance/auth/callback`
   - Logout `https://app.mutav.finance`
   - Web origin `https://app.mutav.finance`
3. **Admin application** (Regular Web Application), same URLs on `admin.mutav.finance`.
   - Restrict it to the `mutavStaff` database connection.
   - Turn on MFA (Security → Multi-factor Auth → Always) and apply it to this application.
4. Database connections:
   - Agencies: sign-up enabled, email verification on.
   - `mutavStaff`: sign-up **disabled**. Create each staff user by hand.
5. Optional: a Management API machine-to-machine app. Only `convex/smoke/auth0Mgmt.ts` uses it today.
6. Copy each app's domain, client id and client secret straight into the password manager.

Check: signing in at `https://app.mutav.finance` shows the `mutav-prod` universal login, not the dev one.

## 2. Generate the production keys

```bash
scripts/launch-secrets.sh generate
```

This writes `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` and `MUTAV_STELLAR_SECRET_ENCRYPTION_KEY` to a mode-600 file under `~/.mutav-launch/`. **Put that file's contents in the password manager before going further.** A lost PII key cannot be recovered (`docs/architecture/security.md` § Key management lifecycle). Never reuse a dev or preview key in prod.

## 3. Set the Convex production environment

```bash
scripts/launch-secrets.sh apply ~/.mutav-launch/prod-secrets-<stamp>.env --prod
bunx convex env set --prod AUTH0_DOMAIN <mutav-prod domain>
bunx convex env set --prod AUTH0_CLIENT_ID <agency app client id>
bunx convex env set --prod APP_URL https://app.mutav.finance
bunx convex env set --prod RESEND_API_KEY <prod key, sending domain verified>
bunx convex env set --prod RESEND_FROM_EMAIL "Mutav <no-reply@mutav.finance>"
bunx convex env set --prod SCORE_PROVIDER bigdatacorp   # or cpfcnpj, once contracted
bunx convex env set --prod BIGDATACORP_LOGIN <...>
bunx convex env set --prod BIGDATACORP_PASSWORD <...>
```

The full list and what each variable gates is `ENV_MANIFEST` in `convex/lib/env.ts`. Variables marked `launch` block readiness; `feature` variables switch a single feature on.

**Rotate, don't copy.** Every prod credential is freshly issued for prod: Resend, the bureau, Auth0. Revoke any key that was ever pasted into chat, a ticket or a preview environment.

## 4. Set the Vercel production environment

Set these in each project's **Production** scope only:

| Project | Variables                                                                                                                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agency  | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (`openssl rand -hex 32`), `APP_BASE_URL`, `NEXT_PUBLIC_AUTH0_DOMAIN`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PAY_URL`, `NEXT_PUBLIC_ADMIN_URL`, `CONVEX_DEPLOY_KEY` (prod) |
| admin   | The same Auth0 set, using the **admin** app's client and its own `AUTH0_SECRET`, plus `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_AGENCY_URL`                                                                                                            |
| pay     | `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_APP_URL`                                                                                                                                                                                                                            |
| fund    | `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_APP_URL`                                                                                                                                                                                                                            |

Leave `NEXT_PUBLIC_SHOW_TESTANCHOR` **unset** in production.

## 5. Deploy

Merge to `main`. The agency project's build runs `scripts/vercel-build-agency.sh` (verify key → `convex deploy` → migrations). The preview-only seed step skips itself in production.

## 6. Lock the deployment for real data

```bash
bunx convex run --prod seed:lockForRealData '{"confirm":"LOCK"}'
```

This:

- clears the demo dataset (waitlist, audit chain and credit records are kept);
- removes the seeded `systemadmin` staff grant;
- keeps the default product;
- turns off `seedReset` and `seedTestPersonas` on prod for good.

It refuses to run twice. Check that it returns `staffGrantsRemoved ≥ 1` and `product: "mutav-fianca"`.

From here on, schema changes ship as in-place migrations, not reseeds (`convex/migrations.ts` header, `CLAUDE.md` § Schema changes).

## 7. Bootstrap the first staff admin

1. The person signs in once at `https://admin.mutav.finance` with their `mutavStaff` account and MFA.
2. Copy their Auth0 `user_id` from the Auth0 dashboard.
3. Run:

```bash
bunx convex run --prod mutavStaff/useCases:bootstrapFirstAdmin '{"auth0Sub":"auth0|...","email":"..."}'
```

Grant every other staff role from the admin panel, so each grant is audited.

## 8. Readiness gate

```bash
bunx convex run --prod launch/useCases:readiness
```

You need `"ready": true`. Each blocker names its fix: `ENV_MISSING`, `DEV_AUTH0_TENANT`, `MOCK_CREDIT_SCORE`, `DEPLOYMENT_NOT_LOCKED`, `NO_STAFF_ADMIN`, `NO_DEFAULT_PRODUCT`. The report prints variable names only, never values.

## 9. Rehearse, then onboard

Rehearse the whole flow on a **preview** deployment first, with the test personas. Don't use prod: every row created there after the lock is real data.

1. Agency signs up, completes KYB and submits.
2. Staff open the submission (it moves to `under_review`), check the documents and approve. The agency receives the email.
3. The agency owner invites a colleague, who accepts.
4. The agency drafts a guarantee and requests Mutav's analysis.
5. Staff accept and set the fee %, or refuse with a reason.
6. Staff mark the contract as sent for signature.
7. The agency or staff upload the signed contract, and staff approve it.
8. Staff activate the guarantee. It shows as active on the agency dashboard.

Then onboard the real agency on prod and walk the same steps with them.

## Rollback

- **A bad deploy:** promote the previous Vercel deployment and redeploy the previous Convex functions from that commit. Data is untouched.
- **A leaked key:** rotate it at the vendor, `convex env set --prod` the new value, and revoke the old one. For `PII_ENCRYPTION_KEY` or `PII_HMAC_KEY`, do **not** rotate once real data exists without a re-encryption / re-hash migration, or the data becomes unreadable.
- **Never** run `seedReset` against prod. After step 6 it refuses anyway.
