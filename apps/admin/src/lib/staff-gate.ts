import type { SessionData } from "@auth0/nextjs-auth0/types";
import { classifyConvexError, type ConvexErrorKind } from "@mutav/app-shell/convex-error-kind";
import type { FreshIdToken } from "@mutav/app-shell/fresh-id-token";

/**
 * Four-way result of the admin staff gate, so the layout can route each
 * outcome distinctly instead of collapsing them to `null`:
 *
 * - `anonymous` — no usable session (signed out, malformed/stale cookie, or
 *   an expired ID token). Layout → Universal Login.
 * - `unavailable` — signed in, but the staff read failed (Convex outage,
 *   network). Staff status is unknown, so the layout neither admits the user
 *   nor sends them to login: login would complete silently via SSO and the
 *   same read would fail again, looping through Auth0. Layout → `/unavailable`.
 * - `not-staff` — authenticated, but no `mutavStaff` row. Carries the
 *   `session` so the layout can bounce to the AGENCY app ORIGIN rather than
 *   loop back to login (loop-freedom).
 * - `staff` — authenticated and staff. Carries `session`, `roles` and the
 *   fresh ID `token` pages pass to Convex as the bearer credential.
 */
export type StaffGateResult =
  | { kind: "anonymous" }
  | { kind: "unavailable" }
  | { kind: "not-staff"; session: SessionData }
  | { kind: "staff"; session: SessionData; roles: string[]; token: string };

/** The gate step a failure is logged under. */
export type StaffGateStep = "getSession" | "getMyStaff";

/** I/O of the gate, injected so its classification is unit-testable. */
export type StaffGateDeps = {
  getSession: () => Promise<SessionData | null>;
  readToken: () => Promise<FreshIdToken>;
  /** `null` when the subject has no `mutavStaff` row. Throws on failure. */
  fetchStaff: (token: string) => Promise<{ roles: string[] } | null>;
  /**
   * Receives the error name, plus the classified kind for the Convex read.
   * Never a message: messages and causes can carry identity data.
   */
  log: (step: StaffGateStep, fields: { name: string; kind?: ConvexErrorKind }) => void;
};

/**
 * Next signals control flow by throwing tagged errors: `DYNAMIC_SERVER_USAGE`
 * is how a `headers()` read bails a route out of static generation, and
 * `NEXT_REDIRECT` / `NEXT_NOT_FOUND` are how the navigation APIs unwind. The
 * fail-closed catches below must let those through — swallowing them turns
 * Next's "render this dynamically" into a spurious result and fills every
 * build log with stack traces that describe no failure.
 */
function isNextControlFlowSignal(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("digest" in err)) return false;
  const { digest } = err;
  if (typeof digest !== "string") return false;
  return digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_");
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Server-side staff gate with its I/O injected. Fail-closed at each step: no
 * failure ever resolves to `staff`.
 *
 * 1. **Session present.** No session, or a decrypt failure → `anonymous`.
 * 2. **Fresh ID token.** Anything but a usable token → `anonymous`.
 * 3. **Staff in Convex.** A throw → `unavailable`; no row → `not-staff`;
 *    a row → `staff`.
 */
export async function getStaffMemberWith(deps: StaffGateDeps): Promise<StaffGateResult> {
  let session: SessionData | null;
  try {
    session = await deps.getSession();
  } catch (err) {
    // `auth0.getSession()` decrypts the encrypted session cookie. It throws
    // on malformed/tampered cookies, post-`AUTH0_SECRET`-rotation stale
    // cookies, clock-skewed `exp` claims, and transient SDK errors. The
    // *expected* recovery for all of these is the same as "no session":
    // send the user to Universal Login. Surface to the layout as
    // `anonymous` rather than bubbling to Next's error boundary, which has
    // no sign-in affordance.
    if (isNextControlFlowSignal(err)) throw err;
    deps.log("getSession", { name: errorName(err) });
    return { kind: "anonymous" };
  }
  if (!session) return { kind: "anonymous" };

  const freshIdToken = await deps.readToken();
  if (freshIdToken.kind !== "token") return { kind: "anonymous" };
  const { token } = freshIdToken;

  let staff: { roles: string[] } | null;
  try {
    staff = await deps.fetchStaff(token);
  } catch (err) {
    // Fail closed: a failed staff read never admits the user. It is
    // `unavailable` rather than `anonymous` (→ login loop via SSO) or
    // `not-staff` (→ a possibly-staff user bounced out of admin). getMyStaff
    // is a subject-keyed identity read (queryWithAuth), not an aud-bound
    // capability wrapper.
    if (isNextControlFlowSignal(err)) throw err;
    // Logged by kind so an outage reads apart from a misconfigured deployment
    // (`auth_rejected`); routing stays `unavailable` either way, because
    // login would loop on a misconfiguration.
    deps.log("getMyStaff", { name: errorName(err), kind: classifyConvexError(err) });
    return { kind: "unavailable" };
  }

  if (!staff) return { kind: "not-staff", session };

  return { kind: "staff", session, roles: staff.roles, token };
}
