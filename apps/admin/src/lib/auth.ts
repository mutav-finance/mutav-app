import type { SessionData } from "@auth0/nextjs-auth0/types";
import { auth0 } from "@/lib/auth0";

/**
 * Server-side helper for App Router server components / layouts.
 *
 * Reads the Auth0 session via the singleton client (which itself reads
 * the encrypted session cookie via `next/headers`). Returns the session
 * when present, or `null` when the caller is signed out. Layouts compose
 * this with a `redirect("/auth/login?returnTo=...")` for the not-signed-in
 * case.
 *
 * **Stub**: this should also verify that the Auth0 user has a `mutavStaff`
 * row in Convex (gating staff access — an Auth0 user without a staff row
 * is signed-in but unauthorized). The `mutavStaff` Convex domain doesn't
 * exist yet (it lands with the A1 milestone), so this scaffold returns
 * the Auth0 session as-is. When A1 lands, this function reaches into
 * Convex via `fetchQuery(api.mutavStaff.useCases.getByAuth0Sub, …)` and
 * returns a richer shape (`{ session, mutavStaff }` or `null`).
 */
export async function getStaffMember(): Promise<SessionData | null> {
  let session: SessionData | null;
  try {
    session = await auth0.getSession();
  } catch (err) {
    // `auth0.getSession()` decrypts the encrypted session cookie. It throws
    // on malformed/tampered cookies, post-`AUTH0_SECRET`-rotation stale
    // cookies, clock-skewed `exp` claims, and transient SDK errors. The
    // *expected* recovery for all of these is the same as "no session":
    // send the user to Universal Login. Surface to the layout as `null`
    // (its `if (!member) redirect(...)` branch handles it) rather than
    // bubbling to Next's error boundary, which has no sign-in affordance.
    //
    // Logging is intentionally minimal here — A1 will wire Sentry / the
    // chosen sink and tag this with a stable error id so the config drift
    // is debuggable. For now, a `console.error` is enough trail for local
    // dev and Vercel function logs.
    console.error("[admin] auth0.getSession() failed:", err);
    return null;
  }
  if (!session) return null;

  // TODO(A1): once `convex/mutavStaff/` lands, fetch the row by Auth0 sub
  // and return null when no row exists (signed in but not a staff member).
  // For now, any authenticated Auth0 user passes the gate — fine for the
  // scaffold because the connection itself (mutavStaff Auth0 connection
  // gated on group membership) is the first defense.
  return session;
}

/**
 * Convenience: returns just the Auth0 ID token from the current session,
 * or `null` when the caller is signed out. Mirrors apps/agency's
 * `getAuthToken()` so the Convex bridge (`fetchQuery`, `preloadQuery`)
 * has a uniform API once A1 wires it through.
 */
export async function getAuthToken(): Promise<string | null> {
  const session = await auth0.getSession();
  return session?.tokenSet.idToken ?? null;
}
