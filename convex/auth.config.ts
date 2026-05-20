import { getAuth0ClientId, getAuth0Domain } from "./lib/env";

/**
 * Convex auth providers — Auth0 JWT verification.
 *
 * Reads the tenant URL + application ID via the lazy env-getter pattern
 * (`convex/lib/env.ts`). When both env vars are set, the provider entry
 * trusts ID tokens issued by the configured Auth0 tenant for the
 * configured client ID — `ctx.auth.getUserIdentity()` then returns the
 * decoded claims (`subject`, `email`, `name`, …) inside every handler.
 *
 * When either env var is unset, the providers array stays empty. Convex
 * functions then see `ctx.auth.getUserIdentity()` as null and the
 * `resolveCurrentUser` helper in `convex/lib/auth.ts` falls back to the
 * legacy `dev-user` row. This dev-bypass path is gated by the same env
 * presence so prod cannot accidentally land there.
 *
 * History: the conditional env-var read here was the root of the PR #75
 * preview-deploy failure. The Convex analyzer doesn't know the read is
 * conditional, so simply referencing `process.env.AUTH0_DOMAIN` at
 * module load makes the analyzer require the var on every deployment.
 * The lazy getter pattern (in `lib/env.ts`) defers the read into a
 * function call, which the analyzer treats as runtime config — preview
 * deploys without Auth0 set continue to build cleanly.
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
