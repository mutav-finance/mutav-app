import { auth0 } from "@/lib/auth0";

/**
 * Reads the current Auth0 session and returns the ID token, or `null`
 * when the caller is signed out (or the session has no ID token).
 *
 * Use as the `token` argument to `fetchQuery` / `preloadQuery` from
 * `convex/nextjs` so server components can call agency-scoped Convex
 * functions on behalf of the logged-in user.
 */
export async function getAuthToken(): Promise<string | null> {
  const session = await auth0.getSession();
  return session?.tokenSet.idToken ?? null;
}
