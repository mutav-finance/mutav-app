# Sources (annotated bibliography)

The keys **[Sn]** are the ones cited in `SKILL.md`. The repo is on `@auth0/nextjs-auth0` 4.20.0 and Next.js 16. Sources were retrieved on 2026-10-28. When a source and the installed SDK source disagree, the installed source wins: read `node_modules/@auth0/nextjs-auth0/dist/`.

## Auth0 Next.js SDK

- **[S1] nextjs-auth0 EXAMPLES.md** (main, covers v4.33.0). https://github.com/auth0/nextjs-auth0/blob/main/EXAMPLES.md
  Supports several rules:
  - "Combining middleware": the `x-middleware-next` warning, and "Only copy headers that are necessary, like `set-cookie`."
  - "Understanding Rolling Sessions": rolling sessions *require* the middleware on all requests, so the matcher must be broad.
  - Session defaults: rolling true, 3 days absolute, 1 day inactivity.
  - Cookie options: `httpOnly` is always true and not configurable. `sameSite` defaults to Lax. `secure` defaults to false unless `AUTH0_COOKIE_SECURE` is set or `appBaseUrl` is https/omitted in prod. `name` is configurable (default `__session`). Transaction cookie prefix is `__txn_`.
  - returnTo: "must be a relative path — absolute external URLs are rejected". Fields over 2 KB fall back to the default.
  - Logout: `returnTo` must be in Allowed Logout URLs. `logoutStrategy` is auto/oidc/v2. `federated` also logs out of the upstream IdP.
  - "Next.js 16 Compatibility": rename `middleware.ts` to `proxy.ts`.
  - The `onCallback` example builds `new URL(context.returnTo || "/", appBaseUrl)`. That is the unsafe pattern called out in rule 9.
- **[S2] Official with-next-intl example**, `examples/with-next-intl/middleware.ts`. https://github.com/auth0/nextjs-auth0/tree/main/examples/with-next-intl
  Runs Auth0 first and returns `/auth*` untouched. It *appends* Auth0 headers onto the intl response (preserving multiple `set-cookie`), and skips `x-middleware-next` when the intl response is a redirect (status 300 or above). This grounds the proxy composition and rule 3.
- **[S3] SDK source, installed 4.20.0**:
  - `dist/server/auth-client.js`: the rolling branch sets cookies and calls `addCacheControlHeadersForSession`. `handleLogout` reads `returnTo` and `federated` from the query.
  - `dist/server/cookies.js` `addCacheControlHeadersForSession`: `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Pragma: no-cache`, `Expires: 0`.
  - `dist/utils/url-helpers.js` `toSafeRedirect`: a same-origin check only, which then stores pathname+search+hash.
  - `dist/utils/pathUtils.js` `createRouteUrl`: used by the default `onCallback`. It strips one leading slash, so the default is safe; a custom `new URL(...)` is not.
  - `dist/server/client.d.ts` `enableAccessTokenEndpoint`: defaults to `true`, and "A security best practice is to disable this to avoid exposing access tokens to the client app."
  - `dist/server/session/abstract-session-store.js`: the session defaults.
- **[S4] GHSA-f3fg-mf2q-fj3f / CVE-2025-48947**, "CDN Caching of Session Cookies" (High, CVSS 7.7). Affects 4.0.1–4.6.0, patched in 4.6.1. https://github.com/auth0/nextjs-auth0/security/advisories/GHSA-f3fg-mf2q-fj3f
  `__session` was cacheable because Cache-Control was missing. This is why the proxy must not drop the SDK's no-store (rule 2).
- **[S5] SDK security advisories index.** https://github.com/auth0/nextjs-auth0/security/advisories
  | GHSA | CVE | Sev | Affected → fixed | Topic |
  |---|---|---|---|---|
  | GHSA-5vvp-h2v6-59j6 (2026-10-13) | CVE-2026-107369 | Moderate 6.1 | < 4.32.0 → 4.32.0 | Post-login redirect rebuilt into an absolute or scheme-relative URL (open redirect, CWE-601) |
  | GHSA-xq8m-7c5p-c2r6 (2026-04-17) | CVE-2026-40155 | Moderate | 4.12.0–4.17.0 → 4.18.0 | Proxy cache lookup with DPoP on `/me/*`, `/my-org/*` |
  | GHSA-mr6f-h57v-rpj5 (2025-12-10) | CVE-2025-67716 | Moderate | 4.9.0–4.12.x → 4.13.0 | `returnTo` injected OAuth params |
  | GHSA-wcgj-f865-c7j7 (2025-12-10) | CVE-2025-67490 | Moderate | 4.11.0–4.12.0 → 4.11.2/4.12.1 | TokenRequestCache mix-up under concurrency |
  | GHSA-f3fg-mf2q-fj3f (2025-06-04) | CVE-2025-48947 | High | 4.0.1–4.6.0 → 4.6.1 | CDN caching of session cookie |
  | GHSA-pjr6-jx7r-j4r6 (2025-04-29) | — | Moderate | 4.0.1–4.5.0 → 4.5.1 | Session JWE missing expiration |
  | GHSA-2mqv-4j3r-vjvp (2021) | — | Moderate | v1 | Open redirect |
  | GHSA-954c-jjx6-cxv7 (2021) | — | High | v1 | Reflected XSS via callback `error` param |
- **[S6] GHSA-5vvp-h2v6-59j6** detail. https://github.com/auth0/nextjs-auth0/security/advisories/GHSA-5vvp-h2v6-59j6
  The returnTo is validated, then *reconstructed* into a scheme-relative or absolute URL. No workaround is listed; the fix is to upgrade. A custom `onCallback` must do its own origin check (rule 9).
- **[S7] nextjs-auth0 CHANGELOG** (latest v4.33.0, 2026-10-22). https://github.com/auth0/nextjs-auth0/blob/main/CHANGELOG.md
  - 4.21.0: cookie deletion keeps its security attributes.
  - 4.29.0: transaction-cookie accumulation fixed, but the transaction cookie *format changed*, so deploy carefully.
  - 4.31.1: session-expiry errors surfaced, stale txn cookies evicted.
  - 4.32.0: createRouteUrl cross-origin check; cookie attributes kept on Server Action refresh.
- **[S8] Token-Mediating Backend**, IETF draft "OAuth 2.0 for Browser-Based Applications". https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps
  Cited by the SDK for `enableAccessTokenEndpoint`: prefer keeping tokens on the backend.
- **[S11] GitHub issue auth0/nextjs-auth0#2394.** https://github.com/auth0/nextjs-auth0/issues/2394
  A user combining middleware lost session cookies. The workaround was to *append* `set-cookie` headers, because `.set` in a loop overwrites. A field report that supports rule 1.

## Auth0 platform

- **[S9] Auth0 token storage.** https://auth0.com/docs/secure/security-guidance/data-security/token-storage
  Store tokens server-side or in an encrypted cookie (4 KB max). XSS can read browser storage.
- **[S14] Auth0 subdomain wildcards.** https://auth0.com/docs/get-started/applications/wildcards-for-subdomains
  "Wildcard placeholders in subdomains should not be used in production applications". Callback URLs, origins and web origins use exact URLs.
- **[S17] Auth0 refresh token rotation.** https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation
  Rotation plus reuse detection invalidates the whole token family. It applies only if the SDK requests `offline_access` (it doesn't today; see ADR 0009).
- **[S18] Auth0 multiple environments.** https://auth0.com/docs/get-started/auth0-overview/create-tenants/set-up-multiple-environments
  One tenant per environment. A mixed-use tenant should be tagged Production. Custom domains are recommended for prod. This is the basis for #119 and the reason the dev-persona password is acceptable only on the dev tenant.

## Web standards

- **[S10] MDN Set-Cookie.** https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
  - Lax: sent on cross-site top-level navigations with safe methods. Strict: never sent cross-site.
  - HttpOnly blocks `document.cookie`.
  - An omitted `Domain` gives a host-only cookie.
  - `__Host-` requires Secure, no Domain, and `Path=/`.
- **[S12] OWASP Session Management Cheat Sheet.** https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
  - Secure and HttpOnly are mandatory. SameSite should be Strict or Lax. Domain and Path should be narrow.
  - The `__Host-` prefix is "Recommended for session IDs".
  - Idle timeout 2–5 min for high-value apps, 15–30 for low-risk. Timeouts are enforced server-side. Renew the session ID at login.
  - `Cache-Control: no-store` on responses carrying session IDs. `Clear-Site-Data` on logout.
- **[S16] RFC 6265bis (draft-ietf-httpbis-rfc6265bis), SameSite.** https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/
  Lax permits cookies on top-level, safe-method cross-site navigations, which is exactly the OAuth redirect back from the IdP. Strict does not.

## Platform (Next.js, Vercel, Convex)

- **[S13] Next.js `proxy.js` reference** (Next 16, updated 2026-09-04). https://nextjs.org/docs/app/api-reference/file-conventions/proxy
  - `middleware` is renamed to `proxy`, and it defaults to the Node runtime.
  - Cookies are regular `Set-Cookie` headers.
  - "Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone." A matcher change can silently remove coverage.
- **[S15] Vercel CDN Cache.** https://vercel.com/docs/caching/cdn-cache
  Cacheable only if the "Response doesn't contain the `set-cookie` header" and has no `private`/`no-cache`/`no-store`. So Vercel's own CDN won't cache a session response. The no-store carry protects against other caches and future config.
- **[S19] Convex + Auth0**, https://docs.convex.dev/auth/auth0, and **Auth in functions**, https://docs.convex.dev/auth/functions-auth
  - `convex/auth.config.ts` holds `domain` plus `applicationID` (the client ID).
  - The client passes an Auth0 token, which Convex validates against Auth0's keys.
  - Each function reads identity via `ctx.auth.getUserIdentity()`.
  - Convex verifies the token; authorization is the functions' job, and here that means the wrappers.
