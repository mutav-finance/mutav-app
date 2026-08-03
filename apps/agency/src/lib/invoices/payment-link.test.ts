import { afterEach, describe, expect, it, vi } from "vitest";
import { tenantCheckoutUrl } from "./payment-link";

/**
 * Regression guard for LGPD-25: the tenant checkout resolves the URL segment
 * as the invoice bearer credential, so a share link built from the `INV-…`
 * document number both 404s for the tenant and advertises a guessable
 * identifier.
 */
const INVOICE = {
  publicId: "INV-2026-08-0300",
  accessToken: "8f14e45fceea167a5a36dedd4bea2543f4b2f1a0",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tenantCheckoutUrl", () => {
  it("puts the access token in the path", () => {
    vi.stubEnv("NEXT_PUBLIC_PAY_URL", "https://pay.mutav.finance");

    expect(tenantCheckoutUrl(INVOICE)).toBe(
      "https://pay.mutav.finance/pay/8f14e45fceea167a5a36dedd4bea2543f4b2f1a0",
    );
  });

  it("never yields a link carrying the INV document number", () => {
    vi.stubEnv("NEXT_PUBLIC_PAY_URL", "https://pay.mutav.finance");

    const url = tenantCheckoutUrl(INVOICE);

    expect(url).not.toContain("INV-2026-08-0300");
    expect(url).not.toContain("INV-");
  });

  it("falls back to the pay app's dev origin when NEXT_PUBLIC_PAY_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_PAY_URL", undefined);

    expect(tenantCheckoutUrl(INVOICE)).toBe(
      "http://localhost:3001/pay/8f14e45fceea167a5a36dedd4bea2543f4b2f1a0",
    );
  });
});
