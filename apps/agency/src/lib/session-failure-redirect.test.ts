import { beforeEach, describe, expect, it, vi } from "vitest";

const localeRedirect = vi.fn();
const rootRedirect = vi.fn();

vi.mock("@mutav/i18n/navigation", () => ({
  redirect: localeRedirect,
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    locale === "pt-BR" ? href : `/${locale}${href}`,
}));
vi.mock("next/navigation", () => ({ redirect: rootRedirect }));

const { redirectOnSessionFailure } = await import("./session-failure-redirect");

beforeEach(() => {
  localeRedirect.mockClear();
  rootRedirect.mockClear();
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
  ])("sends %j to %s", (destination, href) => {
    redirectOnSessionFailure({ destination, locale: "en", returnHref: "/" });
    expect(localeRedirect).toHaveBeenCalledWith({ href, locale: "en" });
    expect(rootRedirect).not.toHaveBeenCalled();
  });

  it("sends session-expired to login with a locale-aware returnTo", () => {
    redirectOnSessionFailure({
      destination: { kind: "session-expired" },
      locale: "en",
      returnHref: "/onboarding",
    });
    expect(rootRedirect).toHaveBeenCalledWith("/auth/login?returnTo=%2Fen%2Fonboarding");
  });

  it("returns for any other destination", () => {
    redirectOnSessionFailure({ destination: { kind: "dashboard" }, locale: "en", returnHref: "/" });
    expect(localeRedirect).not.toHaveBeenCalled();
    expect(rootRedirect).not.toHaveBeenCalled();
  });
});
