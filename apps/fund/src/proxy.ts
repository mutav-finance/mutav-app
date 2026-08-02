import createMiddleware from "next-intl/middleware";
import { routing } from "@mutav/i18n/routing";

/**
 * Fund carries no Auth0, so the proxy reduces to the next-intl locale
 * middleware. No session cookies are set or read here. Wallet-as-identity
 * (when the wallet-kit spec lands) is client-side, so no proxy involvement
 * is expected.
 */
export const proxy = createMiddleware(routing);

// Excludes real asset extensions, NOT every dotted path — see the same comment
// in apps/agency/src/proxy.ts and docs/architecture/nav-shell-audit.md § 5.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_vercel|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|txt|xml|json|webmanifest|map|mp4|webm|pdf|csv)$).*)",
  ],
};
