import { headers } from "next/headers";
import { fetchMutation } from "convex/nextjs";
import { api } from "@convex/_generated/api";

/**
 * Server-render gate for the checkout tree.
 *
 * The Next server is the only place in this system that observes a client
 * address: Convex hands queries and actions no request, so a per-source-IP
 * limit on the bearer surface has to be fed from here or it does not exist.
 * The address is passed as a denial-only input — the backend uses it to add a
 * reason to refuse and never a reason to allow — so nothing depends on it
 * being truthful.
 *
 * Returns false when the token is unknown, expired, revoked, or over the
 * limit; the caller renders the 404 either way, so the four are
 * indistinguishable from outside.
 */
export async function allowBearerPageView(accessToken: string): Promise<boolean> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for") ?? "";
  const sourceIp = forwardedFor.split(",")[0]?.trim();

  const result = await fetchMutation(api.invoices.mutations.recordBearerPageView, {
    accessToken,
    ...(sourceIp ? { sourceIp } : {}),
  });
  return result.success;
}
