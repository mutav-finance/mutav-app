import { getAuth0ClientId, getAuth0Domain } from "./lib/env";

/**
 * Convex auth providers — Auth0 JWT verification.
 *
 * **REQUIRED env vars on every Convex deployment** (yes, every — dev,
 * preview, prod):
 *
 *   bunx convex env set AUTH0_DOMAIN <tenant.auth0.com or "">
 *   bunx convex env set AUTH0_CLIENT_ID <client-id or "">
 *
 * **They must be set, but the value may be empty.** Convex's deploy-time
 * analyzer scans this file (and everything it transitively imports) for
 * `process.env.X` references and refuses to deploy if any referenced
 * var is missing from the deployment. The lazy-getter pattern in
 * `lib/env.ts` does NOT bypass this — the analyzer follows call chains.
 * That was the lesson of PR #75's rollback; do not repeat it.
 *
 * - **Both empty** → providers: [] → `resolveCurrentUser` falls back to
 *   the `dev-user` row (`convex/lib/auth.ts`). The dev/preview default.
 * - **Both set to real values** → provider trusts ID tokens issued by
 *   the tenant for that client ID. `ctx.auth.getUserIdentity()` returns
 *   the decoded claims; the auth wrappers look up users by `subject`.
 *
 * Half-configured (one set, one empty) is treated as fully unconfigured
 * — both must be real for the provider to register. There is no
 * production deployment where Auth0 is "half on".
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
