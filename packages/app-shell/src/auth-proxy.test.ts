import type { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextRequest, NextResponse } from "next/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { createAuthProxy, type AuthProxyAuth } from "./auth-proxy";
import type { SessionLike } from "./fresh-id-token";
import { idTokenExpiringAt } from "./jwt-fixture";

const BASE = "https://app.example.test";
const NOW = 1_900_000_000;
const WINDOW = 300;
const NO_STORE = "private, no-cache, no-store, must-revalidate, max-age=0";
const FIXED_EXPIRES = new Date(Date.UTC(2030, 0, 1));
const ROLLED_COOKIE =
  "__session=rolled; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=lax";
const REFRESHED_COOKIE =
  "__session=refreshed; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=lax";

class CodedError extends Error {
  constructor(public readonly code: string) {
    super("secret detail");
    this.name = "AccessTokenError";
  }
}

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  expires: FIXED_EXPIRES,
} as const;

function fakeAuth0({
  session,
  refreshError,
  sessionError,
}: {
  session: SessionLike | null;
  refreshError?: Error;
  sessionError?: Error;
}) {
  return {
    middleware: vi.fn(async () => {
      const res = NextResponse.next();
      res.cookies.set("__session", "rolled", SESSION_COOKIE_OPTIONS);
      res.headers.set("cache-control", NO_STORE);
      return res;
    }),
    getSession: vi.fn(async () => {
      if (sessionError) throw sessionError;
      return session;
    }),
    getAccessToken: vi.fn(async (_request: NextRequest, response: NextResponse) => {
      if (refreshError) throw refreshError;
      response.cookies.set("__session", "refreshed", SESSION_COOKIE_OPTIONS);
      return {};
    }),
  };
}

function sessionExpiringAt(exp: number): SessionLike {
  return { tokenSet: { idToken: idTokenExpiringAt(exp) } };
}

function proxyWith({
  auth0,
  intl = () => NextResponse.next(),
}: {
  auth0: AuthProxyAuth;
  intl?: (request: NextRequest) => NextResponse;
}) {
  return createAuthProxy({
    auth0,
    handleI18nRouting: intl,
    getRefreshWindowSeconds: () => WINDOW,
    now: () => NOW,
  });
}

let consoleError: MockInstance<typeof console.error>;
let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

describe("createAuthProxy", () => {
  test("the SDK client satisfies the proxy's interface", () => {
    expectTypeOf<Auth0Client>().toExtend<AuthProxyAuth>();
  });

  test("outside the window it does not refresh and carries the rolled cookie", async () => {
    const auth0 = fakeAuth0({ session: sessionExpiringAt(NOW + 3600) });
    const res = await proxyWith({ auth0 })(new NextRequest(`${BASE}/en/dashboard`));
    expect(auth0.getAccessToken).not.toHaveBeenCalled();
    expect(res.headers.getSetCookie()).toEqual([ROLLED_COOKIE]);
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
  });

  test.each([
    ["inside the window", NOW + 10],
    ["past exp", NOW - 10],
  ])("%s it refreshes onto the auth response and carries that cookie", async (_label, exp) => {
    const auth0 = fakeAuth0({ session: sessionExpiringAt(exp) });
    const intl = NextResponse.next();
    intl.cookies.set("NEXT_LOCALE", "en", { path: "/" });
    const request = new NextRequest(`${BASE}/en/dashboard`);
    const res = await proxyWith({ auth0, intl: () => intl })(request);

    const authRes = await auth0.middleware.mock.results[0]?.value;
    expect(auth0.getAccessToken).toHaveBeenCalledWith(request, authRes, { refresh: true });
    expect(res).toBe(intl);
    expect(res.headers.getSetCookie()).toEqual(["NEXT_LOCALE=en; Path=/", REFRESHED_COOKIE]);
  });

  test("the refreshed session reaches this request's render via x-middleware-set-cookie", async () => {
    const auth0 = fakeAuth0({ session: sessionExpiringAt(NOW + 10) });
    const intl = NextResponse.next();
    intl.cookies.set("NEXT_LOCALE", "en", { path: "/" });
    const res = await proxyWith({ auth0, intl: () => intl })(
      new NextRequest(`${BASE}/en/dashboard`),
    );

    const internal = res.headers.get("x-middleware-set-cookie") ?? "";
    expect(internal).toContain("NEXT_LOCALE=en");
    expect(internal).toContain("__session=refreshed");
    expect(internal).not.toContain("__session=rolled");
  });

  test.each(["/auth/login", "/auth/callback", "/api/auth/convex-token", "/api/other"])(
    "%s returns the auth response untouched and never refreshes",
    async (path) => {
      const auth0 = fakeAuth0({ session: sessionExpiringAt(NOW + 10) });
      const intl = vi.fn(() => NextResponse.next());
      const res = await proxyWith({ auth0, intl })(new NextRequest(`${BASE}${path}`));
      expect(res).toBe(await auth0.middleware.mock.results[0]?.value);
      expect(auth0.getSession).not.toHaveBeenCalled();
      expect(auth0.getAccessToken).not.toHaveBeenCalled();
      expect(intl).not.toHaveBeenCalled();
    },
  );

  test("a refresh throw still returns the intl response and logs only name and code", async () => {
    const auth0 = fakeAuth0({
      session: sessionExpiringAt(NOW + 10),
      refreshError: new CodedError("failed_to_refresh_token"),
    });
    const intl = NextResponse.next();
    const res = await proxyWith({ auth0, intl: () => intl })(new NextRequest(`${BASE}/`));
    expect(res).toBe(intl);
    expect(res.headers.getSetCookie()).toEqual([ROLLED_COOKIE]);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), {
      name: "AccessTokenError",
      code: "failed_to_refresh_token",
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
  });

  test("a getSession throw skips the refresh, still returns the intl response and logs the code", async () => {
    const auth0 = fakeAuth0({ session: null, sessionError: new CodedError("session_read_failed") });
    const intl = NextResponse.next();
    const res = await proxyWith({ auth0, intl: () => intl })(new NextRequest(`${BASE}/`));
    expect(res).toBe(intl);
    expect(auth0.getAccessToken).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(expect.any(String), { code: "session_read_failed" });
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("secret");
  });

  test.each([
    ["no session", null],
    ["no id token", { tokenSet: {} }],
    ["an undecodable id token", { tokenSet: { idToken: "opaque" } }],
  ])("with %s it does not refresh", async (_label, session) => {
    const auth0 = fakeAuth0({ session });
    await proxyWith({ auth0 })(new NextRequest(`${BASE}/`));
    expect(auth0.getAccessToken).not.toHaveBeenCalled();
  });

  test("x-middleware-next is never carried onto an intl redirect", async () => {
    const auth0 = fakeAuth0({ session: sessionExpiringAt(NOW + 10) });
    const redirect = NextResponse.redirect(`${BASE}/en`);
    const res = await proxyWith({ auth0, intl: () => redirect })(new NextRequest(`${BASE}/`));
    expect(res.headers.get("x-middleware-next")).toBeNull();
    expect(res.headers.get("x-middleware-set-cookie")).toBeNull();
    expect(res.headers.getSetCookie()).toEqual([REFRESHED_COOKIE]);
  });
});
