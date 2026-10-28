import type { NextRequest, NextResponse } from "next/server";
import { errorCode, errorName } from "./error-fields";
import { nowInSeconds, type SessionLike } from "./fresh-id-token";
import { idTokenExpiresAt } from "./id-token";
import { carryAuthHeaders } from "./proxy-headers";

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
 */
export function createAuthProxy({
  auth0,
  handleI18nRouting,
  getRefreshWindowSeconds,
  now = nowInSeconds,
}: {
  auth0: AuthProxyAuth;
  handleI18nRouting: (request: NextRequest) => NextResponse;
  getRefreshWindowSeconds: () => number;
  now?: () => number;
}): (request: NextRequest) => Promise<NextResponse> {
  return async function proxy(request) {
    const authRes = await auth0.middleware(request);
    if (isAuthOrApiPath(request.nextUrl.pathname)) return authRes;

    await refreshNearExpiry({ auth0, request, authRes, getRefreshWindowSeconds, now });
    return carryAuthHeaders({ from: authRes, to: handleI18nRouting(request) });
  };
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
  } catch {
    return null;
  }
}
