import { getAuth0AdminClientId, getAuth0ClientId, getAuth0Domain } from "./lib/env";

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
const adminApplicationID = getAuth0AdminClientId();

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

// Agency and admin are two Auth0 applications in the SAME tenant: they share
// the issuer (`domain`) and differ only by `applicationID` (the JWT `aud`).
// Convex matches a token against the provider whose `applicationID` equals the
// token's audience, so the two entries never collide. Each is included only
// when its client id is configured on this deployment (empty sentinel = off),
// keeping both fail-closed and independent — adding admin never disturbs
// agency auth.
const authConfig = {
  providers:
    domain && applicationID
      ? [
          { domain: normalizeAuth0Issuer(domain), applicationID },
          ...(adminApplicationID
            ? [{ domain: normalizeAuth0Issuer(domain), applicationID: adminApplicationID }]
            : []),
        ]
      : [],
};

export default authConfig;
