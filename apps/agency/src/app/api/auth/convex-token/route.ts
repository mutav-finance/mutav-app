import { createConvexTokenRoute } from "@mutav/app-shell/convex-token-route";
import { auth0 } from "@/lib/auth0";
import { getIdTokenRefreshWindowSeconds } from "@/lib/env";

/**
 * Hands the Convex client the session's ID token, never the access token:
 * Convex's `auth.config.ts` matches `aud` against the Auth0 client ID, which
 * the ID token carries by default. Access tokens are higher-privilege and
 * must not flow on the same channel as the Convex auth header.
 */
export const GET = createConvexTokenRoute({
  auth0,
  getRefreshWindowSeconds: getIdTokenRefreshWindowSeconds,
});
