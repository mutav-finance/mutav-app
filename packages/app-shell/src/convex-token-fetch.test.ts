import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { fetchConvexToken } from "./convex-token-fetch";

let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleWarn.mockRestore();
});

describe("fetchConvexToken", () => {
  test("returns the token on 200 and asks for no-store", async () => {
    const fetchFn = vi.fn(async () => Response.json({ token: "id-token-fixture" }));
    expect(await fetchConvexToken({ fetchFn })).toBe("id-token-fixture");
    expect(fetchFn).toHaveBeenCalledWith("/api/auth/convex-token", { cache: "no-store" });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test("a body without a string token is null", async () => {
    const fetchFn = vi.fn(async () => Response.json({ token: 42 }));
    expect(await fetchConvexToken({ fetchFn })).toBeNull();
  });

  test("a non-ok status is null and logs the status only", async () => {
    const fetchFn = vi.fn(async () => Response.json({ error: "refresh-failed" }, { status: 401 }));
    expect(await fetchConvexToken({ fetchFn })).toBeNull();
    expect(consoleWarn).toHaveBeenCalledWith("[convex-auth] token route answered", {
      status: 401,
    });
  });

  test("a fetch throw is null and logs the error name only", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("secret network detail");
    });
    expect(await fetchConvexToken({ fetchFn })).toBeNull();
    expect(consoleWarn).toHaveBeenCalledWith("[convex-auth] token fetch failed", {
      name: "TypeError",
    });
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("secret");
  });
});
