import { v } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Result } from "../lib/result";
import { mutationWithMutavRole } from "../lib/auth";
import { AUDIT_ACTION, type AppendAuditEntryInput } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { ONBOARDING_STATE } from "../agencies/domain";
import { latestReserveBalance, platformCoverageRatioBps } from "../reserve/balance";
import {
  checkReserveCapacity,
  coverRequirementCents,
  freeCapitalCents,
  isOfferHoldActive,
  isValidOfferHoldDays,
  OFFER_HOLD_ERROR_CODE,
  OFFER_HOLD_RELEASE_REASON,
  offerHoldExpiresAt,
  requiredCoverageCents,
  RESERVE_CAPACITY_ERROR_CODE,
  resolveOfferHoldDays,
  type CapacityFigures,
  type OfferHoldDaysSource,
} from "../reserve/capacity";
import {
  platformOfferHoldDays,
  releaseOfferHolds,
  sumActiveOfferHolds,
} from "../reserve/offerHolds";
import { sumInsuredExposure } from "./aggregate";
import { hasApprovedSignedContract } from "./documents";
import { decisionRecipients } from "./reviewMutations";
import { agencySubmittedTenant } from "./tenantIdentity";
import {
  applyGuaranteeTransition,
  type GuaranteeActor,
  type GuaranteeTransitionError,
} from "./transitions";
import {
  ACTIVATION_FEE_STATUS,
  GUARANTEE_ERROR_CODE,
  GUARANTEE_STATE,
  type Guarantee,
} from "./domain";
import {
  activationBlockers,
  assertReviewTransition,
  REVIEW_STATUS,
  type ActivationBlocker,
  type ReviewTransitionError,
} from "./review";

/**
 * Activation under the phase-1 rule (issue #427, ADR amendment pending;
 * ADR 0010's on-chain confirmation returns in phase 3):
 *
 *   accepted ──sendForSignature──▶ awaiting_signature     preflight: cover × c must fit the
 *                                       │                   free capital; holds it for the
 *                                       │                   offer's hold period
 *                 signed contract approved (staffDocuments)
 *                                       ▼
 *                                    signed ── capacity check ──▶ drafted → active
 *                                       │ fails                     (billing starts)
 *                                       ▼
 *                              awaiting_capacity ── retryActivation / sweep ──▶ active
 *
 * Free capital = the cached vault balance (`reserve/balance.ts`) − required
 * coverage − active offer holds, excluding the guarantee's own hold. The
 * capacity check and the state move run in ONE mutation, so nothing can slip
 * between the measurement and the write. Gated by required coverage; there is
 * no registry on chain in phase 1.
 */

const STAFF_ROLE = "compliance";
const SWEEP_ACTOR = { systemSource: "reserve_capacity_sweep", username: "Sistema" } as const;

type ReviewTransitionErrorCode = ReviewTransitionError["code"];

const notFound = (publicId: string) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.NOT_FOUND },
  message: `Guarantee '${publicId}' not found`,
});

const notDrafted = (guarantee: Guarantee) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.NOT_DRAFTED },
  message: `Guarantee ${guarantee.publicId} is ${guarantee.status}; only a draft can be offered or activated`,
});

async function findGuaranteeByPublicId(
  ctx: QueryCtx | MutationCtx,
  publicId: string,
): Promise<Guarantee | null> {
  const rows = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .take(2);
  return rows.length === 1 ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// Reserve capacity — one measurement, shared by the offer and the activation
// ---------------------------------------------------------------------------

type AssessCapacityError = {
  code:
    | typeof RESERVE_CAPACITY_ERROR_CODE.RESERVE_BALANCE_UNAVAILABLE
    | typeof OFFER_HOLD_ERROR_CODE.TOO_MANY_OPEN_HOLDS;
};

/**
 * Every figure the gate needs for `guarantee`, measured inside the caller's
 * transaction: the newest fresh vault balance, `c`, the on-risk book's
 * remaining cover (`sumInsuredExposure`), every active offer hold except the
 * guarantee's own, and the guarantee's own requirement. Fails closed when no
 * fresh balance is recorded.
 */
export async function assessReserveCapacity(
  ctx: MutationCtx,
  { guarantee, now }: { guarantee: Guarantee; now: number },
): Promise<Result<CapacityFigures, AssessCapacityError>> {
  const balance = await latestReserveBalance(ctx, now);
  if (!balance.available) {
    return {
      success: false,
      error: { code: RESERVE_CAPACITY_ERROR_CODE.RESERVE_BALANCE_UNAVAILABLE },
      message: "No reserve balance recorded in the last 30 minutes; refusing to measure capacity",
    };
  }
  const holds = await sumActiveOfferHolds(ctx, { now, excludeGuaranteeId: guarantee._id });
  if (!holds.success) return holds;
  const coverageRatioBps = await platformCoverageRatioBps(ctx);
  const required = requiredCoverageCents({
    onRiskCoverCents: await sumInsuredExposure(ctx),
    coverageRatioBps,
  });
  const balanceCents = balance.reading.balanceCents;
  return {
    success: true,
    data: {
      snapshotTakenAt: balance.reading.takenAt,
      balanceCents,
      coverageRatioBps,
      requiredCoverageCents: required,
      activeHoldsCents: holds.data.totalCents,
      freeCapitalCents: freeCapitalCents({
        balanceCents,
        requiredCoverageCents: required,
        activeHoldsCents: holds.data.totalCents,
      }),
      ownRequirementCents: coverRequirementCents({ terms: guarantee.terms, coverageRatioBps }),
    },
    message: "Reserve capacity measured",
  };
}

// ---------------------------------------------------------------------------
// sendForSignature — compliance staff, accepted → awaiting_signature (+ hold)
// ---------------------------------------------------------------------------

export const SEND_FOR_SIGNATURE_ERROR_CODE = {
  OFFER_STILL_HELD: "OFFER_STILL_HELD",
} as const satisfies Record<string, string>;

type OfferTargetError = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_DRAFTED
    | typeof SEND_FOR_SIGNATURE_ERROR_CODE.OFFER_STILL_HELD
    | ReviewTransitionErrorCode;
};

/**
 * Whether a draft may be (re-)sent for signature: an `accepted` draft goes
 * out for the first time; an `awaiting_signature` one may go out again only
 * once its hold has lapsed or been released — a re-send re-runs the preflight.
 */
async function isResend(
  ctx: MutationCtx,
  { guarantee, now }: { guarantee: Guarantee; now: number },
): Promise<Result<{ resent: boolean }, OfferTargetError>> {
  if (guarantee.status !== GUARANTEE_STATE.DRAFTED) return notDrafted(guarantee);
  if (guarantee.underwriting.review === REVIEW_STATUS.AWAITING_SIGNATURE) {
    const holds = await ctx.db
      .query("offerHolds")
      .withIndex("by_guarantee", (q) => q.eq("guaranteeId", guarantee._id))
      .collect();
    if (holds.some((hold) => isOfferHoldActive(hold, now))) {
      return {
        success: false,
        error: { code: SEND_FOR_SIGNATURE_ERROR_CODE.OFFER_STILL_HELD },
        message: `Guarantee ${guarantee.publicId} still holds reserve capital; re-send after the hold lapses`,
      };
    }
    return { success: true, data: { resent: true }, message: "Offer can be re-sent" };
  }
  const move = assertReviewTransition(
    guarantee.underwriting.review,
    REVIEW_STATUS.AWAITING_SIGNATURE,
  );
  if (!move.success) {
    return { success: false, error: { code: move.error.code }, message: move.message };
  }
  return { success: true, data: { resent: false }, message: "Offer can be sent" };
}

type SendForSignatureSuccessResult = {
  publicId: string;
  resent: boolean;
  holdDays: number;
  holdDaysSource: OfferHoldDaysSource;
  expiresAt: number;
  amountCents: number;
};

type SendForSignatureErrorResult = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_FOUND
    | OfferTargetError["code"]
    | typeof OFFER_HOLD_ERROR_CODE.INVALID_HOLD_DAYS
    | AssessCapacityError["code"]
    | typeof RESERVE_CAPACITY_ERROR_CODE.INSUFFICIENT_FREE_CAPITAL;
  shortfallCents?: number;
};

function invalidHoldDays(days: number) {
  return {
    success: false as const,
    error: { code: OFFER_HOLD_ERROR_CODE.INVALID_HOLD_DAYS },
    message: `Offer hold period must be a whole number of days in range; got ${days}`,
  };
}

/**
 * Mutav sends the accepted contract to the tenant. Before anything is
 * written, the offer's cover × c must fit the reserve's free capital beside
 * every active hold; the hold then reserves it for the hold period, resolved
 * contract ?? agency ?? product ?? platform ?? 7 days. There is no
 * e-signature integration in the pilot — compliance sends the contract itself
 * and records that it did. `offerHoldDays` is the per-contract override.
 */
export const sendForSignature = mutationWithMutavRole({ minRole: STAFF_ROLE })({
  args: { publicId: v.string(), offerHoldDays: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<Result<SendForSignatureSuccessResult, SendForSignatureErrorResult>> => {
    if (args.offerHoldDays !== undefined && !isValidOfferHoldDays(args.offerHoldDays)) {
      return invalidHoldDays(args.offerHoldDays);
    }
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    const now = Date.now();
    const target = await isResend(ctx, { guarantee, now });
    if (!target.success) return target;
    const { resent } = target.data;

    const agency = await ctx.db.get(guarantee.agencyId);
    const product = await ctx.db.get(guarantee.productId);
    const resolved = resolveOfferHoldDays({
      contract: args.offerHoldDays,
      agency: agency?.offerHoldDays,
      product: product?.terms.offerHoldDays,
      platform: await platformOfferHoldDays(ctx),
    });
    if (!isValidOfferHoldDays(resolved.days)) return invalidHoldDays(resolved.days);

    const capacity = await assessReserveCapacity(ctx, { guarantee, now });
    if (!capacity.success) return capacity;
    const figures = capacity.data;
    const fits = checkReserveCapacity(figures);
    if (!fits.success) {
      return {
        success: false,
        error: { code: fits.error.code, shortfallCents: fits.error.shortfallCents },
        message: fits.message,
      };
    }

    if (resent) {
      await releaseOfferHolds(ctx, {
        guaranteeId: guarantee._id,
        reason: OFFER_HOLD_RELEASE_REASON.RESENT,
        now,
      });
    }
    const expiresAt = offerHoldExpiresAt({ sentAt: now, holdDays: resolved.days });
    const holdId = await ctx.db.insert("offerHolds", {
      guaranteeId: guarantee._id,
      agencyId: guarantee.agencyId,
      amountCents: figures.ownRequirementCents,
      holdDays: resolved.days,
      createdAt: now,
      expiresAt,
    });

    const at = new Date(now).toISOString();
    await ctx.db.patch(guarantee._id, {
      underwriting: {
        ...guarantee.underwriting,
        review: REVIEW_STATUS.AWAITING_SIGNATURE,
        signatureRequest: { sentAt: at, sentBy: ctx.user._id },
      },
    });
    await ctx.db.insert("guaranteeHistory", {
      agencyId: guarantee.agencyId,
      guaranteePublicId: guarantee.publicId,
      at,
      username: ctx.user.name,
      message: resent ? "Contrato reenviado para assinatura" : "Contrato enviado para assinatura",
    });
    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_SENT_FOR_SIGNATURE,
      resourceType: "guarantees",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        agencyId: guarantee.agencyId,
        resent,
        hold: {
          holdId,
          amountCents: figures.ownRequirementCents,
          holdDays: resolved.days,
          holdDaysSource: resolved.source,
          expiresAt,
        },
        reserve: figures,
        at,
      },
    });

    // The tenant notice goes out once, on the first send (decision 1, #376):
    // a re-send after a lapsed hold renews the hold, not the tenant's notice.
    const tenant = resent ? null : await agencySubmittedTenant(ctx, guarantee);
    if (tenant && agency) {
      await ctx.scheduler.runAfter(0, internal.guarantees.actions.sendProposalNotifications, {
        publicId: guarantee.publicId,
        tenantName: tenant.fullName,
        tenantEmail: tenant.email,
        tenantPhone: tenant.phone,
        agencyName: agency.name,
        rentCents: guarantee.terms.rentCents,
        feeCents: guarantee.terms.feeCents,
        coverageCents: guarantee.capacity.availableCents,
      });
    }

    return {
      success: true,
      data: {
        publicId: guarantee.publicId,
        resent,
        holdDays: resolved.days,
        holdDaysSource: resolved.source,
        expiresAt,
        amountCents: figures.ownRequirementCents,
      },
      message: `Guarantee ${guarantee.publicId} sent for signature; ${figures.ownRequirementCents} cents held for ${resolved.days} days`,
    };
  },
});

// ---------------------------------------------------------------------------
// Activation — signed draft + capacity check → drafted → active
// ---------------------------------------------------------------------------

type PutOnRiskError = {
  code: typeof GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN | GuaranteeTransitionError["code"];
};

/**
 * Put a signed draft on risk. Capacity is (re)initialized from the `terms`
 * snapshot — a draft carries no reservation (nothing can default before cover
 * starts), so the full ceiling the guarantee was priced under is available.
 * Billing starts here and nowhere earlier: the one-time activation fee is
 * marked for the next monthly invoice in the same write.
 */
async function putDraftOnRisk(
  ctx: MutationCtx,
  { guarantee, actor }: { guarantee: Guarantee; actor: GuaranteeActor },
): Promise<Result<{ guarantee: Guarantee }, PutOnRiskError>> {
  // Writing a fresh capacity over a reservation would silently destroy the
  // reserved cents, so drift is refused rather than repaired.
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
    actor,
    message: "Garantia ativada",
  });
  if (!applied.success) {
    return { success: false, error: { code: applied.error.code }, message: applied.message };
  }
  if (guarantee.terms.oneTimeActivationFeeCents > 0) {
    await ctx.db.patch(guarantee._id, { activationFee: { status: ACTIVATION_FEE_STATUS.PENDING } });
  }
  const after = await ctx.db.get(guarantee._id);
  if (!after) throw new Error("Guarantee row vanished mid-transaction");
  return {
    success: true,
    data: { guarantee: after },
    message: `Guarantee ${guarantee.publicId} activated`,
  };
}

type AuditAppender = (input: Omit<AppendAuditEntryInput, "actor">) => Promise<unknown>;

export type ActivationOutcome =
  | { outcome: "activated" }
  | {
      outcome: "awaiting_capacity";
      reason:
        | typeof RESERVE_CAPACITY_ERROR_CODE.INSUFFICIENT_FREE_CAPITAL
        | typeof RESERVE_CAPACITY_ERROR_CODE.RESERVE_BALANCE_UNAVAILABLE
        | typeof OFFER_HOLD_ERROR_CODE.TOO_MANY_OPEN_HOLDS;
      shortfallCents: number | null;
    };

export type ActivationError = {
  code: typeof GUARANTEE_ERROR_CODE.NOT_FOUND | ActivationBlocker | PutOnRiskError["code"];
};

async function readinessBlockers(
  ctx: MutationCtx,
  guarantee: Guarantee,
): Promise<ActivationBlocker[]> {
  const agency = await ctx.db.get(guarantee.agencyId);
  return activationBlockers({
    status: guarantee.status,
    review: guarantee.underwriting.review,
    signedContractApproved: await hasApprovedSignedContract(ctx, guarantee._id),
    agencyActive: agency?.onboardingState === ONBOARDING_STATE.ACTIVE,
  });
}

/** The review move this activation attempt makes, if any — validated, never forced. */
function reviewMove(
  from: Guarantee["underwriting"]["review"],
  to: typeof REVIEW_STATUS.SIGNED | typeof REVIEW_STATUS.AWAITING_CAPACITY,
): boolean {
  return from !== to && assertReviewTransition(from, to).success;
}

/**
 * Try to put a signed draft on risk. Every precondition is re-read here, the
 * capacity check runs against the newest fresh vault balance, and the outcome
 * is written in the caller's transaction:
 *
 * - pass → drafted → active, activation fee pending, the guarantee's own hold
 *   released, the review back at `signed`, an audit entry and the agency
 *   notified;
 * - fail (short of capital, or no fresh balance) → the review at
 *   `awaiting_capacity` with the check's figures stored; the guarantee stays
 *   drafted and keeps its hold. A repeated failure refreshes the figures
 *   without another history row or audit entry, so the sweep stays quiet.
 *
 * Idempotent: a guarantee already on risk is refused as `NOT_DRAFTED`
 * before anything is written.
 */
export async function activateSignedDraft(
  ctx: MutationCtx,
  {
    guarantee,
    actor,
    appendAudit,
  }: { guarantee: Guarantee; actor: GuaranteeActor; appendAudit: AuditAppender },
): Promise<Result<ActivationOutcome, ActivationError>> {
  const blockers = await readinessBlockers(ctx, guarantee);
  const blocker = blockers[0];
  if (blocker !== undefined) {
    return {
      success: false,
      error: { code: blocker },
      message: `Guarantee ${guarantee.publicId} cannot be activated: ${blockers.join(", ")}`,
    };
  }

  const now = Date.now();
  const checkedAt = new Date(now).toISOString();
  const capacity = await assessReserveCapacity(ctx, { guarantee, now });
  const fits = capacity.success ? checkReserveCapacity(capacity.data) : null;

  if (!capacity.success || !fits?.success) {
    const reason = !capacity.success
      ? capacity.error.code
      : RESERVE_CAPACITY_ERROR_CODE.INSUFFICIENT_FREE_CAPITAL;
    const shortfallCents = fits && !fits.success ? fits.error.shortfallCents : null;
    const activationCheck = capacity.success
      ? {
          outcome: "insufficient_capacity" as const,
          checkedAt,
          ...capacity.data,
          shortfallCents: shortfallCents ?? 0,
        }
      : { outcome: "reserve_unavailable" as const, checkedAt };
    const entering = reviewMove(guarantee.underwriting.review, REVIEW_STATUS.AWAITING_CAPACITY);
    await ctx.db.patch(guarantee._id, {
      activationCheck,
      ...(entering
        ? { underwriting: { ...guarantee.underwriting, review: REVIEW_STATUS.AWAITING_CAPACITY } }
        : {}),
    });
    if (entering) {
      await ctx.db.insert("guaranteeHistory", {
        agencyId: guarantee.agencyId,
        guaranteePublicId: guarantee.publicId,
        at: checkedAt,
        username: actor.username,
        message: "Aguardando capacidade da reserva",
      });
      await appendAudit({
        action: AUDIT_ACTION.GUARANTEE_AWAITING_CAPACITY,
        resourceType: "guarantees",
        resourceId: guarantee.publicId,
        payload: {
          guaranteeId: guarantee._id,
          agencyId: guarantee.agencyId,
          reason,
          activationCheck,
        },
      });
    }
    return {
      success: true,
      data: { outcome: "awaiting_capacity", reason, shortfallCents },
      message: `Guarantee ${guarantee.publicId} is waiting for reserve capacity (${reason})`,
    };
  }

  const activated = await putDraftOnRisk(ctx, { guarantee, actor });
  if (!activated.success) return activated;
  const activationCheck = {
    outcome: "passed" as const,
    checkedAt,
    ...capacity.data,
    shortfallCents: 0,
  };
  await ctx.db.patch(guarantee._id, {
    activationCheck,
    ...(reviewMove(guarantee.underwriting.review, REVIEW_STATUS.SIGNED)
      ? { underwriting: { ...guarantee.underwriting, review: REVIEW_STATUS.SIGNED } }
      : {}),
  });
  const releasedHoldIds = await releaseOfferHolds(ctx, {
    guaranteeId: guarantee._id,
    reason: OFFER_HOLD_RELEASE_REASON.ACTIVATED,
    now,
  });
  const after = activated.data.guarantee;
  await appendAudit({
    action: AUDIT_ACTION.GUARANTEE_ACTIVATED,
    resourceType: "guarantees",
    resourceId: guarantee.publicId,
    payload: {
      guaranteeId: guarantee._id,
      agencyId: guarantee.agencyId,
      fromReview: guarantee.underwriting.review,
      signedContractApproved: true,
      activationCheck,
      releasedHoldIds,
      capacity: after.capacity,
      activatedAt: after.activatedAt,
      activationFeeCents: guarantee.terms.oneTimeActivationFeeCents,
    },
  });
  await ctx.scheduler.runAfter(0, internal.guarantees.actions.sendGuaranteeActivatedNotification, {
    publicId: guarantee.publicId,
    recipients: await decisionRecipients(ctx, guarantee),
  });
  return {
    success: true,
    data: { outcome: "activated" },
    message: `Guarantee ${guarantee.publicId} activated`,
  };
}

/**
 * Compliance retries the activation of a signed draft waiting for reserve
 * capacity — from the guarantee page of the admin app, after the vault was topped up or
 * other offers lapsed. A retry that still does not fit is not an error: the
 * draft keeps waiting and the result carries the new shortfall.
 */
export const retryActivation = mutationWithMutavRole({ minRole: STAFF_ROLE })({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<Result<ActivationOutcome, ActivationError>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    return activateSignedDraft(ctx, {
      guarantee,
      actor: { userId: ctx.user._id, username: ctx.user.name },
      appendAudit: ctx.appendStaffAudit,
    });
  },
});

/**
 * The sweep a new vault balance starts (`reserve/balance:recordReserveBalance`):
 * retries every guarantee waiting for reserve capacity, oldest analysis
 * request first, one guarantee per mutation — each run handles one and
 * schedules the next from its cursor, so the order holds and every attempt
 * stays inside its own transaction limits. Activated guarantees leave the
 * index; those still short stay behind the cursor until the next balance.
 */
export const retryAwaitingCapacity = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<{ attempted: string | null; done: boolean }> => {
    const page = await ctx.db
      .query("guarantees")
      .withIndex("by_review_status_requestedAt", (q) =>
        q
          .eq("underwriting.review", REVIEW_STATUS.AWAITING_CAPACITY)
          .eq("status", GUARANTEE_STATE.DRAFTED),
      )
      .order("asc")
      .paginate({ cursor: args.cursor, numItems: 1 });
    const guarantee = page.page[0];
    if (guarantee) {
      await activateSignedDraft(ctx, {
        guarantee,
        actor: SWEEP_ACTOR,
        appendAudit: (input) =>
          appendAuditEntry(ctx, {
            actor: { kind: "system", source: SWEEP_ACTOR.systemSource },
            ...input,
          }),
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.guarantees.activation.retryAwaitingCapacity, {
        cursor: page.continueCursor,
      });
    }
    return { attempted: guarantee?.publicId ?? null, done: page.isDone };
  },
});
