---
name: auth0-safe-dev
description: Rules and a required verification recipe for changing Auth0-related code in the mutav-app monorepo without leaking or breaking sessions. Use whenever you touch, review or debug anything on the login path, even for a "one-line" tweak, including: apps/*/src/proxy.ts (or any middleware), the Auth0 + next-intl composition, packages/app-shell/src/proxy-headers.ts or auth-redirect.ts, apps/*/src/lib/auth0.ts (onCallback, beforeSessionSaved, session, cookie or transactionCookie config), /auth/login or /auth/logout links and redirects, returnTo handling, the /api/auth/convex-token route, the Convex auth wrappers in convex/lib/auth.ts, the admin staff gate, Auth0 env vars or tenant settings, or upgrading @auth0/nextjs-auth0. Also use for symptoms such as login loops, InvalidStateError, a session cookie that page JS can read, users being logged out at random, or Convex calls arriving anonymous.
---

# Auth0 safe dev (mutav-app)

`apps/agency` and `apps/admin` run `@auth0/nextjs-auth0` v4 (encrypted `__session` cookie, `/auth/*` routes mounted by the proxy). Auth0 proves identity only. **Authorization lives in Convex**: the wrappers in `convex/lib/auth.ts` and the `mutavStaff` row behind admin's `getStaffMember()`. `apps/pay` and `apps/fund` carry no Auth0. ADR 0009 keeps Auth0 through the pilot, so harden it rather than replace it.

The session cookie rolls on **every** request that passes the proxy. A bug in the proxy or cookie config therefore hits almost every page load, not only login. Prod already shipped one: the proxy copied cookies by name and value, which made `__session` readable by page JS (fixed in PR #408).

Source keys like **[S3]** point into `references/sources.md`, which holds the annotated bibliography with links, versions and dates. Commands and test snippets are in `references/verification.md`.

## Never

1. **Never copy Auth0 cookies by name/value** (`res.cookies.set(c.name, c.value)`, or iterating `authRes.cookies.getAll()`). Carry the raw `Set-Cookie` headers with `headers.append`.
   *Why:* the cookies API re-serializes the cookie and drops HttpOnly, Secure, SameSite, Expires and Path. It also turns the SDK's chunk deletions (`__session__1=; Max-Age=0`) into live empty cookies. The official next-intl example appends raw headers. Using `.set` in a loop also overwrites earlier `set-cookie` values. [S2][S3][S11]
2. **Never drop `Cache-Control` from the Auth0 response.** On every rolling refresh the SDK sets `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0` (plus `Pragma`/`Expires`). Wherever the response's `Set-Cookie` travels, these go with it.
   *Why:* CVE-2025-48947 was a CDN caching `__session` because no-store was missing. OWASP requires no-store on any response that carries a session ID. Vercel's CDN already refuses to cache a response with `set-cookie`, so on Vercel this is defense in depth, but any other cache in the path is not covered. [S4][S12][S15]
3. **Never copy `x-middleware-next`** (or blanket-copy every auth header) onto a response that redirects or blocks.
   *Why:* that header makes Next run the route anyway. next-intl often returns a redirect. [S1][S2]
4. **Never wrap or rewrite `/auth/*` responses.** Return the Auth0 response untouched: it is the login, callback and logout flow. [S1]
5. **Never narrow the proxy matcher** beyond static assets and `api/auth/convex-token`.
   *Why:* rolling sessions require the SDK middleware on every request. A matcher change can also silently drop proxy coverage from Server Functions, so never rely on the proxy for authorization. [S1][S13]
6. **Never set `sameSite: "strict"`** on the session or transaction cookie.
   *Why:* the browser comes back from the Auth0 domain through a cross-site top-level navigation. Strict cookies are withheld there, so the callback or the next request sees no session: a login loop or `InvalidStateError`. Lax is sent on top-level GET navigations, and it is the SDK default and OWASP-acceptable. [S1][S10][S12][S16]
7. **Never add a cookie `Domain`.** Keep cookies host-only so `app.`, `admin.` and `pay.` never share a session.
   *Why:* when `Domain` is omitted the cookie goes to the exact host only. OWASP recommends the narrowest scope. [S10][S12] (ADR 0003)
8. **Never redirect `onCallback` errors to `/auth/login`.** The shared `createOnCallback` sends them to `/auth/logout?error=<code>`, with the code only, never the message.
   *Why:* deterministic failures (bad state, callback mismatch) re-enter login and loop forever. Logout clears the transaction cookie and ends in a terminal state. SDK messages can echo request detail.
9. **Never pass `context.returnTo` straight into `new URL(returnTo, base)`.** The official example does exactly this, and it is not safe.
   *Why:* the SDK only checks that the login `returnTo` is same-origin, then stores its path. A path such as `//host` resolves to another origin when rebuilt with `new URL`. This is the open-redirect class fixed inside the SDK in 4.32.0 (CVE-2026-107369), but a custom `onCallback` is your own code. Re-check the origin after building the URL (see Do). [S5][S6][S7]
10. **Never make the callback the authorization gate.** Provisioning (`getOrCreateByIdentity`) fails open on purpose. Access is enforced by the Convex wrappers and the staff gate, which fail closed.
    *Why:* Convex verifies the JWT, but every function must check identity itself. A role check in the callback only runs once per login, while the wrappers run on every request. [S13][S19]
11. **Never send access or refresh tokens to the browser**, and never read `process.env` outside `apps/*/src/lib/env.ts` or `convex/lib/env.ts`. The only token that reaches client JS is the ID token, through `/api/auth/convex-token`, because Convex verifies it (`aud` = client ID). Never put any other token on that route.
    *Why:* Auth0 recommends server-side token storage, because XSS can read anything the browser holds. The SDK's own docs call disabling `/auth/access-token` a best practice. [S8][S17][S19]
12. **Never trust a `userId`, `subject` or `tokenIdentifier` from client args.** Derive identity from `ctx.auth` inside the wrappers. [S19]
13. **Never print cookie or token values** in logs, tests, PRs or chat. Names and flags only.
14. **Never file an auth vulnerability as a public issue with exploit detail.** `mutav-finance/mutav-app` is public. Fix it in a PR with a neutral title, or open a private GitHub security advisory.
15. **Never refresh tokens in a Server Component.** Refresh only in the proxy (`createAuthProxy`) or a route handler (`createConvexTokenRoute`). Server Components call `getFreshIdToken({ refresh: "never" })`.
    *Why:* Next swallows cookie writes from a Server Component, so the refresh spends the rotating refresh token and the new one is lost. The next refresh then reuses a revoked token.
16. **Never enable refresh-token rotation without an overlap period** (about 30 s; settings in `docs/auth0.md`).
    *Why:* the proxy and the token route can refresh the same session at once. Without leeway, reuse detection revokes the whole token family and signs the user out. [S17]
17. **Never map a server-side failure to login.** Use the typed kinds: agency `backend-unavailable` / `not-provisioned` → `/session-error`, admin `unavailable` → `/unavailable`. Only a missing or expired ID token (`session-expired`, `anonymous`) goes to `/auth/login`.
    *Why:* login completes silently through SSO, the same read fails again, and the browser loops through Auth0.
18. **Don't "fix" or re-flag the dev-tenant persona password** in `docs/test-personas.md`. It is public by design, works on the dev tenant only, and rotates when the prod tenant is cut (#119, ADR 0009). [S18]

## Do

**Use the shared factories** in `packages/app-shell/src/`. Each app file is a thin wrapper; never fork the logic into an app. [S1][S2]

```ts
// apps/*/src/proxy.ts — Auth0 first; /auth/* and /api/* untouched; ID token refreshed near expiry;
// auth headers folded into the next-intl response by carryAuthHeaders (raw Set-Cookie + no-store, never x-middleware-next)
const authProxy = createAuthProxy({ auth0, handleI18nRouting: createMiddleware(routing), getRefreshWindowSeconds: getIdTokenRefreshWindowSeconds });

// apps/*/src/app/api/auth/convex-token/route.ts — ID token only, no-store, every failure a 401
export const GET = createConvexTokenRoute({ auth0, getRefreshWindowSeconds: getIdTokenRefreshWindowSeconds });

// apps/*/src/lib/auth0.ts — provisioning fails open; errors → /auth/logout?error=<code>;
// success → sameOriginRedirectUrl (re-checks the origin of returnTo, rule 9)
onCallback: createOnCallback({ getAppBaseUrl, getConvexUrl, provisionMutation: api.users.useCases.getOrCreateByIdentity }),

// Server Components (layouts, gates) — read, never refresh (rule 15)
const result = await getFreshIdToken({ auth0, refreshWindowSeconds: getIdTokenRefreshWindowSeconds(), refresh: "never" });
```

**Cookie and session config** (`apps/*/src/lib/auth0.ts`) [S1][S9][S12]:

- Admin: `rolling: true`, 12 h absolute, 30 min inactivity. Session and transaction cookies are both `sameSite: "lax"` and `secure: true`. Keep these numbers or tighten them (ADR 0009). OWASP's idle range for high-value apps is shorter (2 to 5 min), so any loosening needs an ADR.
- Agency: SDK session defaults (rolling, 3 days absolute, 1 day inactivity), with `sameSite: "lax"` set explicitly. `secure` comes from `APP_BASE_URL`, so it is true on https and false only on http localhost.
- Both apps: `transactionCookie.maxAge` 900 s.
- `httpOnly` is always on and cannot be configured. A test or check that ever shows `__session` in `document.cookie` means something re-serialized the cookie. [S1]
- Keep the long "why" comments in these files. They are the record of the login loop.

**Login, logout and returnTo** [S1][S6][S14]

- Logout is a plain `<a href="/auth/logout">` (`packages/ui/src/nav-user.tsx`), never `next/link`, because client routing skips the SDK route handler.
- Server-side login redirects use `next/navigation`'s `redirect` to `/auth/login?returnTo=<relative path>`. The SDK routes sit at the root, outside `[locale]`.
- returnTo should carry the current locale and path (#404). With `localePrefix: "as-needed"`, `pt-BR` has no prefix, so build the path the way next-intl does. Values over 2 KB fall back silently.
- Logout `returnTo` must be in the tenant's Allowed Logout URLs. Callback, logout and web-origin lists use exact URLs on the prod tenant, never wildcards. [S14]

**Convex side**: every public query or mutation goes through a wrapper (`queryWithAuth`, `*WithAgencyScope`, `mutationWithActiveAgency`, `*WithMutavStaff`, role-gated staff wrappers). See `docs/auth.md`. [S19]

**SDK upgrades**: read the advisories page and the CHANGELOG between the current version and the target ([S5][S7]). Re-read `dist/server/auth-client.js` (the rolling-session branch of `handler`, `handleLogout`), `dist/server/cookies.js` (`addCacheControlHeadersForSession`) and `dist/utils/url-helpers.js` and `dist/utils/pathUtils.js` (returnTo). Check which headers the middleware sets now and whether cookie or transaction-cookie formats changed: 4.29 changed the transaction cookie format, which breaks logins in flight across a deploy. Then run the full verification.

## Verification (required for any auth change)

The commands and snippets are in `references/verification.md`. In short:

1. **Unit:** test the header composition with `NextResponse` fixtures. Give fixture cookies a fixed `expires` date, because `maxAge` makes Next serialize a clock-dependent `Expires`. Assert that every attribute survives, chunk deletions stay deletions, the target's own cookies survive, no-store is carried, and `x-middleware-next` is not. If `onCallback` changes, unit-test returnTo values `//x`, `/\x` and `https://other` against the redirect origin.
2. **Browser:** log in as a persona and make **2 or more navigations** so a rolling refresh happens. Then check:
   - `document.cookie` has no `__session*`.
   - Playwright `context.cookies()` shows `__session` with `httpOnly: true`, `sameSite: "Lax"`, an expiry, `secure: true` on https, and a domain equal to the exact host.
   - A page response after the refresh carries `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`.
   - Logout, then login through `/auth/callback`, lands back where you started, with no loop and no stray `__txn_*` cookies.
3. **Refresh path:** on a preview, set the refresh window above the ID-token lifetime, navigate, and confirm a new `__session` Set-Cookie keeps HttpOnly/Lax/Secure and the token route answers `no-store`.
4. **No loop:** with an unreachable Convex URL, a signed-in user lands on `/session-error` (or admin `/unavailable`) after at most one Auth0 round trip.
5. **Prod:** after deploy, repeat step 2 on `app.mutav.finance` and `admin.mutav.finance`.
6. Report names and flags only. A check that never loaded a page reports `structure only`, not `pass`.

## Repo sources

Code: `packages/app-shell/src/{auth-proxy,convex-token-route,auth-callback,fresh-id-token,id-token,proxy-headers,auth-redirect}.ts` (each + `.test.ts`), `apps/{agency,admin}/src/proxy.ts`, `apps/{agency,admin}/src/lib/{auth0,env}.ts`, `apps/*/src/app/api/auth/convex-token/route.ts`, `apps/agency/src/lib/user-destination.ts` + `session-failure-redirect.ts`, `apps/admin/src/lib/{auth,staff-gate}.ts`, the failure pages `apps/agency/src/app/[locale]/session-error/` and `apps/admin/src/app/[locale]/unavailable/`, `packages/ui/src/nav-user.tsx`, `convex/lib/auth.ts`, `convex/auth.config.ts`, `convex/users/useCases.ts` (`getOrCreateByIdentity`, `clearSubjectsForTenantCut`). Docs: `docs/auth.md`, `docs/auth0.md` (env, tenant settings, refresh, cut-over runbook, troubleshooting), ADR 0003, ADR 0009, `docs/test-personas.md`, the CLAUDE.md sections "Auth & agency scoping" and "Environment variables".
