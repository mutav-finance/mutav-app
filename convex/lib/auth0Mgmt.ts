import { getAuth0Domain, getAuth0MgmtClientId, getAuth0MgmtClientSecret } from "./env";

/**
 * Auth0 Management API client for Convex `'use node'` actions.
 *
 * Single-flight token cache: the OAuth2 client-credentials access token is
 * stored in module scope and reused across invocations until ~60s before
 * its `expires_in` deadline. The 60s margin protects against clock skew
 * between Convex and Auth0 and avoids returning a token that's about to
 * expire mid-request.
 *
 * Convex `'use node'` actions run in V8 isolates that persist across warm
 * invocations, so the cache typically survives between calls. Cold starts
 * discard it — that costs one extra `/oauth/token` round-trip per cold
 * start, well within Auth0's free-tier M2M token budget.
 */

type TokenCache = { value: string; expiresAt: number };

let cachedToken: TokenCache | null = null;

const TOKEN_REFRESH_MARGIN_MS = 60_000;

function getAuthorityBase(): string {
  const domain = getAuth0Domain();
  if (!domain) {
    throw new Error(
      "AUTH0_DOMAIN is not set on this Convex deployment. " +
        "The Management API client cannot run without a tenant domain.",
    );
  }
  return `https://${domain}`;
}

/**
 * Returns a valid Management API access token. Fetches a fresh one when the
 * cache is empty or within the refresh margin of expiry.
 */
export async function getMgmtToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken.value;
  }

  const res = await fetch(`${getAuthorityBase()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: getAuth0MgmtClientId(),
      client_secret: getAuth0MgmtClientSecret(),
      audience: `${getAuthorityBase()}/api/v2/`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    const hint =
      res.status === 401
        ? " Hint: check AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET on this deployment."
        : "";
    throw new Error(
      `Auth0 token request failed: ${res.status} ${res.statusText}.` +
        ` Body: ${detail.slice(0, 500)}${hint}`,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
    throw new Error(
      `Auth0 token response missing expected fields. Got: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.value;
}

/**
 * Generic Management API request wrapper. Inject the bearer token, send the
 * body as JSON when present, parse the JSON response. Throws on non-2xx.
 *
 * Path is the part AFTER `/api/v2/` — e.g. `organizations/org_xxx`.
 */
export async function mgmtRequest<TResponse>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<TResponse> {
  const token = await getMgmtToken();
  const url = `${getAuthorityBase()}/api/v2/${path.replace(/^\//, "")}`;

  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Auth0 Management API ${method} ${path} failed: ${res.status} ${res.statusText}. ` +
        `Body: ${detail.slice(0, 500)}`,
    );
  }

  // 204 No Content: there's no body. Caller types like
  // `mgmtRequest<{ id: string }>("POST", ...)` get back `undefined` and must
  // not dereference it. The Auth0 endpoints we wrap return 204 only on
  // void operations (member adds/removes), so the type lie is bounded.
  if (res.status === 204) return undefined as TResponse;
  // Caller-supplied generic; callers are responsible for matching the
  // Auth0 response shape they declare. Boundary cast per CLAUDE.md.
  return (await res.json()) as TResponse;
}

/**
 * Smoke-test read: fetches the tenant's friendly_name + enabled_locales.
 * Used by `auth0Mgmt.smoke.ts` to verify creds without writing anything.
 * Promote to a public helper if/when a real caller emerges.
 */
type TenantSettings = {
  friendly_name?: string;
  enabled_locales?: readonly string[];
};

export function getMgmtTenantInfo(): Promise<TenantSettings> {
  return mgmtRequest<TenantSettings>("GET", "tenants/settings");
}

/**
 * Test-only: reset the in-memory token cache between unit tests. Marked
 * with a leading underscore so it's clear at the call site this isn't
 * production code.
 */
export function _resetTokenCacheForTests(): void {
  cachedToken = null;
}
