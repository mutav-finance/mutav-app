import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { BEARER_RATE_LIMIT_SCOPE, type BearerRateLimitScope } from "../domain";

/**
 * Fixed-window rate limiting for the unauthenticated bearer surface.
 *
 * Two scopes, because they answer different questions. The `token` scope caps
 * how hard one credential can be worked — the case where a link has leaked and
 * is being replayed. The `ip` scope caps how hard one origin can work the
 * surface across credentials, which is the only scope that sees an enumeration
 * sweep at all, since a sweep never repeats a token.
 */

export const BEARER_RATE_LIMIT_WINDOW_MS = 60_000;
export const BEARER_RATE_LIMIT_MAX_PER_TOKEN = 30;
export const BEARER_RATE_LIMIT_MAX_PER_IP = 120;

function maxAttemptsFor(scope: BearerRateLimitScope): number {
  return scope === BEARER_RATE_LIMIT_SCOPE.TOKEN
    ? BEARER_RATE_LIMIT_MAX_PER_TOKEN
    : BEARER_RATE_LIMIT_MAX_PER_IP;
}

async function findWindow(ctx: QueryCtx, args: { scope: BearerRateLimitScope; key: string }) {
  return ctx.db
    .query("bearerAccessAttempts")
    .withIndex("by_scope_key", (q) => q.eq("scope", args.scope).eq("key", args.key))
    .unique();
}

/**
 * Read-only limit check, for the query entry points. A Convex query cannot
 * write, so it cannot count its own traffic; what it can do is refuse to serve
 * a key that the write-capable entry points have already driven over the line.
 * That is what makes a tripped limit hold across the whole bearer surface
 * instead of only the surface that observed the burst.
 */
export async function isBearerRateLimited(
  ctx: QueryCtx,
  args: { scope: BearerRateLimitScope; key: string; nowMs: number },
): Promise<boolean> {
  const row = await findWindow(ctx, args);
  if (row === null) return false;
  if (args.nowMs - row.windowStartedAt >= BEARER_RATE_LIMIT_WINDOW_MS) return false;
  return row.count >= maxAttemptsFor(args.scope);
}

/**
 * Count one attempt against `(scope, key)` and report whether it is allowed.
 * A denial is recorded on the same row, so `deniedCount` / `lastDeniedAt` are
 * the deny log for that key.
 */
export async function recordBearerAttempt(
  ctx: MutationCtx,
  args: { scope: BearerRateLimitScope; key: string; nowMs: number },
): Promise<boolean> {
  const row = await findWindow(ctx, args);

  if (row === null) {
    await ctx.db.insert("bearerAccessAttempts", {
      scope: args.scope,
      key: args.key,
      windowStartedAt: args.nowMs,
      count: 1,
      deniedCount: 0,
    });
    return true;
  }

  if (args.nowMs - row.windowStartedAt >= BEARER_RATE_LIMIT_WINDOW_MS) {
    await ctx.db.patch(row._id, { windowStartedAt: args.nowMs, count: 1 });
    return true;
  }

  const count = row.count + 1;
  if (count > maxAttemptsFor(args.scope)) {
    await ctx.db.patch(row._id, {
      count,
      deniedCount: row.deniedCount + 1,
      lastDeniedAt: args.nowMs,
    });
    return false;
  }

  await ctx.db.patch(row._id, { count });
  return true;
}
