import { getPayUrl } from "@/lib/env";
import type { Invoice } from "@convex/invoices/domain";

/**
 * Absolute tenant-checkout URL on the pay app. Cross-origin since the split,
 * so consumers use a plain anchor target — not the next-intl `Link` — and the
 * URL is not locale-prefixed: the pay app negotiates the tenant's own locale
 * (Accept-Language / NEXT_LOCALE cookie), which need not match the agent's.
 *
 * Takes the invoice rather than a bare string so the path segment cannot be
 * the `INV-…` document number by mistake: the pay routes resolve that segment
 * as the bearer credential, and the document number authorizes nothing
 * (LGPD-25).
 *
 * Null when the invoice predates `accessToken`: such a row has no credential
 * to share, and a link built from an absent one would only hand the tenant a
 * dead segment.
 */
export function tenantCheckoutUrl(invoice: Pick<Invoice, "accessToken">): string | null {
  if (!invoice.accessToken) return null;
  return `${getPayUrl()}/pay/${invoice.accessToken}`;
}
