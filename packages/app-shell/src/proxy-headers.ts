import type { NextResponse } from "next/server";

/**
 * Headers the Auth0 SDK sets alongside a session cookie so no CDN or shared
 * cache stores the response. A single value each, so they are set, not
 * appended.
 */
const NO_STORE_HEADERS = ["cache-control", "pragma", "expires"] as const;

/**
 * Carries what the Auth0 middleware wrote onto the response the proxy returns:
 * every `Set-Cookie` header byte for byte, plus the no-store headers. Copying
 * cookies through the cookies API by name and value drops HttpOnly, Secure,
 * SameSite, Max-Age and Path, and turns chunk deletions into empty cookies.
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
  return to;
}
