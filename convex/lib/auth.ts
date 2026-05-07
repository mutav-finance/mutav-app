import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";

/**
 * Authenticated identity helpers.
 *
 * Use `requireIdentity` at the top of every public query/mutation/action that
 * touches user data. It fails closed: if no JWT provider is configured (the
 * current state of `convex/auth.config.ts`) or if the caller is unauthenticated,
 * the function throws and the client receives an error — no silent
 * permissive read.
 *
 * For functions that genuinely intend to be public (e.g. health checks),
 * use `getOptionalIdentity` instead and document the choice inline.
 *
 * NEVER accept a `userId`/`tokenIdentifier`/`subject` from client args for
 * authorization. Always derive identity server-side via these helpers.
 */

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Returns the authenticated identity or throws `UnauthenticatedError`.
 *
 * Prefer `identity.tokenIdentifier` (issuer + subject) as the canonical
 * stable user key. Do not use `identity.subject` alone.
 */
export async function requireIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new UnauthenticatedError();
  }
  return identity;
}

/**
 * Returns the identity if present, or `null` otherwise. Use only in functions
 * that are intentionally public — document why inline.
 */
export async function getOptionalIdentity(ctx: AnyCtx) {
  return ctx.auth.getUserIdentity();
}
