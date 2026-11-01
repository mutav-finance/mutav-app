import { NextResponse } from "next/server";
import { errorName } from "./error-fields";
import {
  getFreshIdToken,
  nowInSeconds,
  type FreshIdToken,
  type FreshIdTokenAuth,
} from "./fresh-id-token";

const UNAUTHORIZED = 401;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/**
 * `GET /api/auth/convex-token`: hands the browser the session's ID token, the
 * only token that may reach client JS (Convex verifies it, `aud` = client ID).
 * Refreshes it first when it is about to expire, since a route handler can
 * persist the refreshed session cookie. Every failure is a 401, never a 500,
 * so the Convex client treats it as signed out instead of retrying hot.
 */
export function createConvexTokenRoute({
  auth0,
  getRefreshWindowSeconds,
  now = nowInSeconds,
}: {
  auth0: FreshIdTokenAuth;
  getRefreshWindowSeconds: () => number;
  now?: () => number;
}): () => Promise<NextResponse> {
  return async function GET() {
    const result = await resolveToken({ auth0, getRefreshWindowSeconds, now });
    if (result.kind === "token") {
      return NextResponse.json({ token: result.token }, { headers: NO_STORE_HEADERS });
    }
    if (result.kind !== "none") {
      console.warn("[convex-token] no token:", {
        kind: result.kind,
        code: result.kind === "refresh-failed" ? result.code : null,
      });
    }
    return NextResponse.json(
      { error: result.kind },
      { status: UNAUTHORIZED, headers: NO_STORE_HEADERS },
    );
  };
}

async function resolveToken({
  auth0,
  getRefreshWindowSeconds,
  now,
}: {
  auth0: FreshIdTokenAuth;
  getRefreshWindowSeconds: () => number;
  now: () => number;
}): Promise<FreshIdToken> {
  try {
    return await getFreshIdToken({
      auth0,
      refreshWindowSeconds: getRefreshWindowSeconds(),
      refresh: "allowed",
      now,
    });
  } catch (error) {
    console.error("[convex-token] failed:", { name: errorName(error) });
    return { kind: "none" };
  }
}
