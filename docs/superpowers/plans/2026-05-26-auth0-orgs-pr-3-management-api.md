# Auth0 Orgs PR-3 — Management API Client + M2M Setup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a typed, token-caching Auth0 Management API client into Convex's Node runtime, so future PRs can call `POST /organizations`, `POST /organizations/{id}/members`, etc. from server-side actions without re-implementing the OAuth2 client-credentials dance every time.

**Architecture:** A single `convex/lib/auth0Mgmt.ts` (`'use node'`) module exposes (a) `getMgmtToken()` — fetches a Management API access token via client-credentials and caches it in module scope until ~60s before expiry, and (b) `mgmtRequest(method, path, body?)` — a generic typed wrapper around `fetch` that injects the bearer token and parses the JSON response. One Auth0 Machine-to-Machine application (created in the dashboard) issues the credentials. No write operations yet — PR-4 builds on top to add `createOrganization`, `addMember`, etc.

**Tech Stack:** Convex actions (`'use node'`), native `fetch`, vitest (mocked fetch), Auth0 Management API v2.

**Branch:** Branch off `feat/auth0-orgs-schema` (commit `c9bf8bc`). Name: `feat/auth0-orgs-mgmt-api`. Target PR base: `feat/auth0-orgs-schema`.

**Spec reference:** `docs/superpowers/specs/2026-05-26-auth0-orgs-onboarding-experience-design.md` — read the "Adoption order" table row #3 and the section on org provisioning timing. This plan implements only the Management-API-client layer; consumers come in PR-4.

---

## Preflight — manual steps before the cascade (user action)

These can't be automated by the agent. Complete them before starting Task 1.

### P1. Create the M2M Application in Auth0 Dashboard

URL: <https://manage.auth0.com/dashboard/us/dev-ay46ib0hhi1mdwpw/applications>

1. **Applications → Create Application**
2. Name: `Mutav Convex Management` (or similar)
3. Type: **Machine to Machine Applications** → Create
4. API: select **Auth0 Management API**
5. Permissions (scopes) to grant — exactly these, no more:
   - `read:organizations`
   - `create:organizations`
   - `update:organizations`
   - `delete:organizations`
   - `read:organization_members`
   - `create:organization_members`
   - `delete:organization_members`
   - `read:organization_invitations`
   - `create:organization_invitations`
   - `update:organization_member_roles`
6. Authorize → done.
7. From the new app's **Settings** tab, copy these values:
   - **Domain** — already known: `dev-ay46ib0hhi1mdwpw.us.auth0.com`
   - **Client ID** — paste at P3
   - **Client Secret** — paste at P3 (do NOT echo to chat)

### P2. (Optional — defer to launch) Create a separate `mutav-prod` M2M app

If/when the prod tenant is provisioned (per #119), repeat P1 against that tenant. Use a different M2M app name (e.g. `Mutav Convex Management (prod)`). Document the IDs in `docs/test-personas.md` or a separate ops doc.

### P3. Set the env vars on Convex deployments

```bash
# dev
bunx convex env set AUTH0_MGMT_CLIENT_ID <new-client-id>
bunx convex env set AUTH0_MGMT_CLIENT_SECRET <new-client-secret>

# prod
bunx convex env set AUTH0_MGMT_CLIENT_ID <new-client-id> --prod
bunx convex env set AUTH0_MGMT_CLIENT_SECRET <new-client-secret> --prod

# preview defaults (so per-PR previews can run actions if needed)
bunx convex env default set AUTH0_MGMT_CLIENT_ID <new-client-id> --type preview
bunx convex env default set AUTH0_MGMT_CLIENT_SECRET <new-client-secret> --type preview
```

For dev + prod, the same M2M app's creds are fine (single shared dev tenant per the current setup). For preview defaults, also use the dev tenant creds — preview deploys are short-lived test environments.

### P4. Verify Convex `AUTH0_DOMAIN` is still set on all deployments

Already done in earlier PRs, but double-check:

```bash
bunx convex env list | grep AUTH0_DOMAIN
bunx convex env list --prod | grep AUTH0_DOMAIN
bunx convex env default list --type preview | grep AUTH0_DOMAIN
```

All three should return `AUTH0_DOMAIN=<value>` (real for dev/prod, empty for preview defaults).

---

## File map

| Path | Action | Why |
|---|---|---|
| `convex/lib/env.ts` | Modify | Add `getAuth0MgmtClientId()` and `getAuth0MgmtClientSecret()` lazy getters (throw if missing — these are required for any org operation, no useful default). |
| `convex/lib/auth0Mgmt.ts` | Create | The Management API client. Single file, ~120 lines. Exports `getMgmtToken()`, `mgmtRequest()`, and one read-only smoke function `getMgmtTenantInfo()`. `'use node'` directive at top. |
| `convex/lib/auth0Mgmt.test.ts` | Create | Vitest unit tests with mocked `fetch`. Covers: token fetch + cache, expiry refresh, 4xx propagation, request body / header shape. |
| `convex/lib/auth0Mgmt.smoke.ts` | Create | Tiny `'use node'` internalAction `verifyMgmtConnection` that calls `getMgmtTenantInfo()` and returns the tenant friendly name. Used as a smoke-test from the CLI (`bunx convex run`). Not used by app code. |

No changes to schema, no new public mutations, no UI. This PR is plumbing only.

---

## Task 1: Add the env getters

**Files:**
- Modify: `convex/lib/env.ts` (after the existing `getAuth0ClientId()` function)

- [ ] **Step 1: Write the failing tests**

Create `convex/lib/env.test.ts` (or extend it if it exists):

```ts
// @vitest-environment edge-runtime
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { getAuth0MgmtClientId, getAuth0MgmtClientSecret } from "./env";

describe("getAuth0MgmtClientId", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.AUTH0_MGMT_CLIENT_ID;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH0_MGMT_CLIENT_ID;
    else process.env.AUTH0_MGMT_CLIENT_ID = original;
  });

  test("returns the value when set", () => {
    process.env.AUTH0_MGMT_CLIENT_ID = "mgmt_client_xyz";
    expect(getAuth0MgmtClientId()).toBe("mgmt_client_xyz");
  });

  test("throws a helpful error when missing", () => {
    delete process.env.AUTH0_MGMT_CLIENT_ID;
    expect(() => getAuth0MgmtClientId()).toThrow(/AUTH0_MGMT_CLIENT_ID/);
  });
});

describe("getAuth0MgmtClientSecret", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.AUTH0_MGMT_CLIENT_SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH0_MGMT_CLIENT_SECRET;
    else process.env.AUTH0_MGMT_CLIENT_SECRET = original;
  });

  test("returns the value when set", () => {
    process.env.AUTH0_MGMT_CLIENT_SECRET = "mgmt_secret_abc";
    expect(getAuth0MgmtClientSecret()).toBe("mgmt_secret_abc");
  });

  test("throws a helpful error when missing", () => {
    delete process.env.AUTH0_MGMT_CLIENT_SECRET;
    expect(() => getAuth0MgmtClientSecret()).toThrow(/AUTH0_MGMT_CLIENT_SECRET/);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail with `not a function` or similar**

```
bunx vitest run convex/lib/env.test.ts
```

Expected: 4 failures referencing missing exports.

- [ ] **Step 3: Add the getters to `convex/lib/env.ts`**

Locate `getAuth0ClientId` (the existing Auth0 client id getter, public for non-MGMT auth) and add immediately after it:

```ts
/**
 * Auth0 Management API M2M client id. Different from `getAuth0ClientId()` —
 * that one is the public Application id used by end-user JWTs; this one is
 * the dedicated M2M app's id used only by Convex actions calling
 * `https://{domain}/oauth/token` for management operations.
 *
 * Throws when unset, because every caller (`auth0Mgmt.ts`) is in an error
 * path if it's missing — no useful default.
 */
export function getAuth0MgmtClientId(): string {
  const id = process.env.AUTH0_MGMT_CLIENT_ID;
  if (!id) {
    throw new Error(
      "AUTH0_MGMT_CLIENT_ID is not set. Create a Machine-to-Machine app in " +
        "the Auth0 dashboard with Management API scopes and set " +
        "`bunx convex env set AUTH0_MGMT_CLIENT_ID <id>` on this deployment.",
    );
  }
  return id;
}

export function getAuth0MgmtClientSecret(): string {
  const secret = process.env.AUTH0_MGMT_CLIENT_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH0_MGMT_CLIENT_SECRET is not set. Get it from the M2M app's " +
        "Settings tab in the Auth0 dashboard and set " +
        "`bunx convex env set AUTH0_MGMT_CLIENT_SECRET <secret>` on this deployment.",
    );
  }
  return secret;
}
```

- [ ] **Step 4: Re-run tests; all pass**

```
bunx vitest run convex/lib/env.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Stage**

```
git add convex/lib/env.ts convex/lib/env.test.ts
```

(Do not commit yet — Task 2 ships in the same commit.)

---

## Task 2: Implement the Management API client

**Files:**
- Create: `convex/lib/auth0Mgmt.ts`

- [ ] **Step 1: Create the file**

```ts
"use node";

import { getAuth0Domain } from "./env";
import { getAuth0MgmtClientId, getAuth0MgmtClientSecret } from "./env";

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
    throw new Error(
      `Auth0 token request failed: ${res.status} ${res.statusText}. ` +
        `Body: ${detail.slice(0, 500)}`,
    );
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
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

  // 204 No Content (e.g. successful member add) — return undefined cast as TResponse.
  if (res.status === 204) return undefined as TResponse;
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
```

- [ ] **Step 2: Verify the file typechecks**

```
bunx tsc --noEmit
```

Expected: no output. If there are errors, fix them (most likely a missing `await` or a Promise<T> mismatch).

- [ ] **Step 3: Stage**

```
git add convex/lib/auth0Mgmt.ts
```

---

## Task 3: Write the client's unit tests

**Files:**
- Create: `convex/lib/auth0Mgmt.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// @vitest-environment edge-runtime
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import {
  getMgmtToken,
  mgmtRequest,
  getMgmtTenantInfo,
  _resetTokenCacheForTests,
} from "./auth0Mgmt";

const ORIGINAL_FETCH = global.fetch;

function setEnv(domain: string, clientId: string, clientSecret: string) {
  process.env.AUTH0_DOMAIN = domain;
  process.env.AUTH0_MGMT_CLIENT_ID = clientId;
  process.env.AUTH0_MGMT_CLIENT_SECRET = clientSecret;
}

function unsetEnv() {
  delete process.env.AUTH0_DOMAIN;
  delete process.env.AUTH0_MGMT_CLIENT_ID;
  delete process.env.AUTH0_MGMT_CLIENT_SECRET;
}

beforeEach(() => {
  _resetTokenCacheForTests();
  setEnv("tenant.us.auth0.com", "client_id_xyz", "client_secret_abc");
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  unsetEnv();
});

describe("getMgmtToken", () => {
  test("posts client_credentials to /oauth/token and returns access_token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "tok_123", expires_in: 86400 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const tok = await getMgmtToken();
    expect(tok).toBe("tok_123");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://tenant.us.auth0.com/oauth/token");
    expect(init).toMatchObject({ method: "POST" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      grant_type: "client_credentials",
      client_id: "client_id_xyz",
      client_secret: "client_secret_abc",
      audience: "https://tenant.us.auth0.com/api/v2/",
    });
  });

  test("returns the cached token on a second call (no second fetch)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "tok_cached", expires_in: 86400 }), {
        status: 200,
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const a = await getMgmtToken();
    const b = await getMgmtToken();
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("refreshes when the cached token is within 60s of expiry", async () => {
    // First call returns a token that expires in 30s — already inside the margin.
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return new Response(
        JSON.stringify({ access_token: `tok_${call}`, expires_in: 30 }),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const a = await getMgmtToken();
    const b = await getMgmtToken();
    expect(a).toBe("tok_1");
    expect(b).toBe("tok_2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("throws with status + body when the token endpoint returns 401", async () => {
    global.fetch = vi.fn(async () =>
      new Response("invalid_client", { status: 401, statusText: "Unauthorized" }),
    ) as unknown as typeof fetch;

    await expect(getMgmtToken()).rejects.toThrow(/401 Unauthorized.*invalid_client/);
  });
});

describe("mgmtRequest", () => {
  test("GET path: injects Bearer token, returns parsed JSON", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok_X", expires_in: 86400 }), {
          status: 200,
        });
      }
      // The actual mgmtRequest call:
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok_X");
      return new Response(JSON.stringify({ id: "org_abc", name: "Acme" }), {
        status: 200,
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await mgmtRequest<{ id: string; name: string }>("GET", "organizations/org_abc");
    expect(result).toEqual({ id: "org_abc", name: "Acme" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://tenant.us.auth0.com/api/v2/organizations/org_abc",
    );
  });

  test("POST path: sends JSON body with content-type header", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok_X", expires_in: 86400 }), {
          status: 200,
        });
      }
      const headers = init?.headers as Record<string, string>;
      expect(headers["content-type"]).toBe("application/json");
      expect(JSON.parse(init?.body as string)).toEqual({ name: "my-org" });
      return new Response(JSON.stringify({ id: "org_new" }), { status: 201 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await mgmtRequest<{ id: string }>("POST", "organizations", {
      name: "my-org",
    });
    expect(result).toEqual({ id: "org_new" });
  });

  test("returns undefined for 204 No Content responses", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok_X", expires_in: 86400 }), {
          status: 200,
        });
      }
      return new Response(null, { status: 204 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await mgmtRequest("POST", "organizations/org_x/members", { members: ["u1"] });
    expect(result).toBeUndefined();
  });

  test("throws with method + path + status when API returns 4xx", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok_X", expires_in: 86400 }), {
          status: 200,
        });
      }
      return new Response('{"error":"not_found"}', { status: 404, statusText: "Not Found" });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(mgmtRequest("GET", "organizations/missing")).rejects.toThrow(
      /GET organizations\/missing failed: 404 Not Found.*not_found/,
    );
  });

  test("path with leading slash is normalized", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok_X", expires_in: 86400 }), {
          status: 200,
        });
      }
      expect(url).toBe("https://tenant.us.auth0.com/api/v2/foo");
      return new Response(JSON.stringify({}), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await mgmtRequest("GET", "/foo");
  });
});

describe("getMgmtTenantInfo", () => {
  test("calls GET tenants/settings and returns the parsed body", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok_X", expires_in: 86400 }), {
          status: 200,
        });
      }
      expect(url).toBe("https://tenant.us.auth0.com/api/v2/tenants/settings");
      return new Response(
        JSON.stringify({ friendly_name: "Mutav Dev", enabled_locales: ["en", "pt-BR"] }),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const info = await getMgmtTenantInfo();
    expect(info.friendly_name).toBe("Mutav Dev");
    expect(info.enabled_locales).toEqual(["en", "pt-BR"]);
  });
});
```

- [ ] **Step 2: Run the tests**

```
bunx vitest run convex/lib/auth0Mgmt.test.ts
```

Expected: 9 passed.

If any test errors with `process.env.AUTH0_DOMAIN is not set` or similar, the `beforeEach` env setup didn't fire — verify the import order and that vitest picked up the file.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```
bunx vitest run convex/
```

Expected: all prior tests still pass + 9 new + 4 env tests from Task 1.

- [ ] **Step 4: Stage**

```
git add convex/lib/auth0Mgmt.test.ts
```

---

## Task 4: First commit (env getters + client + tests)

- [ ] **Step 1: Verify staged files**

```
git status -sb
```

Expected:
```
## feat/auth0-orgs-mgmt-api
 M convex/lib/env.ts
 A convex/lib/env.test.ts
 A convex/lib/auth0Mgmt.ts
 A convex/lib/auth0Mgmt.test.ts
```

Unstage anything else with `git restore --staged <file>`.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(auth0): management api client + m2m token caching

Single-flight token cache fetched via client-credentials and reused
across invocations until ~60s before expiry. Generic mgmtRequest
wrapper handles JSON bodies, bearer auth, and 204 No Content.

No writers yet — PR-4 wires this into Auth0 Org provisioning at
agency-onboarding-submit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If commitlint complains about subject case, lowercase the first word after the colon.

---

## Task 5: Add the smoke-test action

**Files:**
- Create: `convex/lib/auth0Mgmt.smoke.ts`

- [ ] **Step 1: Create the file**

```ts
"use node";

import { internalAction } from "../_generated/server";
import { getMgmtTenantInfo } from "./auth0Mgmt";

/**
 * Internal smoke-test action that verifies the M2M credentials work by
 * calling `GET /api/v2/tenants/settings`. Run from the CLI to confirm
 * `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET` are set correctly
 * on the deployment:
 *
 *   bunx convex run lib/auth0Mgmt/smoke:verifyMgmtConnection
 *
 * Returns the tenant's friendly name. Read-only; safe to run on prod.
 */
export const verifyMgmtConnection = internalAction({
  args: {},
  handler: async (): Promise<{ friendlyName: string }> => {
    const info = await getMgmtTenantInfo();
    return { friendlyName: info.friendly_name ?? "(unset)" };
  },
});
```

- [ ] **Step 2: Typecheck**

```
bunx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Push the function to Convex dev so we can call it**

```
bunx convex dev --once
```

Expected output includes `✔ Convex functions ready!`. If Convex complains about a missing env var (AUTH0_MGMT_CLIENT_ID/SECRET on the dev deployment), pause — go run the P3 commands first, then retry.

- [ ] **Step 4: Run the smoke test against dev**

```
bunx convex run lib/auth0Mgmt/smoke:verifyMgmtConnection
```

Expected: a JSON-like result containing `{ friendlyName: "..." }` where the friendly name matches whatever the Auth0 tenant is labeled as (e.g. "dev-ay46ib0hhi1mdwpw"). If it returns the friendly name, the M2M creds work end-to-end.

If you get `AUTH0_MGMT_CLIENT_ID is not set`, P3 wasn't run on dev. Run `bunx convex env set AUTH0_MGMT_CLIENT_ID <value>` and retry.

If you get `401 Unauthorized` from the token endpoint, the client_secret is wrong — copy it again from the Auth0 dashboard.

If you get `403 Forbidden` on the actual API call, the M2M app is missing `read:tenant_settings` scope. Add it in the dashboard.

- [ ] **Step 5: Stage**

```
git add convex/lib/auth0Mgmt.smoke.ts
```

---

## Task 6: Final commit + push + PR

- [ ] **Step 1: Verify**

```
git status -sb
```

Expected:
```
## feat/auth0-orgs-mgmt-api
 A convex/lib/auth0Mgmt.smoke.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(auth0): smoke action verifying m2m connection

Read-only internalAction that fetches `tenants/settings` via the
Management API client. Run via `bunx convex run` to validate the M2M
creds + tenant connectivity before PR-4 wires the writes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Run the full suite once more**

```
bunx tsc --noEmit && bunx vitest run convex/
```

Expected: tsc clean, all tests pass.

- [ ] **Step 4: Push**

```
git push -u origin feat/auth0-orgs-mgmt-api
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create \
  --base feat/auth0-orgs-schema \
  --title "feat(auth0): management api client + m2m setup" \
  --body "$(cat <<'EOF'
## Summary

PR-3 of the Auth0 Orgs cascade — the plumbing layer that future PRs (org provisioning at onboarding submit, invites, role updates) call into. Targets \`feat/auth0-orgs-schema\` (PR #123).

- \`convex/lib/auth0Mgmt.ts\` — Management API client. Single-flight token cache (refresh 60s before expiry), generic typed \`mgmtRequest()\` wrapper.
- \`convex/lib/auth0Mgmt.smoke.ts\` — \`internalAction\` for one-shot verification: \`bunx convex run lib/auth0Mgmt/smoke:verifyMgmtConnection\` returns the tenant friendly name if the M2M creds are wired correctly.
- \`convex/lib/env.ts\` — \`getAuth0MgmtClientId()\` + \`getAuth0MgmtClientSecret()\` lazy getters that throw with actionable error messages.
- 13 unit tests, mocked \`fetch\`, covering token-fetch / cache-hit / refresh-near-expiry / 4xx / Bearer-header / 204-no-content / leading-slash-normalization.

Spec: \`docs/superpowers/specs/2026-05-26-auth0-orgs-onboarding-experience-design.md\`

## Pre-merge requirements (manual)

A reviewer or the author must have done the following BEFORE merging — the PR's tests pass without these, but the cascade's PR-4 will fail without them:

- [ ] Created an Auth0 M2M Application in the dashboard with Organizations scopes (see plan §P1)
- [ ] Set \`AUTH0_MGMT_CLIENT_ID\` and \`AUTH0_MGMT_CLIENT_SECRET\` on Convex dev + prod deployments AND as preview defaults (see plan §P3)
- [ ] Verified \`bunx convex run lib/auth0Mgmt/smoke:verifyMgmtConnection\` returns the tenant friendly name (see plan Task 5 Step 4)

## Cascade position

\`\`\`
main
└─ feat/auth-wire-auth0       PR #117
   └─ feat/auth0-orgs-schema  PR #123
      └─ feat/auth0-orgs-mgmt-api  ← THIS PR
\`\`\`

Will merge to main only after the full cascade is verified end-to-end. PR #124 (chore/convex-upgrade) is a side branch off PR #123 and not in the cascade path.

## Test plan

- [x] \`bunx vitest run convex/\` — all tests pass
- [x] \`bunx tsc --noEmit\` clean
- [x] Smoke test against dev tenant returns the tenant friendly name
- [ ] Reviewer runs the smoke test against their own checkout (optional)
EOF
)"
```

Capture the PR URL from the output.

---

## Self-review notes (post-write)

**Spec coverage:**
- Spec Adoption Order row #3: "Add `convex/lib/auth0Mgmt.ts` action helper with cached M2M token; instruct user to create M2M app in Auth0 dashboard; add `AUTH0_MGMT_*` env vars." → Preflight P1-P3 + Tasks 1-5.
- Spec "Org provisioning timing — robustness" section: this PR is the plumbing PR-4 builds on; no robustness logic in this PR specifically. ✓ scope match.
- Spec "Failure modes and handling": the `mgmtRequest` wrapper surfaces status + body in error messages; PR-4 will wrap calls with retry/queue logic. ✓.

**Placeholder scan:** clean. No "TBD", no "add validation", no "similar to Task N". Every step has concrete code or commands.

**Type consistency:**
- `getMgmtToken()`, `mgmtRequest()`, `getMgmtTenantInfo()`, `_resetTokenCacheForTests()` — same names in source, tests, smoke, plan body. ✓
- `TokenCache` type used inside the module only — not exported. ✓
- `TenantSettings` type local to the smoke function — fine, narrow scope. ✓
- `internalAction` import from `_generated/server` — matches the existing pattern (see `convex/anchors/actions.ts` or any other action in the codebase). ✓

**Out-of-scope confirmation:**
- No org-write operations (createOrganization, addMember, invite, role) — PR-4.
- No schema changes — PR-2 already added `auth0OrgId`; this PR doesn't touch schema.
- No Convex actions exposed to clients — the smoke action is `internalAction` only.
- No retry logic on 5xx — PR-4 wraps with scheduler + retry policy.
- No JWT-side Auth0 Action — PR-5.
- No invite UI — PR-6.
