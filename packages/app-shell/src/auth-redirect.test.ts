import { describe, expect, test } from "vitest";
import { sameOriginRedirectUrl } from "./auth-redirect";

const BASE = "https://app.example.test";

describe("sameOriginRedirectUrl", () => {
  test("keeps a same-origin path with its query and hash", () => {
    expect(
      sameOriginRedirectUrl({ returnTo: "/en/claims?case=DN-1#top", baseUrl: BASE }).href,
    ).toBe("https://app.example.test/en/claims?case=DN-1#top");
  });

  test("no returnTo goes to the root", () => {
    expect(sameOriginRedirectUrl({ returnTo: undefined, baseUrl: BASE }).href).toBe(
      "https://app.example.test/",
    );
  });

  test.each([
    ["protocol-relative", "//evil.example/x"],
    ["backslash", "/\\evil.example/x"],
    ["absolute other origin", "https://evil.example/x"],
    ["other scheme", "javascript:alert(1)"],
    ["same host, other port", "https://app.example.test:8443/x"],
  ])("a %s returnTo falls back to the root", (_label, returnTo) => {
    expect(sameOriginRedirectUrl({ returnTo, baseUrl: BASE }).href).toBe(
      "https://app.example.test/",
    );
  });
});
