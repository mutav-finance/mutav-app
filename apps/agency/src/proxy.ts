import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { routing } from "@mutav/i18n/routing";

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

// Excludes real asset extensions, NOT every dotted path. A blanket `.*\..*`
// let `/nope.php` skip the rewrite, so `[locale]` matched the dotted segment
// itself and the root layout's `hasLocale` guard threw notFound() from the very
// segment that owns [locale]/not-found.tsx — Next's builtin 404, unbranded.
// See docs/architecture/nav-shell-audit.md § 5.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_vercel|api/auth/convex-token|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|txt|xml|json|webmanifest|map|mp4|webm|pdf|csv)$).*)",
  ],
};
