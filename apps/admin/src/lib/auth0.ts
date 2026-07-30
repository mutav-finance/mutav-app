import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getAppBaseUrl, getConvexUrl } from "@/lib/env";

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
 * bounces at the gate; provisioning them a `users` row here is harmless.
 *
 * Two load-bearing pieces that distinguish this client from agency's:
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
 *
 * The `onCallback` hook is the first-login provisioning point, mirroring
 * apps/agency's client: it provisions the Convex `users` row
 * (`getOrCreateByIdentity`) and that's it. Staff rows are granted separately
 * — either through the admin panel's `createStaffRole` mutation, or via the
 * internal-only `bootstrapFirstAdmin` for the genesis case. There is no
 * claim-based auto-provisioning from the JWT.
 *
 * Fails OPEN — provisioning errors are caught and logged, login still
 * completes — because the real staff gate is downstream in `getStaffMember()`
 * (`lib/auth.ts`), which reads the `mutavStaff` row and redirects non-staff
 * users off the admin origin.
 */
export const auth0 = new Auth0Client({
  async onCallback(error, context, session) {
    const baseUrl = getAppBaseUrl();

    if (error) {
      // `error` is `SdkError | null` per the SDK signature — `name`, `code`,
      // `message`, `cause` are all on the prototype chain (SdkError extends
      // Error). `cause` is `unknown` per Error.cause; narrow with a type
      // guard before reading message.
      const cause = error.cause;
      const causeMsg =
        cause instanceof Error
          ? cause.message
          : typeof cause === "object" && cause !== null && "message" in cause
            ? String(cause.message)
            : null;
      console.error("[auth0.onCallback] error:", {
        name: error.name,
        message: error.message,
        code: error.code,
        cause,
      });
      // Redirect errors to /auth/logout, NOT /auth/login: Auth0 SDK v4 will
      // immediately re-enter the login flow on /auth/login and, if the
      // upstream failure is deterministic (e.g. invalid state, misconfigured
      // callback URL), loop indefinitely. /auth/logout clears the transaction
      // cookie and lands the user on a terminal state.
      return NextResponse.redirect(
        new URL(`/auth/logout?error=${encodeURIComponent(causeMsg ?? error.message)}`, baseUrl),
      );
    }

    if (session) {
      try {
        const convexUrl = getConvexUrl();
        const idToken = session.tokenSet.idToken;
        if (convexUrl && idToken) {
          const convex = new ConvexHttpClient(convexUrl);
          convex.setAuth(idToken);
          await convex.mutation(api.users.useCases.getOrCreateByIdentity, {});
        }
      } catch (err) {
        // Fail OPEN: log and continue. The staff gate in `getStaffMember()`
        // (`lib/auth.ts`) is the real defense — it reads the `mutavStaff`
        // row and redirects non-staff users.
        console.error("[auth0.onCallback] Convex provisioning failed:", err);
      }
    }

    return NextResponse.redirect(new URL(context.returnTo ?? "/", baseUrl));
  },
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
    // Must be "lax" (not "strict"): the OAuth callback is a cross-site
    // top-level navigation from the Auth0 tenant domain back to
    // admin.mutav.finance/auth/callback. Browsers strip SameSite=strict
    // cookies on cross-site navigations, so a strict transaction cookie
    // set at /auth/login never reaches the callback handler — the SDK
    // then throws InvalidStateError and onCallback triggers the
    // /auth/logout fail-safe. The session cookie above stays "strict"
    // because it is set post-callback and only serves same-site requests.
    sameSite: "lax",
    secure: true,
  },
});
