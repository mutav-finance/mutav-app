import type { Auth0Client } from "@auth0/nextjs-auth0/server";
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
import { getFreshIdToken, type FreshIdTokenAuth, type SessionLike } from "./fresh-id-token";
import { idTokenExpiringAt } from "./jwt-fixture";

const NOW = 1_900_000_000;
const WINDOW = 300;

class CodedError extends Error {
  constructor(
    public readonly code: string,
    name: string,
  ) {
    super("secret detail");
    this.name = name;
  }
}

function sessionWith(idToken: string | undefined): SessionLike {
  return { tokenSet: idToken === undefined ? {} : { idToken } };
}

function fakeAuth0({
  sessions,
  refreshError,
}: {
  sessions: Array<SessionLike | null | Error>;
  refreshError?: unknown;
}) {
  const queue = [...sessions];
  const getSession = vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next ?? null;
  });
  const getAccessToken = vi.fn(async () => {
    if (refreshError !== undefined) throw refreshError;
    return { token: "access-token-not-used" };
  });
  return { getSession, getAccessToken };
}

function run({ auth0, refresh }: { auth0: FreshIdTokenAuth; refresh: "allowed" | "never" }) {
  return getFreshIdToken({ auth0, refreshWindowSeconds: WINDOW, refresh, now: () => NOW });
}

let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleWarn.mockRestore();
});

describe("getFreshIdToken", () => {
  test("the SDK client satisfies the narrow interface", () => {
    expectTypeOf<Auth0Client>().toExtend<FreshIdTokenAuth>();
  });

  test("a getSession throw reads as no session and logs only the code", async () => {
    const auth0 = fakeAuth0({ sessions: [new CodedError("session_decrypt_failed", "Error")] });
    expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "none" });
    expect(consoleWarn).toHaveBeenCalledWith(expect.any(String), {
      code: "session_decrypt_failed",
    });
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("secret");
  });

  test("a missing session is none", async () => {
    const auth0 = fakeAuth0({ sessions: [null] });
    expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "none" });
  });

  test("a session without an id token is none", async () => {
    const auth0 = fakeAuth0({ sessions: [sessionWith(undefined)] });
    expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "none" });
  });

  test("a token outside the window is returned without refreshing", async () => {
    const token = idTokenExpiringAt(NOW + WINDOW + 1);
    const auth0 = fakeAuth0({ sessions: [sessionWith(token)] });
    expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "token", token });
    expect(auth0.getAccessToken).not.toHaveBeenCalled();
  });

  test("a token exactly at the window edge is returned without refreshing", async () => {
    const token = idTokenExpiringAt(NOW + WINDOW);
    const auth0 = fakeAuth0({ sessions: [sessionWith(token)] });
    expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "token", token });
    expect(auth0.getAccessToken).not.toHaveBeenCalled();
  });

  test("a token whose exp cannot be decoded is returned for Convex to judge", async () => {
    const auth0 = fakeAuth0({ sessions: [sessionWith("opaque")] });
    expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "token", token: "opaque" });
    expect(auth0.getAccessToken).not.toHaveBeenCalled();
  });

  describe("refresh allowed", () => {
    test.each([
      ["inside the window", NOW + WINDOW - 1],
      ["past exp", NOW - 10],
    ])("a token %s is refreshed and the renewed one returned", async (_label, exp) => {
      const renewed = idTokenExpiringAt(NOW + 3600);
      const auth0 = fakeAuth0({
        sessions: [sessionWith(idTokenExpiringAt(exp)), sessionWith(renewed)],
      });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "token", token: renewed });
      expect(auth0.getAccessToken).toHaveBeenCalledWith({ refresh: true });
    });

    test("a refresh throw while the old token is still valid returns the old token", async () => {
      const token = idTokenExpiringAt(NOW + 100);
      const auth0 = fakeAuth0({
        sessions: [sessionWith(token)],
        refreshError: new CodedError("failed_to_refresh_token", "AccessTokenError"),
      });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "token", token });
      expect(consoleWarn).toHaveBeenCalledWith("[fresh-id-token] refresh failed", {
        code: "failed_to_refresh_token",
      });
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("secret");
    });

    test("a refresh that does not renew while the old token is still valid returns it", async () => {
      const token = idTokenExpiringAt(NOW + 100);
      const auth0 = fakeAuth0({ sessions: [sessionWith(token), sessionWith(token)] });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({ kind: "token", token });
      expect(consoleWarn).toHaveBeenCalledWith("[fresh-id-token] refresh failed", {
        code: "id_token_not_renewed",
      });
    });

    test("a refresh throw past exp is refresh-failed and logs the code", async () => {
      const auth0 = fakeAuth0({
        sessions: [sessionWith(idTokenExpiringAt(NOW - 10))],
        refreshError: new CodedError("failed_to_refresh_token", "AccessTokenError"),
      });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({
        kind: "refresh-failed",
        code: "failed_to_refresh_token",
      });
      expect(consoleWarn).toHaveBeenCalledWith("[fresh-id-token] refresh failed", {
        code: "failed_to_refresh_token",
      });
    });

    test.each([
      ["at the skew margin", "refresh-failed", NOW + 30],
      ["one second past the skew margin", "token", NOW + 31],
    ])("a refresh throw with the old token %s is %s", async (_label, kind, exp) => {
      const auth0 = fakeAuth0({
        sessions: [sessionWith(idTokenExpiringAt(exp))],
        refreshError: new CodedError("failed_to_refresh_token", "AccessTokenError"),
      });
      expect((await run({ auth0, refresh: "allowed" })).kind).toBe(kind);
    });

    test("a refresh that does not renew the id token is refresh-failed", async () => {
      const stale = idTokenExpiringAt(NOW + 10);
      const auth0 = fakeAuth0({ sessions: [sessionWith(stale), sessionWith(stale)] });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({
        kind: "refresh-failed",
        code: "id_token_not_renewed",
      });
    });

    test("a session gone after the refresh is refresh-failed", async () => {
      const auth0 = fakeAuth0({ sessions: [sessionWith(idTokenExpiringAt(NOW + 10)), null] });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({
        kind: "refresh-failed",
        code: "id_token_not_renewed",
      });
    });

    test("a refresh throw carries the SDK error code", async () => {
      const auth0 = fakeAuth0({
        sessions: [sessionWith(idTokenExpiringAt(NOW + 10))],
        refreshError: new CodedError("missing_refresh_token", "AccessTokenError"),
      });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({
        kind: "refresh-failed",
        code: "missing_refresh_token",
      });
    });

    test("a refresh throw without a code carries the error name", async () => {
      const error = new Error("secret detail");
      error.name = "MfaRequiredError";
      const auth0 = fakeAuth0({
        sessions: [sessionWith(idTokenExpiringAt(NOW + 10))],
        refreshError: error,
      });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({
        kind: "refresh-failed",
        code: "MfaRequiredError",
      });
    });

    test("a non-Error throw is refresh-failed with an unknown code", async () => {
      const auth0 = fakeAuth0({
        sessions: [sessionWith(idTokenExpiringAt(NOW + 10))],
        refreshError: "nope",
      });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({
        kind: "refresh-failed",
        code: "unknown",
      });
    });

    test("a getSession throw after the refresh is refresh-failed", async () => {
      const auth0 = fakeAuth0({
        sessions: [sessionWith(idTokenExpiringAt(NOW + 10)), new CodedError("x", "TypeError")],
      });
      expect(await run({ auth0, refresh: "allowed" })).toEqual({
        kind: "refresh-failed",
        code: "x",
      });
    });
  });

  describe("refresh never", () => {
    test("a token inside the window but not expired is returned as is", async () => {
      const token = idTokenExpiringAt(NOW + 100);
      const auth0 = fakeAuth0({ sessions: [sessionWith(token)] });
      expect(await run({ auth0, refresh: "never" })).toEqual({ kind: "token", token });
      expect(auth0.getAccessToken).not.toHaveBeenCalled();
    });

    test.each([
      ["at the skew margin", NOW + 30],
      ["inside the skew margin", NOW + 10],
      ["at exp", NOW],
      ["past exp", NOW - 10],
    ])("a token %s is expired", async (_label, exp) => {
      const auth0 = fakeAuth0({ sessions: [sessionWith(idTokenExpiringAt(exp))] });
      expect(await run({ auth0, refresh: "never" })).toEqual({ kind: "expired" });
      expect(auth0.getAccessToken).not.toHaveBeenCalled();
    });

    test("a token one second past the skew margin is still returned", async () => {
      const token = idTokenExpiringAt(NOW + 31);
      const auth0 = fakeAuth0({ sessions: [sessionWith(token)] });
      expect(await run({ auth0, refresh: "never" })).toEqual({ kind: "token", token });
    });
  });
});
