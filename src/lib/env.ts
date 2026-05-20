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
 * Public Auth0 tenant domain, exposed to the client so the Convex provider
 * can decide whether to wrap with `ConvexProviderWithAuth` (Auth0 wired)
 * or fall back to bare `ConvexProvider` (dev mode, dev-user fallback).
 *
 * Mirrors the server-side `AUTH0_DOMAIN`; both must be set for prod.
 * Returns null when unset — the client provider then operates in
 * dev-bypass mode.
 */
export function getAuth0Domain(): string | null {
  return process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? null;
}
