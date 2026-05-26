import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getAppBaseUrl, getConvexUrl } from "@/lib/env";

/**
 * Singleton Auth0 client for the Next.js side.
 *
 * The SDK reads tenant config from env vars (`AUTH0_DOMAIN`,
 * `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`,
 * `APP_BASE_URL`) so we don't pass them explicitly. See
 * [`docs/auth.md`](../../docs/auth.md) for the env-var inventory.
 *
 * The `onCallback` hook is the first-login provisioning point: when a
 * fresh OAuth callback completes, we issue a Convex `getOrCreateByIdentity`
 * mutation so the Convex `users` row exists before the user lands on
 * any authenticated route. Provisioning failures don't block the login —
 * the client provider observes `getMe` returning `null` and retries
 * provisioning client-side as a fallback. The result is no race window
 * where the user can land on a page that needs `ctx.user` to exist
 * before the row is in place.
 *
 * The hook must return a `NextResponse` — typically the SDK-default
 * redirect to the `returnTo` URL. We compose that redirect ourselves
 * after the side-effect.
 */
export const auth0 = new Auth0Client({
  async onCallback(error, context, session) {
    const baseUrl = getAppBaseUrl();

    if (error) {
      console.error("[auth0.onCallback] error:", {
        name: error.name,
        message: error.message,
        code: (error as { code?: string }).code,
        cause: (error as { cause?: unknown }).cause,
      });
      const causeMsg = (error as { cause?: { message?: string } }).cause?.message ?? error.message;
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(causeMsg)}`, baseUrl),
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
        // Log and continue — `WorkspaceProvider` retries provisioning
        // client-side when `getMe` returns null after login.
        console.error("[auth0.onCallback] Convex provisioning failed:", err);
      }
    }

    return NextResponse.redirect(new URL(context.returnTo ?? "/", baseUrl));
  },
});
