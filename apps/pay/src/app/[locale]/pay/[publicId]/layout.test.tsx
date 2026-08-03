import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";

/**
 * Regression guard for LGPD-25: the `[publicId]` URL segment is the invoice
 * bearer credential. The checkout chrome must label the page with the
 * `INV-…` document number the query returns, never with the segment — a
 * tenant who screenshots the page for support would otherwise disclose
 * permanent access to the invoice.
 */
const ACCESS_TOKEN = "8f14e45fceea167a5a36dedd4bea2543f4b2f1a0";
const DOCUMENT_NUMBER = "INV-2026-08-0300";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: async () => ({ publicId: DOCUMENT_NUMBER }),
}));

vi.mock("@mutav/ui/shell/flow-shell", () => ({
  FlowShell: () => null,
}));

const { default: CheckoutLayout } = await import("./layout");
const { InvoiceChip } = await import("@/components/public/invoice-chip");

describe("CheckoutLayout invoice chip", () => {
  it("feeds the chip the document number, not the URL segment", async () => {
    const shell = await CheckoutLayout({
      children: null,
      params: Promise.resolve({ publicId: ACCESS_TOKEN }),
    });

    const context: unknown = shell.props.context;
    if (!isValidElement<{ documentNumber: string }>(context)) {
      throw new Error("expected the chrome to render a context chip");
    }

    expect(context.type).toBe(InvoiceChip);
    expect(context.props.documentNumber).toBe("INV-2026-08-0300");
    expect(JSON.stringify(context.props)).not.toContain(ACCESS_TOKEN);
  });

  it("renders the document number and no bearer token in the chip markup", async () => {
    const chip = await InvoiceChip({ documentNumber: DOCUMENT_NUMBER });
    const markup = JSON.stringify(chip);

    expect(markup).toContain("INV-2026-08-0300");
    expect(markup).not.toContain(ACCESS_TOKEN);
  });
});
