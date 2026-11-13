import { NextRequest, type NextResponse } from "next/server";
import { errorCode, errorCodeOrName, errorName } from "./error-fields";
import { nowInSeconds, type SessionLike } from "./fresh-id-token";
import { idTokenExpiresAt } from "./id-token";
import { CLEAR_SESSION_PATH, clearSessionResponse } from "./cross-app-logout";
import { carryAuthHeaders } from "./proxy-headers";
import { RETURN_TO_HEADER } from "./return-to";

export interface AuthProxyAuth {
  middleware(request: NextRequest): Promise<NextResponse>;
  getSession(request: NextRequest): Promise<SessionLike | null>;
  getAccessToken(
    request: NextRequest,
    response: NextResponse,
    options: { refresh: true },
  ): Promise<unknown>;
}

function isAuthOrApiPath(pathname: string): boolean {
  return pathname.startsWith("/auth/") || pathname.startsWith("/api/");
}

/**
 * Auth0 runs first; `/auth/*` and `/api/*` get its response untouched, and
 * every other request folds the auth headers into the next-intl response.
 *
 * The ID token is refreshed here, ahead of expiry, because the proxy is the one
 * place that can write the refreshed session onto the response for Server
 * Components, which cannot persist cookies themselves. A failed refresh never
 * blocks the request: the page still renders and Convex judges the old token.
 *
 * `carryAuthHeaders` carries raw `Set-Cookie` (for the browser) and, unless the
 * response redirects, the one internal header `x-middleware-set-cookie` (for
 * this request): Next merges that header into the cookies the same request's
 * Server Components read, so the render sees the refreshed session rather than
 * the one the browser sent. `x-middleware-next` is never carried.
 *
 * next-intl forwards the request headers it is given to the render, which is
 * how `RETURN_TO_HEADER` reaches a layout's login redirect.
 */
export function createAuthProxy({
  auth0,
  handleI18nRouting,
  getRefreshWindowSeconds,
  getSiblingAppUrl,
  now = nowInSeconds,
}: {
  auth0: AuthProxyAuth;
  handleI18nRouting: (request: NextRequest) => NextResponse;
  getRefreshWindowSeconds: () => number;
  /**
   * Base URL of the other signed-in app. Serves `CLEAR_SESSION_PATH`, the first
   * hop of the cross-app logout (see `cross-app-logout.ts`). Read per request,
   * so a missing production env var fails the request, not the module load.
   */
  getSiblingAppUrl: () => string;
  now?: () => number;
}): (request: NextRequest) => Promise<NextResponse> {
  return async function proxy(request) {
    if (request.nextUrl.pathname === CLEAR_SESSION_PATH) {
      return clearSessionResponse(request, getSiblingAppUrl());
    }

    const authRes = await auth0.middleware(request);
    if (isAuthOrApiPath(request.nextUrl.pathname)) return authRes;

    await refreshNearExpiry({ auth0, request, authRes, getRefreshWindowSeconds, now });
    return carryAuthHeaders({ from: authRes, to: handleI18nRouting(withReturnTo(request)) });
  };
}

function withReturnTo(request: NextRequest): NextRequest {
  const headers = new Headers(request.headers);
  headers.set(RETURN_TO_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return new NextRequest(request, { headers });
}

async function refreshNearExpiry({
  auth0,
  request,
  authRes,
  getRefreshWindowSeconds,
  now,
}: {
  auth0: AuthProxyAuth;
  request: NextRequest;
  authRes: NextResponse;
  getRefreshWindowSeconds: () => number;
  now: () => number;
}): Promise<void> {
  try {
    const session = await readSession({ auth0, request });
    const idToken = session?.tokenSet.idToken;
    if (!idToken) return;
    const exp = idTokenExpiresAt(idToken);
    if (exp === null || exp - now() >= getRefreshWindowSeconds()) return;
    await auth0.getAccessToken(request, authRes, { refresh: true });
  } catch (error) {
    console.error("[auth-proxy] id token refresh failed:", {
      name: errorName(error),
      code: errorCode(error),
    });
  }
}

async function readSession({
  auth0,
  request,
}: {
  auth0: AuthProxyAuth;
  request: NextRequest;
}): Promise<SessionLike | null> {
  try {
    return await auth0.getSession(request);
  } catch (error) {
    console.warn("[auth-proxy] session read failed", { code: errorCodeOrName(error) });
    return null;
  }
}
