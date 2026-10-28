import type { NextResponse } from "next/server";

/**
 * Carries every `Set-Cookie` header from one middleware response onto the one
 * the proxy returns, byte for byte. Copying through the cookies API by name
 * and value drops HttpOnly, Secure, SameSite, Max-Age and Path, and turns
 * Auth0's chunk deletions into empty cookies; the raw headers keep all of it.
 */
export function carrySetCookies({
  from,
  to,
}: {
  from: NextResponse;
  to: NextResponse;
}): NextResponse {
  for (const header of from.headers.getSetCookie()) {
    to.headers.append("set-cookie", header);
  }
  return to;
}
