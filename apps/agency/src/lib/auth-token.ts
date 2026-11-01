import { getFreshIdToken } from "@mutav/app-shell/fresh-id-token";
import { auth0 } from "@/lib/auth0";
import { getIdTokenRefreshWindowSeconds } from "@/lib/env";

/**
 * Returns the session's ID token, or `null` when the caller is signed out,
 * the session has no ID token, or the token has expired.
 *
 * Use as the `token` argument to `fetchQuery` / `preloadQuery` from
 * `convex/nextjs` so server components can call agency-scoped Convex
 * functions on behalf of the logged-in user.
 */
export async function getAuthToken(): Promise<string | null> {
  const result = await getFreshIdToken({
    auth0,
    refreshWindowSeconds: getIdTokenRefreshWindowSeconds(),
    refresh: "never",
  });
  return result.kind === "token" ? result.token : null;
}
