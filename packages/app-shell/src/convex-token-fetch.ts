import { errorName } from "./error-fields";

const CONVEX_TOKEN_ROUTE = "/api/auth/convex-token";

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Reads the ID token from the server route for the Convex client. Every
 * failure is `null` (Convex then treats the user as signed out) and is logged
 * by status or error name only, never the body. No redirect from here: the
 * server-side gates own routing.
 */
export async function fetchConvexToken({ fetchFn = fetch }: { fetchFn?: FetchFn } = {}): Promise<
  string | null
> {
  try {
    const response = await fetchFn(CONVEX_TOKEN_ROUTE, { cache: "no-store" });
    if (!response.ok) {
      console.warn("[convex-auth] token route answered", { status: response.status });
      return null;
    }
    return tokenFrom(await response.json());
  } catch (error) {
    console.warn("[convex-auth] token fetch failed", { name: errorName(error) });
    return null;
  }
}

function tokenFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("token" in body)) return null;
  return typeof body.token === "string" ? body.token : null;
}
