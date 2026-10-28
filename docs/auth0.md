# Auth0 — operating guide

How Auth0 is wired into Mutav, what to set where, and how to fix it when login breaks. Written from the code as of 2026-10-25.

- **Why Auth0:** [ADR 0009](architecture/decisions/0009-keep-auth0-for-pilot.md).
- **Vocabulary** (identity, MUTAV staff, admin app, protocol admin, operator): the chain-neutral [security baseline](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/security/baseline.md), the [Solana glossary](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/introduction/glossary.md) Authority section, and the terminology block in [`AGENTS.md`](../AGENTS.md). Auth0 is **identity only**: it proves who you are and grants nothing. Nothing here touches the protocol admin or the operator key.
- **Function wrappers and authorization rules** (`queryWithAgencyScope`, `mutavStaff` gates, Auth0 Organizations model): [`auth.md`](auth.md).
- **Dev logins:** [`test-personas.md`](test-personas.md).

> Never paste secret values into this file, issues, PRs or chat. Every value below is a placeholder.

## Architecture

```
browser ──/auth/login──▶ Auth0 Universal Login ──/auth/callback──▶ Next.js app (agency | admin)
                                                                     │ encrypted session cookie
                                                                     │ (@auth0/nextjs-auth0 v4)
browser ◀──── ID token ◀──── GET /api/auth/convex-token ─────────────┘
   │
   └──── Convex client (Authorization: Bearer <ID token>) ──▶ Convex
                                                              convex/auth.config.ts verifies
                                                              issuer + aud (= client id)
                                                              convex/lib/auth.ts resolves users / mutavStaff
```

**Which apps use Auth0.** Only `apps/agency` (`app.mutav.finance`, port 3000) and `apps/admin` (`admin.mutav.finance`, port 3003). `apps/pay` is a publicId-bearer URL and `apps/fund` is wallet-as-identity. Neither carries the Auth0 SDK ([ADR 0003](architecture/decisions/0003-persona-app-origin-isolation-single-convex.md) §2), and their CSPs don't allow Auth0 origins. Keep it that way.

**One Auth0 application backs every authenticated app** (ADR 0003, amendment of 2026-06-21). Agency and admin share the client id. The client id is the JWT `aud`, and Convex validates it with **one** provider. Admin-app access is never decided by `aud`. Convex does not surface that claim, so the staff gate is the `mutavStaff` row.

The pieces, file by file:

| Piece                  | File                                                           | What it does                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth0 client (server)  | `apps/agency/src/lib/auth0.ts`, `apps/admin/src/lib/auth0.ts`  | `new Auth0Client({...})`. The SDK reads `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` and `APP_BASE_URL` from env implicitly. `onCallback` calls Convex `users.useCases.getOrCreateByIdentity` with the fresh ID token (first-login provisioning, fails open).                                    |
| Admin session policy   | `apps/admin/src/lib/auth0.ts`                                  | Rolling session, **12 h absolute and 30 min inactivity**. Session and transaction cookies are `SameSite=Lax` + `Secure`, Host-Only (no `Domain`). Lax is load-bearing: Strict causes a login loop on the callback redirect. Callback errors redirect to `/auth/logout` (not `/auth/login`), so a broken callback can't loop. |
| Agency session policy  | `apps/agency/src/lib/auth0.ts`                                 | SDK defaults (rolling session). Callback errors redirect to `/auth/login?error=…`.                                                                                                                                                                                                                                           |
| Routes                 | `apps/*/src/proxy.ts`                                          | `auth0.middleware(request)` serves `/auth/login`, `/auth/logout`, `/auth/callback` and the session refresh. Its cookies are then folded into the next-intl response. The matcher excludes `api/auth/convex-token` and static assets.                                                                                         |
| Token bridge           | `apps/*/src/app/api/auth/convex-token/route.ts`                | Returns `{ token: session.tokenSet.idToken }`, or 401. Convex gets the **ID token**, not an access token, because the ID token's `aud` is already the client id. No Auth0 API resource is needed.                                                                                                                            |
| Convex React provider  | `packages/app-shell/src/convex-auth-provider.tsx`              | `ConvexProviderWithAuth` + `useAuthFromAuth0` (fetches the token route). If the app's `NEXT_PUBLIC_AUTH0_DOMAIN` is unset, it renders a bare `ConvexProvider` and every wrapped Convex call fails closed.                                                                                                                    |
| JWT verification       | `convex/auth.config.ts`                                        | One provider, `{ domain: https://<AUTH0_DOMAIN>, applicationID: AUTH0_CLIENT_ID }`. It registers **no** provider unless both are non-empty. `http://` is rejected.                                                                                                                                                           |
| Identity → user        | `convex/lib/auth.ts`                                           | `ctx.auth.getUserIdentity()` → `users` row by `subject` (`auth0\|…`). No row or no JWT → `UnauthenticatedError`. No fallback user.                                                                                                                                                                                           |
| Staff gate (admin app) | `apps/admin/src/lib/auth.ts` → `convex/mutavStaff/useCases.ts` | `getStaffMember()` gives `anonymous` (→ login), `not-staff` (→ bounce to agency origin) or `staff`. It fails closed when the Convex read fails.                                                                                                                                                                              |
| Management API (M2M)   | `convex/lib/auth0Mgmt.ts`                                      | Client-credentials token cache for `'use node'` actions. Separate M2M app credentials. Today only `convex/smoke/auth0Mgmt.ts` exercises it.                                                                                                                                                                                  |

## Tenants

| Tenant                                        | Serves (today)                                                                                                           | Status                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **dev** — `dev-ay46ib0hhi1mdwpw.us.auth0.com` | localhost, every Vercel preview, **and production** (`app.mutav.finance`, `admin.mutav.finance`, `mutav-app.vercel.app`) | Shared. The four test personas live here ([`test-personas.md`](test-personas.md)).         |
| **prod** — `mutav-prod` (planned)             | production only                                                                                                          | Not yet created. Tracked in [#119](https://github.com/mutav-finance/mutav-app/issues/119). |

**Production runs on the dev tenant today.** This is a known, accepted pre-launch state. The persona logins (public test password) are accepted until the prod tenant is cut and the secrets are rotated (#119). Don't re-flag it. Do treat it as a launch blocker.

Which deployment points at which tenant:

| Deployment                                         | Auth0 tenant          | Convex deployment                                                                      |
| -------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| Local `bun dev`                                    | dev                   | your personal Convex dev deployment (`CONVEX_DEPLOYMENT` in `.env.local`)              |
| Vercel Preview (`mutav-app`, `mutav-app-admin`)    | dev                   | a per-PR **Convex preview** deployment, created by `convex deploy` in the Vercel build |
| Vercel Production (`mutav-app`, `mutav-app-admin`) | dev → prod after #119 | Convex **prod** deployment                                                             |

The Vercel build (`scripts/vercel-build-agency.sh`, `apps/admin/vercel.json`) runs `scripts/verify-convex-deploy.sh` first. That script refuses to build when `VERCEL_ENV` and the `CONVEX_DEPLOY_KEY` kind don't match (production ↔ `prod:`, preview ↔ `preview:`).

## Environment variables

### Next.js apps (`apps/agency`, `apps/admin`)

| Var                        | Secret? | Used by                                                                                 | Example / placeholder                                       |
| -------------------------- | :-----: | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `AUTH0_DOMAIN`             |   no    | Auth0 SDK (server). Bare host.                                                          | `<tenant>.us.auth0.com`                                     |
| `AUTH0_CLIENT_ID`          |   no    | Auth0 SDK (server)                                                                      | `<client-id>`                                               |
| `AUTH0_CLIENT_SECRET`      | **yes** | Auth0 SDK (server), code exchange                                                       | `<client-secret>`                                           |
| `AUTH0_SECRET`             | **yes** | Auth0 SDK. Encrypts the session cookie. Per environment.                                | `openssl rand -hex 32`                                      |
| `APP_BASE_URL`             |   no    | Auth0 SDK callback base + `onCallback` redirects. **Fails the prod build if unset.**    | `https://app.mutav.finance` / `https://admin.mutav.finance` |
| `NEXT_PUBLIC_AUTH0_DOMAIN` |   no    | Switches on the Auth0-backed Convex provider in the browser bundle (build-time inlined) | `<tenant>.us.auth0.com`                                     |
| `NEXT_PUBLIC_CONVEX_URL`   |   no    | Convex client + `onCallback` provisioning                                               | injected by `convex deploy` on Vercel                       |
| `NEXT_PUBLIC_APP_URL`      |   no    | Absolute links (fails the prod build if unset)                                          | same origin as `APP_BASE_URL`                               |
| `NEXT_PUBLIC_AGENCY_URL`   |   no    | **admin only.** Where non-staff users are bounced to.                                   | `https://app.mutav.finance`                                 |
| `NEXT_PUBLIC_ADMIN_URL`    |   no    | **agency only.** Cross-app link.                                                        | `https://admin.mutav.finance`                               |

**Locally**, all of these come from the **root** `.env.local`. Each app's `next.config.ts` has a shim that reads `../../.env.local`. Copy from `.env.example`, which is the source of truth for var names.

**On Vercel**, set them per project and per environment. **Every Vercel command must target team `mutav`.** The personal scope holds none of the projects.

```bash
vercel switch mutav                      # once per shell, or pass --scope mutav on every command
vercel link --project mutav-app --scope mutav          # agency; admin is mutav-app-admin
vercel env ls --scope mutav
vercel env add AUTH0_CLIENT_SECRET production --scope mutav     # paste the value at the prompt
vercel env rm  AUTH0_CLIENT_SECRET production --scope mutav
```

Use the prompt (or the dashboard) for values. Don't put secrets on the command line, where they end up in shell history.

### Convex deployments

| Var                        | Secret? | Read by                                            | Notes                                                                                                                                                         |
| -------------------------- | :-----: | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH0_DOMAIN`             |   no    | `convex/auth.config.ts`, `convex/lib/auth0Mgmt.ts` | **Must exist on every deployment** (dev, preview, prod). Use the bare host: `auth0Mgmt` rejects a scheme prefix, while `auth.config.ts` tolerates `https://`. |
| `AUTH0_CLIENT_ID`          |   no    | `convex/auth.config.ts`                            | **Must exist on every deployment.** Same value as the apps' `AUTH0_CLIENT_ID`.                                                                                |
| `AUTH0_MGMT_CLIENT_ID`     |   no    | `convex/lib/auth0Mgmt.ts` (lazy)                   | Only where Management API actions run. M2M app, **not** the login app.                                                                                        |
| `AUTH0_MGMT_CLIENT_SECRET` | **yes** | `convex/lib/auth0Mgmt.ts` (lazy)                   | Same as above.                                                                                                                                                |

```bash
# your dev deployment: fill .env.local, then push the deployment-side vars in one go
bun run convex:env:sync                    # scripts/sync-convex-env.sh; pushes only non-empty values
bun run convex:env:sync -- --prod          # prod (careful)

# or by hand
bunx convex env set AUTH0_DOMAIN <tenant>.us.auth0.com
bunx convex env set AUTH0_CLIENT_ID <client-id>
bunx convex env set --prod AUTH0_DOMAIN <tenant>.us.auth0.com
bunx convex env list --prod                # names + values. Mind who's looking at your screen.
```

The frontend-only secrets (`AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`, `NEXT_PUBLIC_*`) are **not** pushed to Convex, and they must never be.

**Preview deployments** are created fresh per PR, so they take their values from the Convex dashboard's project-level **default environment variables for Preview**. Make sure `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` are set there too, or the preview's `convex deploy` fails.

### The deploy-time analyzer gotcha

Convex's deploy-time analyzer scans `auth.config.ts` and **everything it imports transitively** for `process.env.X`. It refuses to deploy if any referenced var is missing from the deployment. The lazy getters in `convex/lib/env.ts` (`getAuth0Domain()`) do **not** get around this, because the analyzer follows call chains. The PR #75 rollback came from exactly this.

- An **empty** value (`""`) satisfies the analyzer and registers no provider. Every authenticated call then fails closed. That's fine for a preview that isn't meant to log anyone in:
  ```bash
  bunx convex env set AUTH0_DOMAIN ""
  bunx convex env set AUTH0_CLIENT_ID ""
  ```
- A **missing** value blocks the deploy with `Environment variable AUTH0_DOMAIN is used in auth config file but its value was not set`.
- **Half-configured** (one var set, the other empty) counts as unconfigured: no provider, every call fails with `UnauthenticatedError`.
- Don't "fix" this by making the vars optional or moving the reads behind another getter. Don't import anything new into `auth.config.ts` that reads env.

## Connections and staff roles

| Connection                         | Who                               | State                                                                                                                                         |
| ---------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Username-Password-Authentication` | agency users and, today, everyone | Live on the dev tenant. The personas use it.                                                                                                  |
| `mutavStaff` (database connection) | Mutav staff                       | **Not created yet.** Self-signup off, MFA Post-Login Action, no IP allowlist ([#206](https://github.com/mutav-finance/mutav-app/issues/206)). |

The admin app does not pin a connection today (`/auth/login` carries no `connection=` parameter). Once `mutavStaff` exists, either enable only that connection on the admin login, or pass `authorizationParameters: { connection: "mutavStaff" }`. That way staff never authenticate through the agency connection.

**Staff roles live in Convex, not Auth0.** Auth0 proves identity only. Authorization is the `mutavStaff` table, one row per (user, role):

- Operational ladder `support` < `compliance` < `admin`, checked by `meetsMinRole`. `treasury` is off the ladder and is checked with `hasExactRole`.
- Wrappers: `queryWithMutavStaff` / `mutationWithMutavStaff` / `queryWithMutavRole({ minRole })` / `mutationWithMutavRole({ minRole })` in `convex/lib/auth.ts`.
- There is no claim-based provisioning. A roles claim injected by an Auth0 Action is **not** read by Convex. Every row comes from one of three paths, and each writes an audit entry:
  1. **Genesis staff admin role**, once per deployment, refused once any staff admin exists:
     ```bash
     bunx convex run mutavStaff:useCases:bootstrapFirstAdmin '{"auth0Sub":"auth0|<id>","email":"<email>"}'
     ```
  2. **Normal grants:** the `/staff` page in `apps/admin` (`createStaffRole`, staff admin role only). Revoke with `deleteStaffRole`. It refuses to remove the last staff admin.
  3. **Recovery** when no staff admin can log in: `internal.mutavStaff.useCases.grantStaffRole` via `bunx convex run`. Needs the deploy key.
- The target must have **logged in once** first, so that a `users` row with that `subject` exists. Find the subject in Auth0 → User Management → Users → `user_id`.

## Local development

1. `cp .env.example .env.local`. Fill in the dev-tenant `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` (ask the team; never commit it) and `NEXT_PUBLIC_AUTH0_DOMAIN`. Generate your own `AUTH0_SECRET` with `openssl rand -hex 32`. `APP_BASE_URL` can stay unset locally: it falls back to `http://localhost:3000` (agency) or `:3003` (admin).
2. `bunx convex dev --once`. The first run writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`, then stops on the missing Auth0 env. That's expected.
3. `bun run convex:env:sync`, then `bunx convex dev --once` again.
4. `bun run seed`, then `bun dev`. Log in at `http://localhost:3000` as a persona from [`test-personas.md`](test-personas.md). For admin, use `bun run dev:admin` (port 3003).

Full first-setup walkthrough: [`development.md`](development.md).

Only one `APP_BASE_URL` is read per process. Running agency and admin side by side works because each app's fallback port matches its dev port. If you set `APP_BASE_URL` in the root `.env.local`, both apps pick it up, and one of them gets the wrong callback base.

## Adding a new app or callback URL

1. **Auth0 dashboard → Applications → (the Mutav app) → Settings.** Add the exact origin to all three lists. No wildcards on the prod tenant.
   - Allowed Callback URLs: `https://<host>/auth/callback`
   - Allowed Logout URLs: `https://<host>` (and any `returnTo` you use)
   - Allowed Web Origins: `https://<host>`
   - For local dev: `http://localhost:<port>/auth/callback`, etc.
2. **Vercel (team `mutav`)**: set the env table above for the new project, with `APP_BASE_URL` = the new origin. Attach `<app>.mutav.finance` in that project. DNS is a wildcard, so no record is needed.
3. **App code**: copy the `lib/auth0.ts`, `proxy.ts` and `api/auth/convex-token/route.ts` trio. Feed `ConvexAuthProvider` from the app's `lib/env.ts`. Add the tenant origin to `connect-src` / `form-action` in `next.config.ts`'s CSP.
4. **Convex**: nothing. The same client id means the same provider. A **different** Auth0 application would need its own provider in `auth.config.ts`, plus env on every deployment. Don't do that without an ADR (see the ADR 0003 amendment).
5. Keep cookies Host-Only. Never add `Domain=.mutav.finance`.

## Rotating secrets

| Secret                     | How                                                                                                                                                                                               | Blast radius                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `AUTH0_CLIENT_SECRET`      | Auth0 → Applications → app → Settings → **Rotate**. Then replace it on Vercel for **both** `mutav-app` and `mutav-app-admin` (`vercel env rm` + `vercel env add … --scope mutav`), then redeploy. | Logins fail between the rotation and the redeploy. Do it in a quiet window. |
| `AUTH0_SECRET`             | `openssl rand -hex 32` → replace per project and environment, then redeploy.                                                                                                                      | Every existing session is invalidated, and users log in again.              |
| `AUTH0_MGMT_CLIENT_SECRET` | Rotate on the M2M app → `bunx convex env set [--prod] AUTH0_MGMT_CLIENT_SECRET <value>`.                                                                                                          | Management API actions fail until it's set.                                 |
| Persona passwords          | See [`test-personas.md`](test-personas.md) § Rotation procedure.                                                                                                                                  | Dev tenant only.                                                            |

Each environment gets its own `AUTH0_SECRET`. Never reuse dev values in prod. The full pre-launch rotation checklist lives in [#119](https://github.com/mutav-finance/mutav-app/issues/119).

## MFA

Target state ([#206](https://github.com/mutav-finance/mutav-app/issues/206), [ADR 0009](architecture/decisions/0009-keep-auth0-for-pilot.md)):

1. **Security → Multi-factor Auth**: enable **WebAuthn with FIDO security keys** and **WebAuthn with device biometrics** (passkeys). Keep OTP only as a fallback. Don't enable SMS or email as staff factors, because they are phishable.
2. **Actions → Library → Post-Login**: an Action that requires MFA (`api.multifactor.enable("any")`, or a WebAuthn-specific factor), deployed and added to the Login flow. #206 decided "MFA for all logins, no connection branch". At minimum it must cover the `mutavStaff` connection.
3. **Security → Attack Protection** (prod tenant): brute-force protection, breached-password detection, bot detection, suspicious-IP throttling.
4. Relax Vercel Deployment Protection on `mutav-app-admin` only **after** the connection, the MFA Action and the fail-closed staff gate are all live (#206).

## Login page branding

> **TODO:** branding is being applied to the Auth0 Universal Login (logo, colors, copy, custom domain). It will be documented here: what is configured where in the tenant, how to update it, and how it stays in sync with `brand/`.

## Troubleshooting

| Symptom                                                                                                                   | Cause → fix                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex dev` / `convex deploy`: `Environment variable AUTH0_DOMAIN is used in auth config file but its value was not set` | The var is missing on that deployment. Run `bun run convex:env:sync` (dev), use `bunx convex env set …` (prod), or set the Preview defaults in the Convex dashboard. See the analyzer gotcha above.                                                                                                                                 |
| Logged in to the app, but every Convex call throws `UnauthenticatedError`                                                 | The Convex deployment is **half-configured or empty** (`AUTH0_DOMAIN` or `AUTH0_CLIENT_ID` is `""`, so no provider is registered). Another cause is a different `AUTH0_CLIENT_ID` from the app's (`aud` mismatch), or `AUTH0_DOMAIN` pointing at another tenant (issuer mismatch). Compare `bunx convex env list` with the app env. |
| `UnauthenticatedError("not provisioned")`                                                                                 | JWT ok, but there's no `users` row. `onCallback` provisioning failed (check the server log for `[auth0.onCallback] Convex provisioning failed`). The agency client retries automatically. Otherwise log out and back in, or check `NEXT_PUBLIC_CONVEX_URL`.                                                                         |
| Convex calls are anonymous even with a session                                                                            | `NEXT_PUBLIC_AUTH0_DOMAIN` was unset **at build time**, so the bundle rendered a bare `ConvexProvider`. Set it and **rebuild**. A runtime change does nothing.                                                                                                                                                                      |
| Auth0 error page: `Callback URL mismatch`                                                                                 | `APP_BASE_URL` + `/auth/callback` is not in Allowed Callback URLs. Add the exact URL (scheme, host and port). Previews on the dev tenant need their URL pattern allowed, or login on that preview won't work.                                                                                                                       |
| `InvalidStateError` / login loop                                                                                          | A transaction or session cookie was dropped. Check that the cookies are `SameSite=Lax` (not Strict) and `Secure` over https, and that you're not mixing `localhost` and `127.0.0.1`. Clear the cookies for the origin and retry. Admin sends callback errors to `/auth/logout` on purpose, to break loops.                          |
| Admin app: signed in but bounced to the agency app                                                                        | No `mutavStaff` row for your subject (`not-staff`). Grant a role (see "Connections and staff roles").                                                                                                                                                                                                                               |
| Admin app: bounced back to login although signed in                                                                       | `getStaffMember()` resolved to `anonymous`: session decrypt failed (e.g. after an `AUTH0_SECRET` rotation, so clear the cookies) or the Convex `getMyStaff` read failed (it fails closed). Check the server logs for `[admin] …`.                                                                                                   |
| Vercel: `403 forbidden … scope "mutav"` or "project not found"                                                            | Wrong scope. Run `vercel switch mutav`, or pass `--scope mutav`. In the Vercel MCP, use `teamId: team_GNLcWCe3CRw43IgLIjconlkU`. This is not a permissions bug.                                                                                                                                                                     |
| `verify-convex-deploy: refusing to deploy — key/environment mismatch`                                                     | `CONVEX_DEPLOY_KEY` in that Vercel environment is the wrong kind (`prod:` vs `preview:`). Re-add the right key to the right environment.                                                                                                                                                                                            |
| `AUTH0_DOMAIN must be a bare host` (Management API)                                                                       | The Convex env value has `https://`. Strip it.                                                                                                                                                                                                                                                                                      |
| Password-reset or verification emails never arrive                                                                        | The `mutav.finance` SPF is `v=spf1 -all` with DMARC `p=reject`. Auth0 mail sent as `@mutav.finance` is rejected. Configure custom SMTP (Resend) in Auth0, or add the sender's `include:` to SPF (see ADR 0009).                                                                                                                     |
