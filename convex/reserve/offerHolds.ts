import { v } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import type { AgencyId } from "../agencies/domain";
import type { ProductId } from "../products/domain";
import type { GuaranteeId } from "../guarantees/domain";
import type { OfferHold, OfferHoldId } from "./domain";
import {
  isOfferHoldActive,
  isOfferHoldLapsed,
  isValidOfferHoldDays,
  OFFER_HOLD_ERROR_CODE,
  OFFER_HOLD_RELEASE_REASON,
  type OfferHoldReleaseReason,
} from "./registration";

/**
 * Offer holds: Convex's off-chain reservation of the reserve's free capital
 * for a contract out for signature (ADR 0010).
 *
 * SINGLE-REGISTRANT ASSUMPTION. Convex sees every consumer of free capital
 * only because MUTAV's operator is the sole caller of `register_guarantee`.
 * If a second operator or a second platform ever registers against the same
 * reserve, these holds stop being sound and must move on chain (a reservation
 * instruction with an expiry — a protocol ADR in mutav-protocol-solana).
 *
 * The helpers here are plain functions composed inside the caller's
 * transaction; the Convex functions are the expiry sweep and the
 * hold-period settings, which have no edit UI yet.
 */

/**
 * The preflight reads every unreleased hold. In-flight offers are a handful at
 * pilot volume; past this bound the preflight refuses rather than summing a
 * partial page and over-promising capital.
 */
export const MAX_OPEN_OFFER_HOLDS = 1_000;
const SWEEP_BATCH_SIZE = 200;
const SWEEP_SOURCE = "cron_offer_hold_sweep";
const SETTINGS_SOURCE = "internal_offer_hold_settings";

type SumActiveHoldsError = { code: typeof OFFER_HOLD_ERROR_CODE.TOO_MANY_OPEN_HOLDS };

/** Total base units held by active offers, optionally ignoring one guarantee's holds. */
export async function sumActiveOfferHolds(
  ctx: QueryCtx | MutationCtx,
  { now, excludeGuaranteeId }: { now: number; excludeGuaranteeId?: GuaranteeId },
): Promise<Result<{ totalBaseUnits: bigint }, SumActiveHoldsError>> {
  const open = await ctx.db
    .query("offerHolds")
    .withIndex("by_releasedAt_expiresAt", (q) => q.eq("releasedAt", undefined))
    .take(MAX_OPEN_OFFER_HOLDS + 1);
  if (open.length > MAX_OPEN_OFFER_HOLDS) {
    return {
      success: false,
      error: { code: OFFER_HOLD_ERROR_CODE.TOO_MANY_OPEN_HOLDS },
      message: `More than ${MAX_OPEN_OFFER_HOLDS} unreleased offer holds; refusing to sum a partial page`,
    };
  }
  const totalBaseUnits = open
    .filter((hold) => hold.guaranteeId !== excludeGuaranteeId)
    .filter((hold) => isOfferHoldActive(hold, now))
    .reduce((sum, hold) => sum + hold.amountBaseUnits, BigInt(0));
  return { success: true, data: { totalBaseUnits }, message: "Active offer holds summed" };
}

/** The guarantee's latest hold, released or not — what the admin console shows. */
export async function latestOfferHold(
  ctx: QueryCtx | MutationCtx,
  guaranteeId: GuaranteeId,
): Promise<OfferHold | null> {
  return ctx.db
    .query("offerHolds")
    .withIndex("by_guarantee", (q) => q.eq("guaranteeId", guaranteeId))
    .order("desc")
    .first();
}

async function unreleasedHolds(ctx: MutationCtx, guaranteeId: GuaranteeId): Promise<OfferHold[]> {
  const rows = await ctx.db
    .query("offerHolds")
    .withIndex("by_guarantee", (q) => q.eq("guaranteeId", guaranteeId))
    .collect();
  return rows.filter((row) => row.releasedAt === undefined);
}

/** Release every unreleased hold of a guarantee. Returns the released ids. */
export async function releaseOfferHolds(
  ctx: MutationCtx,
  {
    guaranteeId,
    reason,
    now,
  }: { guaranteeId: GuaranteeId; reason: OfferHoldReleaseReason; now: number },
): Promise<OfferHoldId[]> {
  const holds = await unreleasedHolds(ctx, guaranteeId);
  for (const hold of holds) {
    await ctx.db.patch(hold._id, { releasedAt: now, releaseReason: reason });
  }
  return holds.map((hold) => hold._id);
}

/**
 * The signed contract was approved: an unreleased hold still inside its
 * period now belongs to the pending registration and stops lapsing. A hold
 * that already lapsed is left for the sweep — the chain is the final check.
 * Returns whether a live hold was pinned.
 */
export async function pinOfferHoldOnSignature(
  ctx: MutationCtx,
  { guaranteeId, now }: { guaranteeId: GuaranteeId; now: number },
): Promise<boolean> {
  const holds = await unreleasedHolds(ctx, guaranteeId);
  const live = holds.filter((hold) => isOfferHoldActive(hold, now) && hold.signedAt === undefined);
  for (const hold of live) await ctx.db.patch(hold._id, { signedAt: now });
  return live.length > 0;
}

/**
 * Write down what the preflight already treats as released: every unsigned
 * hold past its period. Hourly from `convex/crons.ts`; reschedules itself
 * while a full batch comes back.
 */
export const sweepExpiredOfferHolds = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ released: number }> => {
    const now = Date.now();
    const due = await ctx.db
      .query("offerHolds")
      .withIndex("by_releasedAt_expiresAt", (q) =>
        q.eq("releasedAt", undefined).lte("expiresAt", now),
      )
      .take(SWEEP_BATCH_SIZE);
    const lapsed = due.filter((hold) => isOfferHoldLapsed(hold, now));
    for (const hold of lapsed) {
      await ctx.db.patch(hold._id, {
        releasedAt: now,
        releaseReason: OFFER_HOLD_RELEASE_REASON.EXPIRED,
      });
      await appendAuditEntry(ctx, {
        actor: { kind: "system", source: SWEEP_SOURCE },
        action: AUDIT_ACTION.OFFER_HOLD_RELEASED,
        resourceType: "offerHolds",
        resourceId: hold._id,
        payload: {
          guaranteeId: hold.guaranteeId,
          agencyId: hold.agencyId,
          amountBaseUnits: hold.amountBaseUnits.toString(),
          expiresAt: hold.expiresAt,
          releaseReason: OFFER_HOLD_RELEASE_REASON.EXPIRED,
          at: now,
        },
      });
    }
    return { released: lapsed.length };
  },
});

// ---------------------------------------------------------------------------
// Hold-period settings — internal for now (no edit UI); run from the CLI.
// ---------------------------------------------------------------------------

type SetHoldDaysError = { code: typeof OFFER_HOLD_ERROR_CODE.INVALID_HOLD_DAYS | "NOT_FOUND" };

const invalidHoldDays = (days: number) => ({
  success: false as const,
  error: { code: OFFER_HOLD_ERROR_CODE.INVALID_HOLD_DAYS },
  message: `Offer hold period must be a whole number of days in range; got ${days}`,
});

async function auditSettingChange(
  ctx: MutationCtx,
  {
    scope,
    resourceId,
    offerHoldDays,
  }: { scope: string; resourceId: string; offerHoldDays: number | null },
): Promise<void> {
  await appendAuditEntry(ctx, {
    actor: { kind: "system", source: SETTINGS_SOURCE },
    action: AUDIT_ACTION.OFFER_HOLD_SETTING_UPDATED,
    resourceType: scope,
    resourceId,
    payload: { scope, offerHoldDays },
  });
}

/** Platform default; `null` clears it back to `OFFER_HOLD_DAYS_DEFAULT`. */
export const setPlatformOfferHoldDays = internalMutation({
  args: { offerHoldDays: v.union(v.number(), v.null()) },
  handler: async (
    ctx,
    args,
  ): Promise<Result<{ offerHoldDays: number | null }, SetHoldDaysError>> => {
    if (args.offerHoldDays !== null && !isValidOfferHoldDays(args.offerHoldDays)) {
      return invalidHoldDays(args.offerHoldDays);
    }
    const offerHoldDays = args.offerHoldDays ?? undefined;
    const existing = await ctx.db
      .query("platformSettings")
      .withIndex("by_key", (q) => q.eq("key", "platform"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { offerHoldDays });
    } else {
      await ctx.db.insert("platformSettings", { key: "platform", offerHoldDays });
    }
    await auditSettingChange(ctx, {
      scope: "platformSettings",
      resourceId: "platform",
      offerHoldDays: args.offerHoldDays,
    });
    return {
      success: true,
      data: { offerHoldDays: args.offerHoldDays },
      message: "Platform offer hold period updated",
    };
  },
});

export const setProductOfferHoldDays = internalMutation({
  args: { productId: v.id("products"), offerHoldDays: v.union(v.number(), v.null()) },
  handler: async (ctx, args): Promise<Result<{ productId: ProductId }, SetHoldDaysError>> => {
    if (args.offerHoldDays !== null && !isValidOfferHoldDays(args.offerHoldDays)) {
      return invalidHoldDays(args.offerHoldDays);
    }
    const product = await ctx.db.get(args.productId);
    if (!product) {
      return { success: false, error: { code: "NOT_FOUND" }, message: "Product not found" };
    }
    await ctx.db.patch(product._id, {
      terms: { ...product.terms, offerHoldDays: args.offerHoldDays ?? undefined },
    });
    await auditSettingChange(ctx, {
      scope: "products",
      resourceId: product.slug,
      offerHoldDays: args.offerHoldDays,
    });
    return {
      success: true,
      data: { productId: product._id },
      message: `Offer hold period of ${product.slug} updated`,
    };
  },
});

export const setAgencyOfferHoldDays = internalMutation({
  args: { agencyId: v.id("agencies"), offerHoldDays: v.union(v.number(), v.null()) },
  handler: async (ctx, args): Promise<Result<{ agencyId: AgencyId }, SetHoldDaysError>> => {
    if (args.offerHoldDays !== null && !isValidOfferHoldDays(args.offerHoldDays)) {
      return invalidHoldDays(args.offerHoldDays);
    }
    const agency = await ctx.db.get(args.agencyId);
    if (!agency) {
      return { success: false, error: { code: "NOT_FOUND" }, message: "Agency not found" };
    }
    await ctx.db.patch(agency._id, { offerHoldDays: args.offerHoldDays ?? undefined });
    await auditSettingChange(ctx, {
      scope: "agencies",
      resourceId: agency._id,
      offerHoldDays: args.offerHoldDays,
    });
    return {
      success: true,
      data: { agencyId: agency._id },
      message: "Agency offer hold period updated",
    };
  },
});

/** The platform setting, if any. */
export async function platformOfferHoldDays(
  ctx: QueryCtx | MutationCtx,
): Promise<number | undefined> {
  const settings = await ctx.db
    .query("platformSettings")
    .withIndex("by_key", (q) => q.eq("key", "platform"))
    .unique();
  return settings?.offerHoldDays;
}
