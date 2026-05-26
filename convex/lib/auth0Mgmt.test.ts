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
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "tok_123", expires_in: 86400 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const tok = await getMgmtToken();
    expect(tok).toBe("tok_123");

    expect(fetchMock).toHaveBeenCalledOnce();
    const call0 = fetchMock.mock.calls[0] as unknown as [string | URL, RequestInit | undefined];
    const [url, init] = call0;
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
    const fetchMock = vi.fn(
      async () =>
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
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return new Response(JSON.stringify({ access_token: `tok_${call}`, expires_in: 30 }), {
        status: 200,
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const a = await getMgmtToken();
    const b = await getMgmtToken();
    expect(a).toBe("tok_1");
    expect(b).toBe("tok_2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("throws with status + body when the token endpoint returns 401", async () => {
    global.fetch = vi.fn(
      async () => new Response("invalid_client", { status: 401, statusText: "Unauthorized" }),
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
