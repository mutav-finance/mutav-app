import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { createOnCallback } from "@mutav/app-shell/auth-callback";
import { api } from "@convex/_generated/api";
import { getAppBaseUrl, getConvexUrl } from "@/lib/env";

const TRANSACTION_COOKIE_MAX_AGE_SECONDS = 900;

/**
 * Singleton Auth0 client for the Next.js side.
 *
 * The SDK reads tenant config from env vars (`AUTH0_DOMAIN`,
 * `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`,
 * `APP_BASE_URL`) so we don't pass them explicitly. See
 * [`docs/auth.md`](../../docs/auth.md) for the env-var inventory.
 *
 * `onCallback` provisions the Convex `users` row on first login, so it
 * exists before the user lands on any authenticated route. If that fails,
 * `WorkspaceProvider` retries provisioning client-side when `getMe` returns
 * null.
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
  // `secure` is left to the SDK: it is forced on when APP_BASE_URL is https,
  // and pinning it would break local dev on http://localhost.
  session: {
    cookie: {
      // Must be "lax", never "strict": the session cookie is set on the
      // /auth/callback response that follows Auth0's cross-site redirect.
      // Strict cookies are withheld on that follow-up navigation, the layout
      // sees no session, redirects to /auth/login, and login loops.
      sameSite: "lax",
    },
  },
  transactionCookie: {
    // Must be "lax": a strict transaction cookie never reaches the cross-site
    // callback navigation, and the SDK throws InvalidStateError.
    sameSite: "lax",
    maxAge: TRANSACTION_COOKIE_MAX_AGE_SECONDS,
  },
});
