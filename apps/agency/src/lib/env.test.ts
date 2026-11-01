import { afterEach, describe, expect, it, vi } from "vitest";
import { requireUrlInProduction } from "./env";

/**
 * Regression guard for the cross-app URL fallbacks. `NEXT_PUBLIC_ADMIN_URL`
 * was unset on the `mutav-app` Vercel project, so the post-login staff guard
 * in `app/[locale]/(app)/layout.tsx` redirected to `http://localhost:3003` in
 * production. Silent localhost fallbacks must fail the build instead.
 */
describe("requireUrlInProduction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured value when the var is set", () => {
    expect(
      requireUrlInProduction("https://admin.mutav.finance", "X", "http://localhost:3003"),
    ).toBe("https://admin.mutav.finance");
  });

  it("returns the configured value in production when the var is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      requireUrlInProduction("https://admin.mutav.finance", "X", "http://localhost:3003"),
    ).toBe("https://admin.mutav.finance");
  });

  it("falls back to the dev origin outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(requireUrlInProduction(undefined, "X", "http://localhost:3003")).toBe(
      "http://localhost:3003",
    );
  });

  it("throws in production when the var is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      requireUrlInProduction(undefined, "NEXT_PUBLIC_ADMIN_URL", "http://localhost:3003"),
    ).toThrow("NEXT_PUBLIC_ADMIN_URL must be set in production");
  });

  it("throws in production when the var is set but empty", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      requireUrlInProduction("", "NEXT_PUBLIC_ADMIN_URL", "http://localhost:3003"),
    ).toThrow("NEXT_PUBLIC_ADMIN_URL must be set in production");
  });

  it("names the var and the refused fallback in the error", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      requireUrlInProduction(undefined, "NEXT_PUBLIC_PAY_URL", "http://localhost:3001"),
    ).toThrow(
      "NEXT_PUBLIC_PAY_URL must be set in production — refusing to fall back to http://localhost:3001",
    );
  });
});

describe("getIdTokenRefreshWindowSeconds", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function freshGetter() {
    vi.resetModules();
    const env = await import("./env");
    return env.getIdTokenRefreshWindowSeconds;
  }

  it("defaults to 600 without a warning when unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("AUTH0_ID_TOKEN_REFRESH_WINDOW_SECONDS", "");
    const getWindow = await freshGetter();
    expect(getWindow()).toBe(600);
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses a positive integer", async () => {
    vi.stubEnv("AUTH0_ID_TOKEN_REFRESH_WINDOW_SECONDS", "120");
    const getWindow = await freshGetter();
    expect(getWindow()).toBe(120);
  });

  it("falls back to 600 on an invalid value and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("AUTH0_ID_TOKEN_REFRESH_WINDOW_SECONDS", "-5");
    const getWindow = await freshGetter();
    expect(getWindow()).toBe(600);
    expect(getWindow()).toBe(600);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("-5");
  });
});
