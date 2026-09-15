import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import { mutationWithAgencyScope, mutationWithMutavRole } from "../lib/auth";
import { AUDIT_ACTION } from "../audit/domain";
import type { AgencyId } from "../agencies/domain";
import { ufFromCityUF } from "../leases/domain";
import { PRODUCT_ERROR_CODE } from "../products/domain";
import { resolveProduct } from "../products/useCases";
import { replaceGuaranteeAggregates } from "./aggregateWrites";
import { priceGuarantee } from "./pricing";
import {
  CLOSE_REASON,
  closeReasonValidator,
  GUARANTEE_ERROR_CODE,
  GUARANTEE_STATE,
  guaranteePlanValidator,
  SCORE_TIER,
  type Guarantee,
  type GuaranteeCapacity,
} from "./domain";
import {
  applyGuaranteeTransition,
  type GuaranteeActor,
  type GuaranteeTransitionError,
} from "./transitions";

/**
 * Guarantee lifecycle write surface. Every status change here composes
 * `applyGuaranteeTransition`, which owns the machine guards, the aggregate
 * rewrite, the history row and the audit entry — no mutation in this file
 * patches `status` itself.
 *
 * Wrappers follow the authority model: an agency may activate the guarantee it
 * sold and close it when its lease ends; every other terminal or adversarial
 * move (an arbitrary close reason, eviction, a new price) is Mutav compliance
 * staff. `cancelDraft` stays in `useCases.ts` — the agency UI binds to it
 * there — and composes the same helper.
 */

type TransitionErrorCode = GuaranteeTransitionError["code"];

/**
 * `publicId` is agency-facing and unique in practice (40 bits of entropy), but
 * the index does not enforce it, so a duplicate is refused rather than
 * silently resolved to whichever row came back first.
 */
async function findGuaranteeByPublicId(
  ctx: MutationCtx,
  publicId: string,
): Promise<Guarantee | null> {
  const rows = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .collect();
  return rows.length === 1 ? rows[0] : null;
}

/**
 * Agency-scoped lookup. `null` covers both "no such publicId" and "belongs to
 * another agency" so the caller cannot probe for cross-agency existence.
 */
async function findAgencyGuarantee(
  ctx: MutationCtx,
  { publicId, agencyId }: { publicId: string; agencyId: AgencyId },
): Promise<Guarantee | null> {
  const rows = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .collect();
  const owned = rows.filter((row) => row.agencyId === agencyId);
  return owned.length === 1 ? owned[0] : null;
}

const notFound = (publicId: string) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.NOT_FOUND },
  message: `Guarantee '${publicId}' not found`,
});

// ---------------------------------------------------------------------------
// activate — drafted → active, agency
// ---------------------------------------------------------------------------

type ActivateSuccessResult = { publicId: string; capacity: GuaranteeCapacity };
type ActivateErrorResult = {
  code: typeof GUARANTEE_ERROR_CODE.NOT_FOUND | TransitionErrorCode;
};

/**
 * Put a sold guarantee on risk. Capacity is (re)initialized from the `terms`
 * snapshot at this moment — a draft can carry no reservation (nothing can
 * default before cover starts), so the full ceiling is available and the
 * ceiling the guarantee runs on is the one it was priced under.
 */
export const activate = mutationWithAgencyScope({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<Result<ActivateSuccessResult, ActivateErrorResult>> => {
    const guarantee = await findAgencyGuarantee(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
    if (!guarantee) return notFound(args.publicId);

    // Nothing can have drawn cover before the guarantee went on risk, so a
    // reservation on a draft is drift rather than history. Refuse it — writing
    // the fresh capacity over it would silently destroy the reserved cents,
    // the same drift `reserveCoverCapacity` refuses instead of repairing.
    if (guarantee.capacity.reservedCents !== 0) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN },
        message: `Guarantee ${guarantee.publicId} carries ${guarantee.capacity.reservedCents} reserved cents before activation`,
      };
    }

    const ceilingCents = guarantee.terms.coverageCeilingCents;
    const applied = await applyGuaranteeTransition(ctx, {
      guarantee,
      to: GUARANTEE_STATE.ACTIVE,
      capacity: { ceilingCents, availableCents: ceilingCents, reservedCents: 0 },
      actor: actorFrom(ctx.user),
      message: "Garantia ativada",
    });
    if (!applied.success) {
      return { success: false, error: { code: applied.error.code }, message: applied.message };
    }

    return {
      success: true,
      data: { publicId: guarantee.publicId, capacity: applied.data.guarantee.capacity },
      message: `Guarantee ${guarantee.publicId} activated`,
    };
  },
});

// ---------------------------------------------------------------------------
// closeEndOfLease — agency; close(reason) — compliance staff
// ---------------------------------------------------------------------------

type CloseSuccessResult = { publicId: string };
type CloseErrorResult = {
  code: typeof GUARANTEE_ERROR_CODE.NOT_FOUND | TransitionErrorCode;
};

/**
 * The one close an agency may file itself: the lease ran its course. Every
 * other reason is a judgement about a dispute, an eviction or a cancellation
 * and belongs to compliance, so this mutation takes no reason argument rather
 * than validating one it would always reject.
 */
export const closeEndOfLease = mutationWithAgencyScope({
  args: { publicId: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Result<CloseSuccessResult, CloseErrorResult>> => {
    const guarantee = await findAgencyGuarantee(ctx, {
      publicId: args.publicId,
      agencyId: ctx.agencyId,
    });
    if (!guarantee) return notFound(args.publicId);

    const applied = await applyGuaranteeTransition(ctx, {
      guarantee,
      to: GUARANTEE_STATE.CLOSED,
      closure: { reason: CLOSE_REASON.END_OF_LEASE, ...(args.note ? { note: args.note } : {}) },
      actor: actorFrom(ctx.user),
      message: "Garantia encerrada",
    });
    if (!applied.success) {
      return { success: false, error: { code: applied.error.code }, message: applied.message };
    }

    return {
      success: true,
      data: { publicId: guarantee.publicId },
      message: `Guarantee ${guarantee.publicId} closed`,
    };
  },
});

/**
 * Staff close with an explicit reason. `assertClose` inside the helper is what
 * gates the reason against the state it is closing from — `eviction` only from
 * `in_eviction`, `dispute_reversal` only from a verified default or a
 * committed cover, `canceled_pre_activation` only from a draft.
 *
 * Closing never touches `capacity`: cents reserved by a committed cover survive
 * a `dispute_reversal` here, because giving them back is `releaseCoverCapacity`
 * and the release/burn half of policy C lands with the receivable ledger.
 */
export const close = mutationWithMutavRole({ minRole: "compliance" })({
  args: { publicId: v.string(), reason: closeReasonValidator, note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Result<CloseSuccessResult, CloseErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);

    const applied = await applyGuaranteeTransition(ctx, {
      guarantee,
      to: GUARANTEE_STATE.CLOSED,
      closure: { reason: args.reason, ...(args.note ? { note: args.note } : {}) },
      actor: actorFrom(ctx.user),
      message: "Garantia encerrada",
    });
    if (!applied.success) {
      return { success: false, error: { code: applied.error.code }, message: applied.message };
    }

    return {
      success: true,
      data: { publicId: guarantee.publicId },
      message: `Guarantee ${guarantee.publicId} closed as ${args.reason}`,
    };
  },
});

// ---------------------------------------------------------------------------
// enterEviction — compliance staff
// ---------------------------------------------------------------------------

type EnterEvictionSuccessResult = { publicId: string };
type EnterEvictionErrorResult = {
  code: typeof GUARANTEE_ERROR_CODE.NOT_FOUND | TransitionErrorCode;
};

/**
 * Mutav has taken the lease to eviction. Terminal in every direction but
 * `closed`, and only `eviction` closes it — so the move is staff-only and the
 * machine, not this handler, is what pins the exit.
 */
export const enterEviction = mutationWithMutavRole({ minRole: "compliance" })({
  args: { publicId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<EnterEvictionSuccessResult, EnterEvictionErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);

    const applied = await applyGuaranteeTransition(ctx, {
      guarantee,
      to: GUARANTEE_STATE.IN_EVICTION,
      actor: actorFrom(ctx.user),
      message: "Ação de despejo iniciada",
    });
    if (!applied.success) {
      return { success: false, error: { code: applied.error.code }, message: applied.message };
    }

    return {
      success: true,
      data: { publicId: guarantee.publicId },
      message: `Guarantee ${guarantee.publicId} entered eviction`,
    };
  },
});

// ---------------------------------------------------------------------------
// reprice — compliance staff, no status change
// ---------------------------------------------------------------------------

type RepriceSuccessResult = { publicId: string; capacity: GuaranteeCapacity };
type RepriceErrorResult = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_FOUND
    | typeof GUARANTEE_ERROR_CODE.GUARANTEE_CLOSED
    | typeof GUARANTEE_ERROR_CODE.INVALID_RENT
    | typeof GUARANTEE_ERROR_CODE.INVALID_RENEWAL_DATE
    | typeof GUARANTEE_ERROR_CODE.TENANT_DENIED
    | typeof PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

/**
 * Annual reajuste: a NEW immutable `terms` snapshot on the same guarantee life,
 * plus the renewal date it now runs to. Deliberately not a transition — the
 * guarantee keeps its state and its `activatedAt`.
 *
 * Money rule: `capacity` is not touched at all. The coverage a guarantee runs
 * on is the one it was activated under, and a reajuste must not silently move
 * how much Mutav is on risk for on an in-force guarantee. The new ceiling lives
 * in `terms.coverageCeilingCents`; `activate` reads it from there, so a draft
 * repriced before it goes on risk still starts on the new figure.
 */
export const reprice = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    publicId: v.string(),
    nextRenewalDate: v.string(),
    rentCents: v.optional(v.number()),
    plan: v.optional(guaranteePlanValidator),
    productSlug: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result<RepriceSuccessResult, RepriceErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);

    if (guarantee.status === GUARANTEE_STATE.CLOSED) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.GUARANTEE_CLOSED },
        message: `Guarantee '${args.publicId}' is closed; there is nothing left to reprice`,
      };
    }
    if (!isCalendarDate(args.nextRenewalDate)) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.INVALID_RENEWAL_DATE },
        message: "nextRenewalDate must be a calendar date in YYYY-MM-DD form",
      };
    }

    const rentCents = args.rentCents ?? guarantee.terms.rentCents;
    if (!Number.isInteger(rentCents) || rentCents <= 0) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.INVALID_RENT },
        message: "Rent must be a positive integer number of cents",
      };
    }

    const tier = guarantee.underwriting.tier;
    if (tier === SCORE_TIER.NEGADO) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.TENANT_DENIED },
        message: "A denied credit tier carries no rate and cannot be priced",
      };
    }

    const lease = await ctx.db.get(guarantee.leaseId);
    if (!lease) throw new Error(`Guarantee ${guarantee.publicId} points at a missing lease`);

    const at = new Date().toISOString();
    const productResult = await resolveProduct(ctx, {
      agencyId: guarantee.agencyId,
      uf: ufFromCityUF(lease.property.cityUF),
      tier,
      propertyKind: lease.propertyKind,
      requestedSlug: args.productSlug ?? guarantee.terms.productSlug,
      at,
    });
    if (!productResult.success) {
      return {
        success: false,
        error: { code: PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE },
        message: productResult.message,
      };
    }
    const product = productResult.data.product;

    const priced = priceGuarantee(
      {
        rentCents,
        tier,
        plan: args.plan ?? guarantee.terms.plan,
        productSlug: product.slug,
        appliedAt: at,
      },
      product.terms,
    );

    await ctx.db.patch(guarantee._id, {
      productId: product._id,
      terms: priced.terms,
      nextRenewalDate: args.nextRenewalDate,
    });
    const after = await ctx.db.get(guarantee._id);
    if (!after) throw new Error("Guarantee row vanished mid-transaction");
    // `ativoInsuredCentsPlatform` sums `availableCents + terms.exitCostCapCents`;
    // the exit cost cap just moved, so the aggregate is part of this write.
    await replaceGuaranteeAggregates(ctx, guarantee, after);

    await ctx.db.insert("guaranteeHistory", {
      agencyId: guarantee.agencyId,
      guaranteePublicId: guarantee.publicId,
      at,
      username: ctx.user.name,
      message: "Garantia reprecificada",
    });

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_REPRICED,
      resourceType: "guarantees",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        leaseId: guarantee.leaseId,
        agencyId: guarantee.agencyId,
        productId: product._id,
        previousTerms: guarantee.terms,
        terms: priced.terms,
        // Unchanged by a reprice; recorded so the entry shows what the
        // guarantee is still on risk for under the new terms.
        capacity: after.capacity,
        nextRenewalDate: args.nextRenewalDate,
      },
    });

    return {
      success: true,
      data: { publicId: guarantee.publicId, capacity: after.capacity },
      message: `Guarantee ${guarantee.publicId} repriced under ${product.slug}`,
    };
  },
});

function actorFrom(user: { _id: GuaranteeActor["userId"]; name: string }): GuaranteeActor {
  return { userId: user._id, username: user.name };
}
