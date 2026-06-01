import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { getAuth0Connection } from "@/lib/env";

/**
 * Singleton Auth0 client for apps/admin.
 *
 * The SDK reads tenant config from env vars (`AUTH0_DOMAIN`,
 * `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`,
 * `APP_BASE_URL`) so we don't pass them explicitly. See
 * `apps/admin/src/lib/env.ts` for the inventory.
 *
 * Three load-bearing pieces that distinguish this client from agency's:
 *
 * 1. **Separate connection.** `authorizationParameters.connection` pins
 *    Universal Login to the `mutavStaff` connection (spec § Section 7).
 *    The connection is administratively distinct from the agency-staff
 *    connection: mandatory MFA at the Auth0 rule level, IP allowlist,
 *    disabled self-signup. Provisioning the connection itself is a
 *    downstream Auth0-dashboard step (Daisy); this code just routes to it.
 *
 * 2. **Shorter session lifetime.** Spec § Section 5 targets 12h absolute
 *    + 30min inactivity for staff sessions. Defaults below; tune in the
 *    admin spec once it lands.
 *
 * 3. **Host-Only cookies.** No `Domain=` attribute set anywhere — the
 *    Auth0 v4 SDK's `SessionCookieOptions` and `TransactionCookieOptions`
 *    don't expose a `domain` field, so the cookie is implicitly scoped to
 *    the exact origin (`admin.mutav.finance`). The explicit `sameSite`
 *    + `secure` settings here lock down the rest of the load-bearing
 *    cookie posture (spec § Section 1).
 *
 * The Convex bridge that exists in apps/agency's Auth0 client
 * (`onCallback` → `getOrCreateByIdentity`) is intentionally NOT mirrored
 * here. The `mutavStaff` Convex domain doesn't exist yet — it's an A1
 * milestone. When the domain lands, this client gains an `onCallback`
 * hook that provisions a `mutavStaff` row keyed off the Auth0 `sub` claim
 * and gated on the user's Auth0 group membership.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: {
    connection: getAuth0Connection(),
  },
  // Spec § Section 5: shorter session lifetime for staff. 12h absolute,
  // 30min inactivity. SDK enforces these on session-cookie save / rolling
  // refresh.
  session: {
    rolling: true,
    absoluteDuration: 60 * 60 * 12,
    inactivityDuration: 60 * 30,
    cookie: {
      // `__Host-` prefix would enforce Host-Only at the browser level too,
      // but the SDK rejects custom names containing `__Host-` because it
      // also mounts the cookie on path `/`. Host-Only is still achieved
      // because no `Domain=` attribute is set by the SDK.
      sameSite: "strict",
      // `secure` defaults to true when APP_BASE_URL is https. Lock it
      // explicitly so a misconfigured preview env can't accidentally
      // serve the cookie over http.
      secure: true,
    },
  },
  transactionCookie: {
    sameSite: "strict",
    secure: true,
  },
});
