/**
 * Client-side env getters for apps/fund. Only NEXT_PUBLIC_* vars exist in
 * the browser bundle — anything else returns undefined. This is the only
 * file under src/ that's allowed to read `process.env` directly; see
 * CLAUDE.md.
 *
 * Fund is origin-isolated and carries NO Auth0. Wallet-as-identity arrives
 * with the wallet-kit selection spec; no wallet-kit env getters live here
 * yet.
 */

/**
 * App public URL — used by server-side route handlers when constructing
 * absolute redirect URLs. Falls back to localhost:3002 for dev (apps/fund
 * runs on a distinct port from apps/agency:3000 and apps/pay:3001 to
 * allow side-by-side local development). Production sets
 * `NEXT_PUBLIC_APP_URL`.
 */
/**
 * Guard for URL vars whose dev fallback is a localhost origin. An unset
 * var used to fall through silently and ship `http://localhost:PORT` to
 * real users — a dead redirect that reads as an app bug rather than the
 * config bug it is. Fail loud instead.
 *
 * `NEXT_PUBLIC_*` reads are inlined at build time, so an unset var fails
 * the production build instead of waiting for a user to hit the route.
 * Dev and preview keep the port fallback, so local dev needs no `.env`.
 */
export function requireUrlInProduction(
  value: string | undefined,
  varName: string,
  devFallback: string,
): string {
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${varName} must be set in production — refusing to fall back to ${devFallback}`,
    );
  }
  return devFallback;
}

export function getAppUrl(): string {
  return requireUrlInProduction(
    process.env.NEXT_PUBLIC_APP_URL,
    "NEXT_PUBLIC_APP_URL",
    "http://localhost:3002",
  );
}

/**
 * Convex deployment URL. Public because the browser bundle needs it to
 * construct the `ConvexReactClient`. Returns null when unset so callers
 * can degrade gracefully (e.g. render without Convex provider).
 */
export function getConvexUrl(): string | null {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
}
