import { splitCookiesString } from "next/dist/server/web/utils";
import { NextResponse } from "next/server";
import { describe, expect, test } from "vitest";
import { carryAuthHeaders } from "./proxy-headers";

const NO_STORE = "private, no-cache, no-store, must-revalidate, max-age=0";

function authResponse(): NextResponse {
  const res = NextResponse.next();
  res.cookies.set("__session", "session-value", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(Date.UTC(2030, 0, 1)),
  });
  res.cookies.set("__session__1", "", { path: "/", maxAge: 0 });
  res.headers.set("Cache-Control", NO_STORE);
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

describe("carryAuthHeaders", () => {
  test("keeps every attribute of the session cookie", () => {
    const merged = carryAuthHeaders({ from: authResponse(), to: NextResponse.next() });

    expect(merged.headers.getSetCookie()).toContain(
      "__session=session-value; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=lax",
    );
  });

  test("keeps a chunk deletion a deletion", () => {
    const merged = carryAuthHeaders({ from: authResponse(), to: NextResponse.next() });

    expect(merged.headers.getSetCookie()).toContain("__session__1=; Path=/; Max-Age=0");
  });

  test("keeps cookies the target response already set", () => {
    const intl = NextResponse.next();
    intl.cookies.set("NEXT_LOCALE", "pt-BR", { path: "/", sameSite: "lax" });

    const merged = carryAuthHeaders({ from: authResponse(), to: intl });

    expect(merged.headers.getSetCookie()).toEqual([
      "NEXT_LOCALE=pt-BR; Path=/; SameSite=lax",
      "__session=session-value; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=lax",
      "__session__1=; Path=/; Max-Age=0",
    ]);
  });

  test("carries the no-store headers so no shared cache keeps the session", () => {
    const merged = carryAuthHeaders({ from: authResponse(), to: NextResponse.next() });

    expect(merged.headers.get("cache-control")).toBe(NO_STORE);
    expect(merged.headers.get("pragma")).toBe("no-cache");
    expect(merged.headers.get("expires")).toBe("0");
  });

  test("never carries x-middleware-next onto a redirect", () => {
    const redirect = NextResponse.redirect("https://app.example.test/en/claims");

    const merged = carryAuthHeaders({ from: authResponse(), to: redirect });

    expect(merged.headers.get("x-middleware-next")).toBeNull();
    expect(merged.status).toBe(307);
  });

  describe("x-middleware-set-cookie (same-request render)", () => {
    const INTERNAL = "x-middleware-set-cookie";

    test("carries the source's cookies onto a pass-through response", () => {
      const merged = carryAuthHeaders({ from: authResponse(), to: NextResponse.next() });

      expect(splitCookiesString(merged.headers.get(INTERNAL) ?? "")).toEqual([
        "__session=session-value; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=lax",
        "__session__1=; Path=/; Max-Age=0",
      ]);
    });

    test("keeps the intl cookie and lets the source win on a shared name", () => {
      const intl = NextResponse.next();
      intl.cookies.set("NEXT_LOCALE", "pt-BR", { path: "/", sameSite: "lax" });
      intl.cookies.set("__session", "stale", { path: "/" });

      const merged = carryAuthHeaders({ from: authResponse(), to: intl });

      expect(splitCookiesString(merged.headers.get(INTERNAL) ?? "")).toEqual([
        "NEXT_LOCALE=pt-BR; Path=/; SameSite=lax",
        "__session=session-value; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=lax",
        "__session__1=; Path=/; Max-Age=0",
      ]);
    });

    test("carries it onto a rewrite, which still renders this request", () => {
      const rewrite = NextResponse.rewrite("https://app.example.test/pt-BR/claims");

      const merged = carryAuthHeaders({ from: authResponse(), to: rewrite });

      expect(merged.headers.get(INTERNAL)).toContain("__session=session-value");
    });

    test("is never carried onto a redirect", () => {
      const redirect = NextResponse.redirect("https://app.example.test/en/claims");

      const merged = carryAuthHeaders({ from: authResponse(), to: redirect });

      expect(merged.headers.get(INTERNAL)).toBeNull();
    });

    test("leaves the target's own value alone when the source set none", () => {
      const intl = NextResponse.next();
      intl.cookies.set("NEXT_LOCALE", "pt-BR", { path: "/", sameSite: "lax" });

      const merged = carryAuthHeaders({ from: NextResponse.next(), to: intl });

      expect(merged.headers.get(INTERNAL)).toBe("NEXT_LOCALE=pt-BR; Path=/; SameSite=lax");
    });
  });

  test("adds nothing when the source set nothing", () => {
    const merged = carryAuthHeaders({ from: NextResponse.next(), to: NextResponse.next() });

    expect(merged.headers.getSetCookie()).toEqual([]);
    expect(merged.headers.get("cache-control")).toBeNull();
    expect(merged.headers.get("x-middleware-set-cookie")).toBeNull();
  });
});
