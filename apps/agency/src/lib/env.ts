/**
 * Client-side env getters. Only NEXT_PUBLIC_* vars exist in the browser
 * bundle — anything else returns undefined. This is the only file under
 * src/ that's allowed to read `process.env` directly; see CLAUDE.md.
 */

/**
 * Whether to render the testanchor (SEP-24 hosted-UI debugging) card on
 * the public payment picker at `/pay/[publicId]`. Off by default once
 * the Etherfuse Pix on-ramp is live; on for dev/preview when we want to
 * verify SEP-side behavior without touching production payment flow.
 *
 * Toggle: `NEXT_PUBLIC_SHOW_TESTANCHOR=true` (any value coerces to true;
 * undefined or empty string keep it hidden).
 */
export function shouldShowTestanchor(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SHOW_TESTANCHOR);
}

/**
 * App public URL — used by server-side route handlers (e.g. /api/auth/*)
 * when constructing absolute redirect URLs. Falls back to localhost:3000
 * for dev. Production sets `NEXT_PUBLIC_APP_URL` (Vercel exposes it on
 * `VERCEL_URL` too, but we prefer the explicit project-set value).
 */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * Public URL of the tenant-facing pay app (`pay.mutav.finance`), which
 * since the monorepo split owns the `/pay/[publicId]` checkout route.
 * The agency app builds tenant checkout / share links against this
 * origin — a same-origin `/pay/...` path would 404 here. Falls back to
 * the pay app's dev port (3001) for local dev. Production sets
 * `NEXT_PUBLIC_PAY_URL=https://pay.mutav.finance`.
 */
export function getPayUrl(): string {
  return process.env.NEXT_PUBLIC_PAY_URL ?? "http://localhost:3001";
}

/**
 * Server-only base URL used by the Auth0 SDK + our `onCallback` redirect
 * construction. Distinct from `getAppUrl()` (client-facing
 * `NEXT_PUBLIC_APP_URL`): `APP_BASE_URL` is the canonical name the
 * Auth0 v4 SDK reads itself, so we mirror it for consistency.
 * Returns `undefined` in the browser bundle.
 */
export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
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
 * Public Auth0 tenant domain, exposed to the client so the Convex provider
 * can decide whether to wrap with `ConvexProviderWithAuth`. Mirrors the
 * server-side `AUTH0_DOMAIN`. Returns null when unset — the provider then
 * uses bare `ConvexProvider` and every wrapped backend handler throws.
 */
export function getAuth0Domain(): string | null {
  return process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? null;
}
