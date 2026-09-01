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
 * Guard for URL vars whose dev fallback is a localhost origin. An unset
 * var used to fall through silently and ship `http://localhost:PORT` to
 * real users — a dead redirect that reads as an auth bug rather than the
 * config bug it is. Fail loud instead; mirrors the fail-loud posture of
 * `getStellarRpcUrl` in apps/admin.
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

/**
 * App public URL — used by server-side route handlers (e.g. /api/auth/*)
 * when constructing absolute redirect URLs. Falls back to localhost:3000
 * for dev. Production sets `NEXT_PUBLIC_APP_URL` (Vercel exposes it on
 * `VERCEL_URL` too, but we prefer the explicit project-set value).
 */
export function getAppUrl(): string {
  return requireUrlInProduction(
    process.env.NEXT_PUBLIC_APP_URL,
    "NEXT_PUBLIC_APP_URL",
    "http://localhost:3000",
  );
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
  return requireUrlInProduction(
    process.env.NEXT_PUBLIC_PAY_URL,
    "NEXT_PUBLIC_PAY_URL",
    "http://localhost:3001",
  );
}

/**
 * Public URL of the staff-facing admin app (`admin.mutav.finance`). The
 * agency post-login guard sends a Mutav-org user with no active agency
 * here (cross-app, cross-origin redirect — Phase D). Falls back to the
 * admin dev port (3003) for local dev. Production sets
 * `NEXT_PUBLIC_ADMIN_URL=https://admin.mutav.finance`.
 */
export function getAdminUrl(): string {
  return requireUrlInProduction(
    process.env.NEXT_PUBLIC_ADMIN_URL,
    "NEXT_PUBLIC_ADMIN_URL",
    "http://localhost:3003",
  );
}

/**
 * Server-only base URL used by the Auth0 SDK + our `onCallback` redirect
 * construction. Distinct from `getAppUrl()` (client-facing
 * `NEXT_PUBLIC_APP_URL`): `APP_BASE_URL` is the canonical name the
 * Auth0 v4 SDK reads itself, so we mirror it for consistency.
 *
 * Server-only: `APP_BASE_URL` carries no `NEXT_PUBLIC_` prefix, so it is
 * absent from the browser bundle. Every caller is server-side (see
 * `lib/auth0.ts`); calling this from a client component would trip the
 * production guard, which is the intended signal.
 */
export function getAppBaseUrl(): string {
  return requireUrlInProduction(process.env.APP_BASE_URL, "APP_BASE_URL", "http://localhost:3000");
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
