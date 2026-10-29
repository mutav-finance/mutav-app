import { splitCookiesString } from "next/dist/server/web/utils";
import type { NextResponse } from "next/server";

/**
 * Headers the Auth0 SDK sets alongside a session cookie so no CDN or shared
 * cache stores the response. A single value each, so they are set, not
 * appended.
 */
const NO_STORE_HEADERS = ["cache-control", "pragma", "expires"] as const;

/**
 * The one internal Next.js header that is carried. `response.cookies.set`
 * writes every cookie of the response into it (serialized, comma-joined), and
 * Next merges it into the request cookies that this same request's Server
 * Components read. Without it a refresh in the proxy reaches the browser but
 * the render in that request still sees the old session.
 */
const MIDDLEWARE_SET_COOKIE = "x-middleware-set-cookie";

/**
 * Carries what the Auth0 middleware wrote onto the response the proxy returns:
 * every `Set-Cookie` header byte for byte, plus the no-store headers. Copying
 * cookies through the cookies API by name and value drops HttpOnly, Secure,
 * SameSite, Max-Age and Path, and turns chunk deletions into empty cookies.
 *
 * On a response that renders this request (anything but a redirect),
 * `x-middleware-set-cookie` is merged too, so the render reads the refreshed
 * session. A redirect never renders, so it never gets it.
 *
 * `x-middleware-next` is deliberately never carried: on a next-intl redirect
 * it would make Next.js run the route anyway.
 */
export function carryAuthHeaders({
  from,
  to,
}: {
  from: NextResponse;
  to: NextResponse;
}): NextResponse {
  for (const header of from.headers.getSetCookie()) {
    to.headers.append("set-cookie", header);
  }
  for (const name of NO_STORE_HEADERS) {
    const value = from.headers.get(name);
    if (value !== null) to.headers.set(name, value);
  }
  if (!isRedirect(to)) mergeMiddlewareSetCookie({ from, to });
  return to;
}

function isRedirect(response: NextResponse): boolean {
  return response.status >= 300 && response.status < 400;
}

/**
 * Same format Next writes (`stringifyCookie` values joined by ",") and reads
 * (`splitCookiesString`, which keeps the comma inside `Expires` intact).
 * Deduped by cookie name; `from` wins, as the later `Set-Cookie` would.
 */
function mergeMiddlewareSetCookie({ from, to }: { from: NextResponse; to: NextResponse }): void {
  const incoming = from.headers.get(MIDDLEWARE_SET_COOKIE);
  if (incoming === null) return;

  const byName = new Map<string, string>();
  for (const cookie of splitCookiesString(to.headers.get(MIDDLEWARE_SET_COOKIE) ?? "")) {
    byName.set(cookieName(cookie), cookie);
  }
  for (const cookie of splitCookiesString(incoming)) {
    byName.set(cookieName(cookie), cookie);
  }
  to.headers.set(MIDDLEWARE_SET_COOKIE, [...byName.values()].join(","));
}

function cookieName(serialized: string): string {
  const end = serialized.indexOf("=");
  return (end === -1 ? serialized : serialized.slice(0, end)).trim();
}
