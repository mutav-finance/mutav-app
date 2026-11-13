import { NextResponse, type NextRequest } from "next/server";
import { CLEAR_SESSION_PATH, LOGOUT_PATH, appUrl } from "./cross-app-logout-href";

export { CLEAR_SESSION_PATH };

/**
 * Cross-app logout. The agency and admin apps share one Auth0 tenant and
 * client, but each keeps its own host-only session cookie (ADR 0003). The
 * SDK's `/auth/logout` clears only the cookie of the app it runs on, so
 * logging out of one app left the other signed in as the previous user, and
 * switching user bounced between the two apps.
 *
 * Each app's logout link therefore starts on the OTHER app:
 *
 *   A link → B /auth/clear-session   (B drops its cookie)
 *          → A /auth/logout          (SDK: A drops its cookie, ends the Auth0 session)
 *          → A root                  (login form)
 *
 * The redirect target comes from trusted env, never from the request, so the
 * route cannot be used as an open redirect.
 */

/** `__session` is the SDK's cookie; `appSession` its legacy name. Both chunk as `<name>__<n>`. */
const SESSION_COOKIE_NAMES = ["__session", "appSession"] as const;

function isSessionCookie(name: string): boolean {
  return SESSION_COOKIE_NAMES.some((base) => name === base || name.startsWith(`${base}__`));
}

/**
 * Drops this app's session cookies and redirects to the sibling app's SDK
 * logout. Only cookies the browser sent are deleted, so a signed-out visit is a
 * plain redirect.
 */
export function clearSessionResponse(request: NextRequest, siblingBaseUrl: string): NextResponse {
  const response = NextResponse.redirect(appUrl(siblingBaseUrl, LOGOUT_PATH), 303);
  for (const { name } of request.cookies.getAll()) {
    if (isSessionCookie(name)) response.cookies.delete({ name, path: "/" });
  }
  response.headers.set("cache-control", "no-store");
  return response;
}
