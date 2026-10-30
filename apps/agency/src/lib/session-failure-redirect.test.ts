import { beforeEach, describe, expect, it, vi } from "vitest";

const localeRedirect = vi.fn();
const rootRedirect = vi.fn();

vi.mock("@mutav/i18n/navigation", () => ({
  redirect: localeRedirect,
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    locale === "pt-BR" ? href : `/${locale}${href}`,
}));
vi.mock("next/navigation", () => ({ redirect: rootRedirect }));
const requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { redirectOnSessionFailure } = await import("./session-failure-redirect");

beforeEach(() => {
  localeRedirect.mockClear();
  rootRedirect.mockClear();
  requestHeaders.delete("x-mutav-return-to");
});

describe("redirectOnSessionFailure", () => {
  it.each([
    [{ kind: "not-provisioned" } as const, "/session-error?reason=not-provisioned"],
    [{ kind: "backend-unavailable" } as const, "/session-error?reason=backend-unavailable"],
    [
      { kind: "not-provisioned", reason: "email-not-verified" } as const,
      "/session-error?reason=email-not-verified",
    ],
    [
      { kind: "not-provisioned", reason: "email-bound" } as const,
      "/session-error?reason=email-bound",
    ],
  ])("sends %j to %s", async (destination, href) => {
    await redirectOnSessionFailure({ destination, locale: "en", returnHref: "/" });
    expect(localeRedirect).toHaveBeenCalledWith({ href, locale: "en" });
    expect(rootRedirect).not.toHaveBeenCalled();
  });

  it("sends session-expired to login with a locale-aware returnTo", async () => {
    await redirectOnSessionFailure({
      destination: { kind: "session-expired" },
      locale: "en",
      returnHref: "/onboarding",
    });
    expect(rootRedirect).toHaveBeenCalledWith("/auth/login?returnTo=%2Fen%2Fonboarding");
  });

  it("sends session-expired back to the forwarded request path, query included", async () => {
    requestHeaders.set("x-mutav-return-to", "/en/invoices?status=open");
    await redirectOnSessionFailure({
      destination: { kind: "session-expired" },
      locale: "en",
      returnHref: "/",
    });
    expect(rootRedirect).toHaveBeenCalledWith(
      "/auth/login?returnTo=%2Fen%2Finvoices%3Fstatus%3Dopen",
    );
  });

  it("falls back to the caller's path when the forwarded path is not same-origin", async () => {
    requestHeaders.set("x-mutav-return-to", "//evil.example");
    await redirectOnSessionFailure({
      destination: { kind: "session-expired" },
      locale: "pt-BR",
      returnHref: "/",
    });
    expect(rootRedirect).toHaveBeenCalledWith("/auth/login?returnTo=%2F");
  });

  it("returns for any other destination", async () => {
    await redirectOnSessionFailure({
      destination: { kind: "dashboard" },
      locale: "en",
      returnHref: "/",
    });
    expect(localeRedirect).not.toHaveBeenCalled();
    expect(rootRedirect).not.toHaveBeenCalled();
  });
});
