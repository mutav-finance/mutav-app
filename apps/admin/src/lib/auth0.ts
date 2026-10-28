import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { createOnCallback } from "@mutav/app-shell/auth-callback";
import { api } from "@convex/_generated/api";
import { getAppBaseUrl, getConvexUrl } from "@/lib/env";

const TRANSACTION_COOKIE_MAX_AGE_SECONDS = 900;

/**
 * Singleton Auth0 client for apps/admin.
 *
 * The SDK reads tenant config from env vars (`AUTH0_DOMAIN`,
 * `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`,
 * `APP_BASE_URL`) so we don't pass them explicitly. See
 * `apps/admin/src/lib/env.ts` for the inventory.
 *
 * **Authorization model.** Auth0 proves identity only; it does not gate
 * admin access. Authorization lives in Convex: the `mutavStaff` row keyed
 * by the Auth0 subject is the source of truth, and every admin route is
 * fail-closed at `getStaffMember()` in `apps/admin/src/lib/auth.ts` — a
 * user without a staff row is redirected off the admin origin. Any Auth0
 * identity that reaches the callback without a matching staff row simply
 * bounces at the gate; provisioning them a `users` row in `onCallback` is
 * harmless. Staff rows are granted separately (`createStaffRole`, or
 * `bootstrapFirstAdmin` for the genesis case), never from JWT claims.
 *
 * What distinguishes this client from agency's:
 *
 * 1. **Shorter session lifetime.** 12h absolute + 30min inactivity for
 *    staff sessions. SDK enforces these on session-cookie save / rolling
 *    refresh.
 *
 * 2. **Host-Only cookies.** No `Domain=` attribute set anywhere — the
 *    Auth0 v4 SDK's `SessionCookieOptions` and `TransactionCookieOptions`
 *    don't expose a `domain` field, so the cookie is implicitly scoped to
 *    the exact origin (`admin.mutav.finance`). The explicit `sameSite`
 *    + `secure` settings here lock down the rest of the load-bearing
 *    cookie posture.
 */
export const auth0 = new Auth0Client({
  // Nothing in the app reads tokens through /auth/access-token; left on, it
  // hands the Auth0 access token to any same-origin script.
  enableAccessTokenEndpoint: false,
  onCallback: createOnCallback({
    getAppBaseUrl,
    getConvexUrl,
    provisionMutation: api.users.useCases.getOrCreateByIdentity,
  }),
  session: {
    rolling: true,
    absoluteDuration: 60 * 60 * 12,
    inactivityDuration: 60 * 30,
    cookie: {
      // Must be "lax" (not "strict"): the session cookie is Set-Cookie'd on
      // the /auth/callback response, and the browser immediately follows a
      // 307 to /pt-BR (or context.returnTo). Chrome treats that follow-up
      // as still-cross-site because the initiating navigation was Auth0's
      // cross-site redirect; strict cookies get dropped on the first
      // request to the layout, getStaffMember() sees no session, redirects
      // to /auth/login, and the OAuth flow restarts — an infinite loop
      // that only breaks when transaction-cookie pileup eventually fails
      // state validation. Lax cookies survive the follow-up nav. Host-Only
      // is still achieved because the SDK does not set a Domain attribute.
      sameSite: "lax",
      // `secure` defaults to true when APP_BASE_URL is https. Lock it
      // explicitly so a misconfigured preview env can't accidentally
      // serve the cookie over http.
      secure: true,
    },
  },
  transactionCookie: {
    // Must be "lax": the OAuth callback is a cross-site top-level navigation
    // from the Auth0 tenant domain back to admin.mutav.finance/auth/callback.
    // Browsers strip SameSite=strict cookies on cross-site navigations, so a
    // strict transaction cookie set at /auth/login never reaches the callback
    // handler — the SDK then throws InvalidStateError.
    sameSite: "lax",
    secure: true,
    maxAge: TRANSACTION_COOKIE_MAX_AGE_SECONDS,
  },
});
