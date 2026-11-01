import { idTokenExpiresAt } from "./id-token";
import { errorCodeOrName } from "./error-fields";

const ID_TOKEN_NOT_RENEWED = "id_token_not_renewed";

/**
 * A token this close to `exp` counts as expired: clocks between this server,
 * Auth0 and Convex drift, and a token that expires in flight fails at Convex.
 */
export const CLOCK_SKEW_SECONDS = 30;

export type SessionLike = { tokenSet: { idToken?: string } };

export interface FreshIdTokenAuth {
  getSession(): Promise<SessionLike | null>;
  getAccessToken(options: { refresh: true }): Promise<unknown>;
}

/**
 * Server Components pass "never": the SDK's cookie write is swallowed there, so
 * a refresh would spend the refresh token without persisting the result.
 */
export type RefreshPolicy = "allowed" | "never";

export type FreshIdToken =
  | { kind: "none" }
  | { kind: "token"; token: string }
  | { kind: "expired" }
  | { kind: "refresh-failed"; code: string };

export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isExpired({ exp, nowSeconds }: { exp: number; nowSeconds: number }): boolean {
  return exp <= nowSeconds + CLOCK_SKEW_SECONDS;
}

export async function getFreshIdToken({
  auth0,
  refreshWindowSeconds,
  refresh,
  now = nowInSeconds,
}: {
  auth0: FreshIdTokenAuth;
  refreshWindowSeconds: number;
  refresh: RefreshPolicy;
  now?: () => number;
}): Promise<FreshIdToken> {
  const token = await readIdToken(auth0);
  if (token === null) return { kind: "none" };

  const exp = idTokenExpiresAt(token);
  if (exp === null) return { kind: "token", token };

  const nowSeconds = now();
  if (exp - nowSeconds >= refreshWindowSeconds) return { kind: "token", token };

  if (refresh === "allowed") {
    return refreshIdToken({ auth0, previous: { token, exp }, now });
  }
  return isExpired({ exp, nowSeconds }) ? { kind: "expired" } : { kind: "token", token };
}

async function readIdToken(auth0: FreshIdTokenAuth): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    return session?.tokenSet.idToken ?? null;
  } catch (error) {
    console.warn("[fresh-id-token] session read failed", { code: errorCodeOrName(error) });
    return null;
  }
}

/**
 * A failed refresh falls back to the old token while it is still valid, so the
 * token route never answers 401 early just because the refresh window opened.
 */
async function refreshIdToken({
  auth0,
  previous,
  now,
}: {
  auth0: FreshIdTokenAuth;
  previous: { token: string; exp: number };
  now: () => number;
}): Promise<FreshIdToken> {
  const renewed = await renewIdToken({ auth0, previousExp: previous.exp });
  if (renewed.kind === "token") return renewed;

  console.warn("[fresh-id-token] refresh failed", { code: renewed.code });
  if (!isExpired({ exp: previous.exp, nowSeconds: now() })) {
    return { kind: "token", token: previous.token };
  }
  return renewed;
}

async function renewIdToken({
  auth0,
  previousExp,
}: {
  auth0: FreshIdTokenAuth;
  previousExp: number;
}): Promise<Extract<FreshIdToken, { kind: "token" } | { kind: "refresh-failed" }>> {
  try {
    await auth0.getAccessToken({ refresh: true });
    const session = await auth0.getSession();
    const token = session?.tokenSet.idToken;
    const exp = token === undefined ? null : idTokenExpiresAt(token);
    if (token === undefined || exp === null || exp <= previousExp) {
      return { kind: "refresh-failed", code: ID_TOKEN_NOT_RENEWED };
    }
    return { kind: "token", token };
  } catch (error) {
    return { kind: "refresh-failed", code: errorCodeOrName(error) };
  }
}
