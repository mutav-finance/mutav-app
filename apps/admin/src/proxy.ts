import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getIdTokenRefreshWindowSeconds } from "@/lib/env";
import { routing } from "@mutav/i18n/routing";
import { createAuthProxy } from "@mutav/app-shell/auth-proxy";

const authProxy = createAuthProxy({
  auth0,
  handleI18nRouting: createMiddleware(routing),
  getRefreshWindowSeconds: getIdTokenRefreshWindowSeconds,
});

/**
 * The matcher excludes `/api/auth/convex-token` because that route reads
 * the session via `auth0.getSession()` directly and doesn't need the
 * proxy redirect logic to run first.
 */
export async function proxy(request: NextRequest) {
  return authProxy(request);
}

// Excludes real asset extensions, NOT every dotted path — see the same comment
// in apps/agency/src/proxy.ts and docs/architecture/nav-shell-audit.md § 5.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_vercel|api/auth/convex-token|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|txt|xml|json|webmanifest|map|mp4|webm|pdf|csv)$).*)",
  ],
};
