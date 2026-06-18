import type { SessionData } from "@auth0/nextjs-auth0/types";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { auth0 } from "@/lib/auth0";

/**
 * The resolved staff member: the Auth0 session plus the staff roles the
 * caller holds in Convex. `getStaffMember()` returns `null` for both the
 * not-signed-in case and the signed-in-but-not-staff case, so the layout's
 * `if (!member) redirect(...)` branch handles them uniformly.
 */
export type StaffMember = {
  session: SessionData;
  roles: string[];
};

/**
 * Server-side staff gate for App Router server components / layouts.
 *
 * Two checks, fail-closed at each:
 *
 * 1. **Session present.** Reads the Auth0 session via the singleton client
 *    (which decrypts the encrypted session cookie via `next/headers`).
 *    No session → `null`.
 * 2. **Staff in Convex.** Fetches `mutavStaff.getMyStaff` with the session's
 *    Auth0 ID token as the bearer credential. A signed-in user with no
 *    `mutavStaff` row (the query returns `null`) is authenticated but not
 *    authorized → `null`. Only a non-empty roles set passes the gate.
 *
 * Layouts compose this with `redirect("/auth/login?returnTo=...")` for the
 * `null` case.
 */
export async function getStaffMember(): Promise<StaffMember | null> {
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
    console.error("[admin] auth0.getSession() failed:", err);
    return null;
  }
  if (!session) return null;

  const idToken = session.tokenSet.idToken;
  if (!idToken) return null;

  let staff: { roles: string[] } | null;
  try {
    staff = await fetchQuery(api.mutavStaff.useCases.getMyStaff, {}, { token: idToken });
  } catch (err) {
    // Fail closed: errors reading the staff row (Convex transient/network
    // failure) deny access rather than admitting an unverified user. The
    // authorization decision is the null/empty-roles result below, not the
    // token audience — getMyStaff is a subject-keyed identity read
    // (queryWithAuth), not one of the aud-bound capability wrappers.
    console.error("[admin] mutavStaff.getMyStaff failed:", err);
    return null;
  }

  if (!staff) return null;

  return { session, roles: staff.roles };
}

/**
 * Convenience: returns just the Auth0 ID token from the current session,
 * or `null` when the caller is signed out. Mirrors apps/agency's
 * `getAuthToken()` so the Convex bridge (`fetchQuery`, `preloadQuery`)
 * has a uniform API.
 */
export async function getAuthToken(): Promise<string | null> {
  const session = await auth0.getSession();
  return session?.tokenSet.idToken ?? null;
}
