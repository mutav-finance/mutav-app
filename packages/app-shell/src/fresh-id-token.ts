import { idTokenExpiresAt } from "./id-token";
import { errorCodeOrName } from "./error-fields";

const ID_TOKEN_NOT_RENEWED = "id_token_not_renewed";

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

  if (refresh === "allowed") return refreshIdToken({ auth0, previousExp: exp });
  return exp > nowSeconds ? { kind: "token", token } : { kind: "expired" };
}

async function readIdToken(auth0: FreshIdTokenAuth): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    return session?.tokenSet.idToken ?? null;
  } catch {
    return null;
  }
}

async function refreshIdToken({
  auth0,
  previousExp,
}: {
  auth0: FreshIdTokenAuth;
  previousExp: number;
}): Promise<FreshIdToken> {
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
