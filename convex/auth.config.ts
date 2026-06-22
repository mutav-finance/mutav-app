import { getAuth0ClientId, getAuth0Domain } from "./lib/env";

/**
 * Convex auth providers — Auth0 JWT verification.
 *
 * **REQUIRED env vars on every Convex deployment** (yes, every — dev,
 * preview, prod):
 *
 *   bunx convex env set AUTH0_DOMAIN <tenant.auth0.com>
 *   bunx convex env set AUTH0_CLIENT_ID <client-id>
 *
 * Convex's deploy-time analyzer scans this file (and everything it
 * transitively imports) for `process.env.X` references and refuses to
 * deploy if any referenced var is missing from the deployment. The
 * lazy-getter pattern in `lib/env.ts` does NOT bypass this — the
 * analyzer follows call chains. That was the lesson of PR #75's
 * rollback; do not repeat it.
 *
 * Half-configured (one set, one empty) is treated as fully unconfigured
 * — both must be real for the provider to register, otherwise every
 * authenticated request throws `UnauthenticatedError`.
 */
const domain = getAuth0Domain();
const applicationID = getAuth0ClientId();

// Normalize the domain to an https:// origin. Accepts:
//   - bare host (`tenant.auth0.com`) — most common, recommended
//   - already-prefixed `https://tenant.auth0.com`
// Rejects `http://` (silent downgrade to an unencrypted JWT issuer would
// break verification at best, mis-trust a forgery at worst).
function normalizeAuth0Issuer(value: string): string {
  if (value.startsWith("https://")) return value;
  if (value.startsWith("http://")) {
    throw new Error(
      `AUTH0_DOMAIN must use https:// (got "${value}"). Strip the scheme or fix the env value.`,
    );
  }
  return `https://${value}`;
}

// A single Auth0 application backs every authenticated surface (agency, fund,
// admin): they share both the issuer (`domain`) and the `applicationID` (the
// JWT `aud`), so one provider validates them all. (`pay` is publicId-bearer —
// no Auth0.) Authorization is NOT by `aud`: Convex doesn't surface the claim,
// so the staff gate is the `mutavStaff` row, not a separate admin application
// (see `convex/lib/auth.ts` and ADR 0004 §4). Fail-closed: an unset client id
// registers no provider, so every authenticated request throws.
const authConfig = {
  providers:
    domain && applicationID ? [{ domain: normalizeAuth0Issuer(domain), applicationID }] : [],
};

export default authConfig;
