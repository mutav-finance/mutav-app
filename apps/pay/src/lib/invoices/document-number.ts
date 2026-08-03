import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";

/**
 * Resolve a checkout URL's bearer token to the invoice's `INV-…` document
 * number — the only invoice identifier that may reach a rendered page or a
 * document title. The URL segment itself is the credential (LGPD-25): a
 * tenant who screenshots the page for support would otherwise hand over
 * permanent access.
 *
 * Null when the token resolves to nothing; the page renders the 404.
 */
export async function fetchInvoiceDocumentNumber(accessToken: string): Promise<string | null> {
  const invoice = await fetchQuery(api.invoices.useCases.getPublicByAccessToken, { accessToken });
  return invoice?.publicId ?? null;
}
