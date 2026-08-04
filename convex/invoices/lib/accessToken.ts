import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Result } from "../../lib/result";
import {
  BEARER_DENIAL_REASON,
  BEARER_RATE_LIMIT_SCOPE,
  bearerLifecycleDenial,
  type BearerDenialReason,
  type Invoice,
} from "../domain";
import { isBearerRateLimited, recordBearerAttempt } from "./bearerAccess";

export type BearerResolution = Result<{ invoice: Invoice }, { code: BearerDenialReason }>;

/**
 * The only way to turn a tenant bearer token into an invoice.
 *
 * Centralized because entropy is only half of what makes a bearer credential
 * safe: the other half is that it stops working, and a check that every entry
 * point has to remember is a check one of them will eventually skip. Expiry,
 * revocation and the rate limit are enforced here so no caller can hold an
 * invoice it did not earn — the callers only choose how to render the refusal.
 *
 * The blank-token guard is separate from all of that. `accessToken` is optional
 * on the schema, so a row that predates the field is stored under the
 * `undefined` key of `by_accessToken`; rejecting a blank token before the index
 * is touched keeps "the payer presented nothing" from ever meeting "this row
 * holds nothing".
 */
async function findByToken(ctx: QueryCtx, accessToken: string): Promise<Invoice | null> {
  if (accessToken.length === 0) return null;
  return ctx.db
    .query("invoices")
    .withIndex("by_accessToken", (q) => q.eq("accessToken", accessToken))
    .unique();
}

function denied(code: BearerDenialReason): BearerResolution {
  return { success: false, error: { code }, message: `Bearer access denied: ${code}` };
}

/**
 * Read-path resolution. Enforces expiry, revocation and the token's standing
 * rate-limit window, but cannot count its own traffic — a Convex query has no
 * write. Callers map every failure to the same empty answer so no denial
 * reason leaks to the wire.
 */
export async function resolveBearerInvoice(
  ctx: QueryCtx,
  args: { accessToken: string; nowMs: number },
): Promise<BearerResolution> {
  const invoice = await findByToken(ctx, args.accessToken);
  if (invoice === null) {
    return denied(
      args.accessToken.length === 0 ? BEARER_DENIAL_REASON.MISSING : BEARER_DENIAL_REASON.UNKNOWN,
    );
  }

  const lifecycleDenial = bearerLifecycleDenial(invoice, args.nowMs);
  if (lifecycleDenial !== null) return denied(lifecycleDenial);

  const limited = await isBearerRateLimited(ctx, {
    scope: BEARER_RATE_LIMIT_SCOPE.TOKEN,
    key: args.accessToken,
    nowMs: args.nowMs,
  });
  if (limited) return denied(BEARER_DENIAL_REASON.RATE_LIMITED);

  return { success: true, data: { invoice }, message: "Bearer access granted" };
}

/**
 * Write-path resolution — the same checks, plus counting the attempt.
 *
 * Nothing is counted until the token resolves, so row creation is bounded by
 * the token window rather than by anything the caller supplies.
 *
 * The token is the only scope. A per-source-IP scope existed here and was
 * removed: the address could only arrive as an argument on a public mutation,
 * so a caller who bypassed the Next server chose it freely. That made it
 * simultaneously useless and harmful — omit it and the limit does not apply,
 * or supply someone else's address and their next legitimate page load is
 * refused. A control an adversary opts out of, and aims at a third party, is
 * not a control. See BEARER_RATE_LIMIT_SCOPE.
 */
export async function consumeBearerInvoice(
  ctx: MutationCtx,
  args: { accessToken: string; nowMs: number },
): Promise<BearerResolution> {
  const invoice = await findByToken(ctx, args.accessToken);
  if (invoice === null) {
    return denied(
      args.accessToken.length === 0 ? BEARER_DENIAL_REASON.MISSING : BEARER_DENIAL_REASON.UNKNOWN,
    );
  }

  const lifecycleDenial = bearerLifecycleDenial(invoice, args.nowMs);
  if (lifecycleDenial !== null) return denied(lifecycleDenial);

  const tokenAllowed = await recordBearerAttempt(ctx, {
    scope: BEARER_RATE_LIMIT_SCOPE.TOKEN,
    key: args.accessToken,
    nowMs: args.nowMs,
  });
  if (!tokenAllowed) return denied(BEARER_DENIAL_REASON.RATE_LIMITED);

  return { success: true, data: { invoice }, message: "Bearer access granted" };
}
