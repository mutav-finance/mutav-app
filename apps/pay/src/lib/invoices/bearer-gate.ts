import { fetchMutation } from "convex/nextjs";
import { api } from "@convex/_generated/api";

/**
 * Server-render gate for the checkout tree.
 *
 * Sends the token and nothing else. This route once forwarded the client
 * address from `x-forwarded-for` to feed a per-IP limit, which did not work:
 * the backend receives it on a *public* mutation, so a caller who never goes
 * through this file supplies whatever address it likes — including a real
 * payer's, whose next page load would then be refused.
 *
 * Returns false when the token is unknown, expired, revoked, or over the
 * limit; the caller renders the 404 either way, so the four are
 * indistinguishable from outside.
 */
export async function allowBearerPageView(accessToken: string): Promise<boolean> {
  const result = await fetchMutation(api.invoices.mutations.recordBearerPageView, { accessToken });
  return result.success;
}
