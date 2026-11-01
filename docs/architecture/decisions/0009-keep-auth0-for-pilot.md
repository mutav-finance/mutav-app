# ADR 0009 — Keep Auth0 as the identity provider for the pilot

**Status:** Accepted (2026-10-25) · **Decided by:** Julia (CTO) · **Phase:** Pre-launch hardening (Story 1.6, [#230](https://github.com/mutav-finance/mutav-app/issues/230)) · **Issues:** [#119](https://github.com/mutav-finance/mutav-app/issues/119) (separate prod tenant + secret rotation), [#206](https://github.com/mutav-finance/mutav-app/issues/206) (staff connection + MFA) · **Related:** [ADR 0003](0003-persona-app-origin-isolation-single-convex.md) (one Auth0 application, `pay` Auth0-free, Host-Only cookies), [ADR 0004](0004-pilot-cover-default-coverage-draw.md) §4 (staff authorization is the Convex `mutavStaff` row, not a JWT claim) · **Guide:** [`docs/auth0.md`](../../auth0.md)

## Context

The question came up whether to replace Auth0 with Convex Auth (`@convex-dev/auth`) before the first agency onboards. The reasons were fewer vendors, auth code next to the rest of the backend, and no Auth0 bill.

How auth works today. `apps/agency` and `apps/admin` each run `@auth0/nextjs-auth0` v4 (encrypted session cookie, `/auth/*` routes in the proxy). Each app hands the Auth0 **ID token** to Convex, and Convex checks it against the one provider in `convex/auth.config.ts`. Authorization lives in Convex: the wrappers in `convex/lib/auth.ts` and the `mutavStaff` table. `apps/pay` (publicId bearer) and `apps/fund` (wallet as identity) carry no Auth0. Auth0 appears in about 85 files across `apps/admin`, `apps/agency`, `packages/app-shell`, `convex/lib`, `convex/mutavStaff`, `convex/users`, the seed and scripts, and the docs (about 68 without tests). Every guarantee path runs through the wrappers. `@convex-dev/auth` is not used anywhere in the repo.

We are a two-person team running a fintech that holds tenant PII under LGPD, and staff MFA is a launch gate ([#206](https://github.com/mutav-finance/mutav-app/issues/206)). The deciding question is **who owns the security-critical code and the credential data**, not developer convenience.

## Decision

**Keep Auth0 as the only identity provider through the pilot.** No migration to Convex Auth, Clerk or WorkOS before the pilot graduates. The reasons, in order of weight:

1. **The security controls already exist and are maintained by someone else.** Auth0 provides MFA (including WebAuthn and passkeys), brute-force protection, breached-password detection, bot detection, suspicious-IP throttling, and tenant audit logs. Staff MFA is a launch gate. As of mid-2026 Convex Auth was in beta with no built-in MFA. Rebuilding MFA and abuse protection would be security-critical code that a two-person team should not write or own.
2. **Credential custody stays outside our database.** With Convex Auth, password hashes, reset tokens and verification flows would live in our Convex deployment. That widens our LGPD liability and audit scope on top of the tenant PII we already hold ([ADR 0001](0001-pii-crypto-pattern.md), [ADR 0002](0002-b2b2c-tenant-credit-data-governance.md)). With Auth0, a credential-store breach happens outside our database.
3. **Migration cost and timing.** Replacing auth means rewriting the session layer in two apps, the token bridge in `packages/app-shell`, the Convex provider, first-login provisioning, the seed personas and the staff bootstrap, and then re-testing every wrapped handler. Doing this right before the first agency onboards is the riskiest timing.
4. **No real supply-chain gain.** Switching swaps `@auth0/nextjs-auth0` for `@convex-dev/auth` and its own dependencies. The npm attack surface does not shrink in a way that changes the risk picture.

## Consequences

Keeping Auth0 only holds up if the tenant is hardened before real users arrive. This hardening is **required**, not optional. Each item maps to an open issue:

- **Separate production tenant and rotated secrets ([#119](https://github.com/mutav-finance/mutav-app/issues/119)).** Today the shared dev tenant (`dev-ay46ib0hhi1mdwpw.us.auth0.com`) serves localhost, every Vercel preview and the production deployments. Cut a `mutav-prod` tenant with its own application, client secret and callback, logout and origin URLs. Rotate `AUTH0_CLIENT_SECRET` and `AUTH0_SECRET` on Vercel Production. Remove the dev personas from prod. The pre-launch persona logins on the dev tenant are known and accepted until that rotation ([`docs/test-personas.md`](../../test-personas.md)).
- **Enforce staff MFA with phishing-resistant factors ([#206](https://github.com/mutav-finance/mutav-app/issues/206)).** Create the `mutavStaff` database connection with self-signup off, plus the Post-Login Action that requires MFA. Use WebAuthn (security keys or passkeys) as the staff factor, not SMS or email OTP. Until then the admin gate stays fail-closed, and Vercel Deployment Protection stays on `mutav-app-admin`.
- **Turn on the attack-protection suite in the prod tenant.** Brute-force protection, breached-password detection and bot detection, with suspicious-IP throttling left on.
- **Session and token hygiene.** Refresh-token rotation (with reuse detection) for any refresh token the SDK requests. Short admin sessions: `apps/admin` already sets 12 h absolute and 30 min inactivity, so keep those numbers or tighten them. Exact allowlists for callback, logout and web origins: one entry per real origin, no wildcards on the prod tenant.
- **Email deliverability.** The `mutav.finance` zone publishes `v=spf1 -all` with DMARC `p=reject`. Any Auth0 email sent as `@mutav.finance` (verification, password reset, MFA enrollment) will be rejected unless one of these is done: add the sender's `include:` to SPF before `-all`, or configure Auth0 **custom SMTP through Resend** (already our send-only provider) so mail goes out from a domain that is already authorized. Without one of these, password reset silently fails in production.
- **Vendor lock-in stays.** Users, password hashes and MFA enrollments live in Auth0. A later migration needs Auth0's bulk user export (password hashes are released only on a support request) or forced password resets. We accept this for the pilot.
- **Cost.** Auth0 pricing scales with monthly active users and with features like enterprise MFA. At pilot scale this is small. Re-check it when the agency count grows.

> **Note (2026-10-28, branch `refactor/auth0-shared-session`) — session and token hygiene.** The SDK requests `offline_access` by default, so the apps hold a refresh token, and they now use it to renew the ID token before it expires (the proxy ahead of expiry, the convex-token route on demand; Server Components never refresh). That makes refresh-token rotation with reuse detection a live control, not a conditional one. The application needs the Refresh Token grant, rotation with reuse detection, an overlap period of about 30 s (the proxy and the token route can refresh concurrently), and refresh-token lifetimes of at least the 3-day agency session. The settings are listed in [`docs/auth0.md`](../../auth0.md#required-tenant-settings-the-mutav-application). Admin's 30-minute inactivity timeout is renewed only when the session cookie is rewritten: by requests that pass the proxy, and by a convex-token call that actually refreshes the ID token. Convex websocket traffic and token-route calls that don't refresh do not renew it, so a staff member who only watches live data is signed out after 30 minutes. This is accepted.

## Revisit

A **stage-2 ADR after the pilot** reopens the question. Triggers: Auth0 cost becomes material, lock-in starts to block something concrete, or the alternatives mature. That ADR should re-evaluate:

- **Convex Auth**: has it shipped stable MFA and passkeys? What would credential custody in our database mean for LGPD scope?
- **WorkOS**: enterprise SSO for larger agency networks, plus AuthKit pricing.
- **Clerk**: developer experience, Convex integration, and cost at our MAU.

## Alternatives considered

- **Convex Auth only (`@convex-dev/auth`).** One vendor fewer, auth next to the data. Rejected for the pilot: beta, no built-in MFA, credential custody in our own database, and a rewrite at the worst possible time.
- **Clerk.** Good developer experience, first-party Convex integration, MFA and passkeys available. Rejected for now: a migration of the same size as Convex Auth, it moves lock-in rather than removing it, and it adds nothing Auth0 lacks for our threat model.
- **WorkOS (AuthKit).** Strong on enterprise SSO and directory sync. Rejected for now: our agencies are small imobiliárias without IdPs, so the SSO strength does not apply yet, and it needs the same migration.
