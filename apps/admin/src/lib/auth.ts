import type { SessionData } from "@auth0/nextjs-auth0/types";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { auth0 } from "@/lib/auth0";

/**
 * Three-way result of the admin staff gate, so the layout can route each
 * outcome distinctly instead of collapsing them to `null`:
 *
 * - `anonymous` — no usable session (signed out, malformed/stale cookie, or
 *   a fail-closed fetch error). Layout → Universal Login.
 * - `not-staff` — authenticated, but no `mutavStaff` row. Carries the
 *   `session` so the layout can bounce to the AGENCY app ORIGIN rather than
 *   loop back to login (loop-freedom).
 * - `staff` — authenticated and staff. Carries `session` + `roles`.
 */
export type StaffGateResult =
  | { kind: "anonymous" }
  | { kind: "not-staff"; session: SessionData }
  | { kind: "staff"; session: SessionData; roles: string[] };

/**
 * Server-side staff gate for App Router server components / layouts.
 *
 * Two checks, fail-closed at each (a failed read resolves to `anonymous`,
 * never to a granted result):
 *
 * 1. **Session present.** Reads the Auth0 session via the singleton client
 *    (which decrypts the encrypted session cookie via `next/headers`).
 *    No session / decrypt failure → `anonymous`.
 * 2. **Staff in Convex.** Fetches `mutavStaff.getMyStaff` with the session's
 *    Auth0 ID token as the bearer credential. A signed-in user with no
 *    `mutavStaff` row (the query returns `null`) is `not-staff`; only a
 *    non-empty roles set yields `staff`.
 */
export async function getStaffMember(): Promise<StaffGateResult> {
  let session: SessionData | null;
  try {
    session = await auth0.getSession();
  } catch (err) {
    // `auth0.getSession()` decrypts the encrypted session cookie. It throws
    // on malformed/tampered cookies, post-`AUTH0_SECRET`-rotation stale
    // cookies, clock-skewed `exp` claims, and transient SDK errors. The
    // *expected* recovery for all of these is the same as "no session":
    // send the user to Universal Login. Surface to the layout as
    // `anonymous` rather than bubbling to Next's error boundary, which has
    // no sign-in affordance.
    console.error("[admin] auth0.getSession() failed:", err);
    return { kind: "anonymous" };
  }
  if (!session) return { kind: "anonymous" };

  const idToken = session.tokenSet.idToken;
  if (!idToken) return { kind: "anonymous" };

  let staff: { roles: string[] } | null;
  try {
    staff = await fetchQuery(api.mutavStaff.useCases.getMyStaff, {}, { token: idToken });
  } catch (err) {
    // Fail closed: errors reading the staff row (Convex transient/network
    // failure) deny access rather than admitting an unverified user. We
    // resolve to `anonymous` (→ login) rather than `not-staff` (→ agency)
    // because a fetch blip leaves staff status unknown — a possibly-staff
    // user must not be bounced out of admin. getMyStaff is a subject-keyed
    // identity read (queryWithAuth), not an aud-bound capability wrapper.
    console.error("[admin] mutavStaff.getMyStaff failed:", err);
    return { kind: "anonymous" };
  }

  if (!staff) return { kind: "not-staff", session };

  return { kind: "staff", session, roles: staff.roles };
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
