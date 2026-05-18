import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// ─── next-intl locale routing ─────────────────────────────────────────────────
//
// Handles locale detection and URL prefix routing (e.g. /en/...).
// next-intl's server-side integration (via createNextIntlPlugin in next.config.ts)
// covers server components; this middleware covers redirects and locale cookies.
//
// TODO(auth0): when @auth0/nextjs-auth0 is installed, compose this with
// `withMiddlewareAuthRequired` for protected routes. See the Auth0 integration
// plan in src/app/api/auth/callback/route.ts for routing logic details.

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match all paths except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
