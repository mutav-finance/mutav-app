import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { routing } from "@mutav/i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/**
 * Composite proxy: Auth0 SDK middleware (handles `/auth/login`,
 * `/auth/logout`, `/auth/callback`, session refresh) layered on top of
 * the next-intl locale middleware.
 *
 * Order matters — Auth0 runs first so the session cookie is on the
 * response before the locale middleware can override headers. Cookies
 * from the Auth0 response are folded into the i18n response when the
 * request doesn't hit an auth route.
 *
 * The matcher excludes `/api/*` because future API routes (Convex token
 * bridge, internal handlers) read the session via `auth0.getSession()`
 * directly and don't need the proxy redirect logic to run.
 */
export async function proxy(request: NextRequest) {
  const authRes = await auth0.middleware(request);

  if (request.nextUrl.pathname.startsWith("/auth/")) {
    return authRes;
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return authRes;
  }

  const intlRes = handleI18nRouting(request);

  for (const cookie of authRes.cookies.getAll()) {
    intlRes.cookies.set(cookie.name, cookie.value);
  }

  return intlRes;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_vercel|.*\\..*).*)"],
};
