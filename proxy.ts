import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";

/**
 * Auth0 middleware — intercepts `/auth/login`, `/auth/callback`,
 * `/auth/logout`, `/auth/profile`, `/auth/access-token` and handles the
 * OAuth flow inline. Also injects the session into request context for
 * downstream server components / route handlers.
 *
 * The matcher excludes Next.js asset paths and the `/api/auth/convex-token`
 * route — that route reads the session via `auth0.getSession()` directly
 * and doesn't need the middleware redirect logic to run first.
 */
export async function middleware(request: NextRequest) {
  return auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/auth/convex-token).*)",
  ],
};
