import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { clearSessionResponse } from "./cross-app-logout";
import { crossAppLogoutHref } from "./cross-app-logout-href";

const BASE = "https://admin.example.test";
const SIBLING = "https://app.example.test";
const EXPIRED = "Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

function clearWith(cookie?: string) {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  return clearSessionResponse(
    new NextRequest(`${BASE}/auth/clear-session`, { headers }),
    SIBLING,
  );
}

describe("crossAppLogoutHref", () => {
  test("points at the sibling app's clear-session route", () => {
    expect(crossAppLogoutHref("https://admin.example.test")).toBe(
      "https://admin.example.test/auth/clear-session",
    );
  });

  test("ignores a trailing slash and any path on the base", () => {
    expect(crossAppLogoutHref("http://localhost:3003/en")).toBe(
      "http://localhost:3003/auth/clear-session",
    );
  });
});

describe("clearSessionResponse", () => {
  test("redirects to the sibling app's SDK logout with a GET", () => {
    const res = clearWith();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example.test/auth/logout");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("a signed-out visit deletes nothing", () => {
    expect(clearWith("NEXT_LOCALE=en").headers.getSetCookie()).toEqual([]);
  });

  test("deletes the session cookie, its chunks and the legacy name, nothing else", () => {
    const res = clearWith(
      "__session__0=a; __session__1=b; appSession=c; NEXT_LOCALE=en; __txn_abc=d",
    );
    expect(res.headers.getSetCookie()).toEqual([
      `__session__0=; ${EXPIRED}`,
      `__session__1=; ${EXPIRED}`,
      `appSession=; ${EXPIRED}`,
    ]);
  });
});
