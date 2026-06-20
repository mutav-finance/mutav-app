/**
 * Client-side env getters for apps/pay. Only NEXT_PUBLIC_* vars exist in
 * the browser bundle — anything else returns undefined. This is the only
 * file under src/ that's allowed to read `process.env` directly; see
 * CLAUDE.md.
 *
 * Pay is origin-isolated and carries NO Auth0 — by design (spec § Section 1
 * load-bearing constraint). The Auth0 getters present in apps/agency are
 * intentionally absent here.
 */

/**
 * Whether to render the testanchor (SEP-24 hosted-UI debugging) card on
 * the public payment picker at `/pay/[publicId]`. Off by default once the
 * Etherfuse Pix on-ramp is live; on for dev/preview when we want to verify
 * SEP-side behavior without touching production payment flow.
 *
 * Toggle: `NEXT_PUBLIC_SHOW_TESTANCHOR=true` (any value coerces to true;
 * undefined or empty string keep it hidden).
 */
export function shouldShowTestanchor(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SHOW_TESTANCHOR);
}

/**
 * App public URL — used by server-side route handlers when constructing
 * absolute redirect URLs. Falls back to localhost:3001 for dev (apps/pay
 * runs on a distinct port from apps/agency to allow side-by-side local
 * development). Production sets `NEXT_PUBLIC_APP_URL`.
 */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
}

/**
 * Convex deployment URL. Public because the browser bundle needs it to
 * construct the `ConvexReactClient`. Returns null when unset so callers
 * can degrade gracefully (e.g. render without Convex provider).
 */
export function getConvexUrl(): string | null {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
}

/**
 * Raw `NEXT_PUBLIC_STELLAR_NETWORK` value (e.g. `"public"`), or undefined when
 * unset. Mapped to a `ChainNetwork` by `getStellarNetwork()` in
 * `lib/stellar/network.ts` — the env read stays here per the boundary rule.
 */
export function getStellarNetworkEnv(): string | undefined {
  return process.env.NEXT_PUBLIC_STELLAR_NETWORK;
}
