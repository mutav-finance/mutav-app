import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/**
 * The matcher excludes `/api/auth/convex-token` because that route reads
 * the session via `auth0.getSession()` directly and doesn't need the
 * proxy redirect logic to run first.
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
  matcher: ["/((?!_next/static|_next/image|_vercel|api/auth/convex-token|.*\\..*).*)"],
};
