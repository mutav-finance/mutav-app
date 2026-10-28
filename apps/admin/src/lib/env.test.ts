import { afterEach, describe, expect, it, vi } from "vitest";

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
