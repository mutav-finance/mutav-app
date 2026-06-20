import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getAppBaseUrl, getAuth0Connection, getConvexUrl } from "@/lib/env";

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
 * The `onCallback` hook is the first-login provisioning point, mirroring
 * apps/agency's client: it provisions the Convex `users` row
 * (`getOrCreateByIdentity`) and then additively grants any staff roles
 * carried in the Auth0 roles claim (`mutavStaff.syncFromIdentity`). It
 * fails OPEN — provisioning errors are caught and logged, login still
 * completes — because the real staff gate is downstream in `getStaffMember()`
 * (`lib/auth.ts`), which reads the resulting `mutavStaff` row and redirects
 * non-staff users. `syncFromIdentity` is aud-bound to the admin Auth0 client
 * and fails closed until that client exists; the catch swallows that too.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: {
    connection: getAuth0Connection(),
  },
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
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(causeMsg ?? error.message)}`, baseUrl),
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
          await convex.mutation(api.mutavStaff.useCases.syncFromIdentity, {});
        }
      } catch (err) {
        // Fail OPEN: log and continue. The staff gate in `getStaffMember()`
        // (`lib/auth.ts`) is the real defense — it reads the `mutavStaff`
        // row and redirects non-staff users. `syncFromIdentity` is aud-bound
        // to the admin Auth0 client and fails closed until that client
        // exists; that throw lands here and is swallowed too.
        console.error("[auth0.onCallback] Convex provisioning failed:", err);
      }
    }

    return NextResponse.redirect(new URL(context.returnTo ?? "/", baseUrl));
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
