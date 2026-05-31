import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Fund carries no Auth0 (spec § Section 1 load-bearing constraint), so the
 * proxy reduces to the next-intl locale middleware. No session cookies are
 * set or read here. Wallet-as-identity (when the wallet-kit spec lands)
 * is client-side, so no proxy involvement is expected.
 */
export const proxy = createMiddleware(routing);

export const config = {
  matcher: ["/((?!_next/static|_next/image|_vercel|.*\\..*).*)"],
};
