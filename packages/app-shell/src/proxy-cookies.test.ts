import { NextResponse } from "next/server";
import { describe, expect, test } from "vitest";
import { carrySetCookies } from "./proxy-cookies";

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
  return res;
}

describe("carrySetCookies", () => {
  test("keeps every attribute of the session cookie", () => {
    const merged = carrySetCookies({ from: authResponse(), to: NextResponse.next() });

    expect(merged.headers.getSetCookie()).toContain(
      "__session=session-value; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=lax",
    );
  });

  test("keeps a chunk deletion a deletion", () => {
    const merged = carrySetCookies({ from: authResponse(), to: NextResponse.next() });

    expect(merged.headers.getSetCookie()).toContain("__session__1=; Path=/; Max-Age=0");
  });

  test("keeps cookies the target response already set", () => {
    const intl = NextResponse.next();
    intl.cookies.set("NEXT_LOCALE", "pt-BR", { path: "/", sameSite: "lax" });

    const merged = carrySetCookies({ from: authResponse(), to: intl });

    expect(merged.headers.getSetCookie()).toEqual([
      "NEXT_LOCALE=pt-BR; Path=/; SameSite=lax",
      "__session=session-value; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=lax",
      "__session__1=; Path=/; Max-Age=0",
    ]);
  });

  test("adds nothing when the source set no cookies", () => {
    const merged = carrySetCookies({ from: NextResponse.next(), to: NextResponse.next() });

    expect(merged.headers.getSetCookie()).toEqual([]);
  });
});
