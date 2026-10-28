export type ConvexErrorKind = "auth_rejected" | "server_error" | "transport";

/**
 * Wording that means the deployment refused the token or the caller's
 * identity, as opposed to failing on its own:
 * - the Convex backend's JWT verification (`InvalidAuthHeader`,
 *   `NoAuthProvider`, "Could not verify OIDC token claim", "Token expired"),
 *   surfaced by the HTTP client as the raw response text;
 * - `UnauthenticatedError` from `convex/lib/auth.ts` (`queryWithAuth`), whose
 *   messages are "Authentication required" and "Authenticated, but no user row
 *   provisioned". Prod deployments redact uncaught function errors to
 *   "Server Error", so there this reads as `server_error`.
 */
const AUTH_REJECTED_PATTERN =
  /InvalidAuthHeader|NoAuthProvider|Could not verify OIDC token|Token expired|UnauthenticatedError|Authentication required|no user row provisioned/i;

/**
 * Tells an outage from a misconfiguration in logs. Returns only the enum: the
 * message can echo request or identity detail and is never passed on.
 */
export function classifyConvexError(error: unknown): ConvexErrorKind {
  if (error instanceof TypeError) return "transport";
  if (!(error instanceof Error)) return "server_error";
  if (error.name === "UnauthenticatedError") return "auth_rejected";
  return AUTH_REJECTED_PATTERN.test(error.message) ? "auth_rejected" : "server_error";
}
