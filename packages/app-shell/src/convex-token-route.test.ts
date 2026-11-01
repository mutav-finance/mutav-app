import type { Auth0Client } from "@auth0/nextjs-auth0/server";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createConvexTokenRoute } from "./convex-token-route";
import type { FreshIdTokenAuth, SessionLike } from "./fresh-id-token";
import { idTokenExpiringAt } from "./jwt-fixture";

const NOW = 1_900_000_000;
const WINDOW = 300;
const NO_STORE = "private, no-store";

function fakeAuth0({
  sessions,
  refreshError,
}: {
  sessions: Array<SessionLike | null>;
  refreshError?: Error;
}) {
  const queue = [...sessions];
  return {
    getSession: vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]) ?? null),
    getAccessToken: vi.fn(async () => {
      if (refreshError) throw refreshError;
      return {};
    }),
  };
}

function route({
  auth0,
  getRefreshWindowSeconds = () => WINDOW,
}: {
  auth0: FreshIdTokenAuth;
  getRefreshWindowSeconds?: () => number;
}) {
  return createConvexTokenRoute({ auth0, getRefreshWindowSeconds, now: () => NOW });
}

describe("createConvexTokenRoute", () => {
  test("the SDK client satisfies the route's interface", () => {
    expectTypeOf<Auth0Client>().toExtend<FreshIdTokenAuth>();
  });

  test("a fresh token is 200 with the token", async () => {
    const token = idTokenExpiringAt(NOW + 3600);
    const res = await route({
      auth0: fakeAuth0({ sessions: [{ tokenSet: { idToken: token } }] }),
    })();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token });
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
  });

  test("a token inside the window is refreshed before it is returned", async () => {
    const renewed = idTokenExpiringAt(NOW + 3600);
    const auth0 = fakeAuth0({
      sessions: [
        { tokenSet: { idToken: idTokenExpiringAt(NOW + 10) } },
        { tokenSet: { idToken: renewed } },
      ],
    });
    const res = await route({ auth0 })();
    expect(auth0.getAccessToken).toHaveBeenCalledWith({ refresh: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: renewed });
  });

  test("no session is 401 none", async () => {
    const res = await route({ auth0: fakeAuth0({ sessions: [null] }) })();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "none" });
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
  });

  test("a failed refresh is 401 refresh-failed without the error detail", async () => {
    const res = await route({
      auth0: fakeAuth0({
        sessions: [{ tokenSet: { idToken: idTokenExpiringAt(NOW - 10) } }],
        refreshError: new Error("secret detail"),
      }),
    })();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "refresh-failed" });
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
  });

  test("a failed refresh logs kind and code only", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const refreshError = Object.assign(new Error("secret detail"), {
      code: "failed_to_refresh_token",
    });
    await route({
      auth0: fakeAuth0({
        sessions: [{ tokenSet: { idToken: idTokenExpiringAt(NOW - 10) } }],
        refreshError,
      }),
    })();
    expect(consoleWarn).toHaveBeenCalledWith("[convex-token] no token:", {
      kind: "refresh-failed",
      code: "failed_to_refresh_token",
    });
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("secret");
    consoleWarn.mockRestore();
  });

  test("a none result is not logged", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await route({ auth0: fakeAuth0({ sessions: [null] }) })();
    expect(consoleWarn).not.toHaveBeenCalledWith("[convex-token] no token:", expect.anything());
    consoleWarn.mockRestore();
  });

  test("a throwing window getter is a 401, never a 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await route({
      auth0: fakeAuth0({ sessions: [{ tokenSet: { idToken: idTokenExpiringAt(NOW + 3600) } }] }),
      getRefreshWindowSeconds: () => {
        throw new Error("misconfigured");
      },
    })();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "none" });
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), { name: "Error" });
    consoleError.mockRestore();
  });
});
