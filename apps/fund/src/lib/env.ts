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
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002";
}

/**
 * Convex deployment URL. Public because the browser bundle needs it to
 * construct the `ConvexReactClient`. Returns null when unset so callers
 * can degrade gracefully (e.g. render without Convex provider).
 */
export function getConvexUrl(): string | null {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
}
