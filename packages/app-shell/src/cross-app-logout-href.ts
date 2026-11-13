/**
 * Client-safe half of the cross-app logout (see `cross-app-logout.ts` for the
 * flow). No `next/server` import, so client components can build the href.
 */

/** First hop of the cross-app logout, served by `createAuthProxy`. */
export const CLEAR_SESSION_PATH = "/auth/clear-session";

/** Path the Auth0 SDK serves its logout on (SDK default). */
export const LOGOUT_PATH = "/auth/logout";

/** Absolute URL of `path` on the app at `baseUrl`. */
export function appUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

/**
 * The logout href an app renders: the sibling app's clear-session route, which
 * hands back to this app's own SDK logout.
 */
export function crossAppLogoutHref(siblingBaseUrl: string): string {
  return appUrl(siblingBaseUrl, CLEAR_SESSION_PATH);
}
