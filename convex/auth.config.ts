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

const authConfig = {
  providers:
    domain && applicationID
      ? [
          {
            domain: domain.startsWith("http") ? domain : `https://${domain}`,
            applicationID,
          },
        ]
      : [],
};

export default authConfig;
