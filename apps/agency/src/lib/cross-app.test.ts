import { describe, expect, it } from "vitest";
import { buildCrossAppUrl } from "./cross-app";

const BASE = "https://admin.mutav.finance";

describe("buildCrossAppUrl", () => {
  it("appends /en for the English locale", () => {
    expect(buildCrossAppUrl(BASE, "en")).toBe(`${BASE}/en`);
  });

  it("returns the bare base for the default pt-BR locale (localePrefix as-needed)", () => {
    expect(buildCrossAppUrl(BASE, "pt-BR")).toBe(BASE);
  });

  it("returns the bare base for unknown / unvalidated locales", () => {
    expect(buildCrossAppUrl(BASE, "fr")).toBe(BASE);
    expect(buildCrossAppUrl(BASE, "")).toBe(BASE);
    expect(buildCrossAppUrl(BASE, "../evil")).toBe(BASE);
    expect(buildCrossAppUrl(BASE, "//evil.com")).toBe(BASE);
  });

  it("never interpolates anything beyond the trusted base + a validated locale segment", () => {
    // The only non-base content the en case may contain is exactly "/en".
    expect(buildCrossAppUrl(BASE, "en")).toBe("https://admin.mutav.finance/en");
    // A request-shaped string is rejected as an unknown locale → bare base,
    // so no attacker-controlled path/host can leak into the target.
    expect(buildCrossAppUrl(BASE, "en/../../evil.com")).toBe(BASE);
  });
});
