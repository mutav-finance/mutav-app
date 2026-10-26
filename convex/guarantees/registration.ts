import { v } from "convex/values";
import { action, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Result } from "../lib/result";
import {
  internalMutationWithMutavRole,
  internalQueryWithMutavRole,
  requireIdentity,
} from "../lib/auth";
import { AUDIT_ACTION } from "../audit/domain";
import { ONBOARDING_STATE } from "../agencies/domain";
import { RESERVE_READER_ERROR_CODE, reserveReader } from "../reserve/reader";
import {
  computeCovers,
  holdAmountBaseUnits,
  isOfferHoldActive,
  isTxSignatureShape,
  isValidOfferHoldDays,
  OFFER_HOLD_ERROR_CODE,
  OFFER_HOLD_RELEASE_REASON,
  offerHoldExpiresAt,
  onchainGuaranteeIdHex,
  preflightOfferHold,
  resolveOfferHoldDays,
  type OfferHoldDaysSource,
} from "../reserve/registration";
import {
  platformOfferHoldDays,
  releaseOfferHolds,
  sumActiveOfferHolds,
} from "../reserve/offerHolds";
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
  type GuaranteeCapacity,
} from "./domain";
import {
  assertReviewTransition,
  registrationBlockers,
  REVIEW_STATUS,
  type RegistrationBlocker,
  type ReviewTransitionError,
} from "./review";

/**
 * Activation is the on-chain registration, not a click (ADR 0010).
 *
 *   accepted ──sendForSignature──▶ awaiting_signature      preflight vs free capital − active
 *                                       │                    holds; holds cover × c for the
 *                                       │                    offer's hold period
 *                 signed contract approved (staffDocuments)
 *                                       ▼
 *                         signed ─▶ pending_registration    the operator signs register_guarantee
 *                                       │
 *                          confirmRegistration({ txSignature })
 *                                       ▼
 *                            drafted → active                 verified on chain; billing starts
 *
 * Both staff entry points are actions: each reads the reserve through the
 * `ReserveReader` port, then hands the writes to an internal mutation that
 * re-checks every precondition inside its own transaction. The internal
 * functions are gated by the same `compliance` rung as the public review
 * mutations — `ctx.runQuery` / `ctx.runMutation` carry the action's identity.
 */

const STAFF_ROLE = "compliance";

type ReviewTransitionErrorCode = ReviewTransitionError["code"];

const notFound = (publicId: string) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.NOT_FOUND },
  message: `Guarantee '${publicId}' not found`,
});

const notDrafted = (guarantee: Guarantee) => ({
  success: false as const,
  error: { code: GUARANTEE_ERROR_CODE.NOT_DRAFTED },
  message: `Guarantee ${guarantee.publicId} is ${guarantee.status}; only a draft can be offered or registered`,
});

async function findGuaranteeByPublicId(
  ctx: QueryCtx | MutationCtx,
  publicId: string,
): Promise<Guarantee | null> {
  const rows = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .collect();
  return rows.length === 1 ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// sendForSignature — compliance staff, accepted → awaiting_signature (+ hold)
// ---------------------------------------------------------------------------

export const SEND_FOR_SIGNATURE_ERROR_CODE = {
  OFFER_STILL_HELD: "OFFER_STILL_HELD",
  INVALID_RESERVE_READING: "INVALID_RESERVE_READING",
} as const satisfies Record<string, string>;

type OfferMode = "first_send" | "resend";

type OfferTargetError = {
  code:
    | typeof GUARANTEE_ERROR_CODE.NOT_FOUND
    | typeof GUARANTEE_ERROR_CODE.NOT_DRAFTED
    | typeof OFFER_HOLD_ERROR_CODE.INVALID_HOLD_DAYS
    | typeof SEND_FOR_SIGNATURE_ERROR_CODE.OFFER_STILL_HELD
    | ReviewTransitionErrorCode;
};

/**
 * Whether a draft may be (re-)sent for signature: an `accepted` draft goes
 * out for the first time; an `awaiting_signature` one may go out again only
 * once its hold has lapsed or been released — a re-send re-runs the preflight.
 */
async function offerMode(
  ctx: QueryCtx | MutationCtx,
  { guarantee, now }: { guarantee: Guarantee; now: number },
): Promise<Result<{ mode: OfferMode }, OfferTargetError>> {
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
    return { success: true, data: { mode: "resend" }, message: "Offer can be re-sent" };
  }
  const move = assertReviewTransition(
    guarantee.underwriting.review,
    REVIEW_STATUS.AWAITING_SIGNATURE,
  );
  if (!move.success) {
    return { success: false, error: { code: move.error.code }, message: move.message };
  }
  return { success: true, data: { mode: "first_send" }, message: "Offer can be sent" };
}

function invalidHoldDays(days: number) {
  return {
    success: false as const,
    error: { code: OFFER_HOLD_ERROR_CODE.INVALID_HOLD_DAYS },
    message: `Offer hold period must be a whole number of days in range; got ${days}`,
  };
}

/** Staff-gated precheck before the action spends a chain read. */
export const checkOfferTarget = internalQueryWithMutavRole({ minRole: STAFF_ROLE })({
  args: { publicId: v.string(), offerHoldDays: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Result<{ mode: OfferMode }, OfferTargetError>> => {
    if (args.offerHoldDays !== undefined && !isValidOfferHoldDays(args.offerHoldDays)) {
      return invalidHoldDays(args.offerHoldDays);
    }
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    return offerMode(ctx, { guarantee, now: Date.now() });
  },
});

type SendForSignatureSuccessResult = {
  publicId: string;
  resent: boolean;
  holdDays: number;
  holdDaysSource: OfferHoldDaysSource;
  expiresAt: number;
  /** Decimal string: base units can exceed what a JSON number holds exactly. */
  amountBaseUnits: string;
};

type SendForSignatureErrorResult = {
  code:
    | OfferTargetError["code"]
    | typeof OFFER_HOLD_ERROR_CODE.INSUFFICIENT_FREE_CAPITAL
    | typeof OFFER_HOLD_ERROR_CODE.TOO_MANY_OPEN_HOLDS
    | typeof SEND_FOR_SIGNATURE_ERROR_CODE.INVALID_RESERVE_READING
    | typeof RESERVE_READER_ERROR_CODE.UNAVAILABLE;
  shortfallBaseUnits?: string;
};

/**
 * The write half of `sendForSignature`: re-checks the draft, resolves the
 * hold period (contract ?? agency ?? product ?? platform ?? 7 days), runs the
 * preflight against the free capital the action just read, and — only if the
 * new hold fits beside every active one — records the hold and the review move
 * in one transaction.
 */
export const sendForSignatureWithHold = internalMutationWithMutavRole({ minRole: STAFF_ROLE })({
  args: {
    publicId: v.string(),
    offerHoldDays: v.optional(v.number()),
    freeCapitalBaseUnits: v.int64(),
    coverageRatioBps: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<SendForSignatureSuccessResult, SendForSignatureErrorResult>> => {
    if (
      args.freeCapitalBaseUnits < BigInt(0) ||
      !Number.isInteger(args.coverageRatioBps) ||
      args.coverageRatioBps <= 0
    ) {
      return {
        success: false,
        error: { code: SEND_FOR_SIGNATURE_ERROR_CODE.INVALID_RESERVE_READING },
        message: "The reserve reading is out of range; refusing to hold against it",
      };
    }
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    const now = Date.now();
    const target = await offerMode(ctx, { guarantee, now });
    if (!target.success) return target;
    const resent = target.data.mode === "resend";

    const agency = await ctx.db.get(guarantee.agencyId);
    const product = await ctx.db.get(guarantee.productId);
    const resolved = resolveOfferHoldDays({
      contract: args.offerHoldDays,
      agency: agency?.offerHoldDays,
      product: product?.terms.offerHoldDays,
      platform: await platformOfferHoldDays(ctx),
    });
    if (!isValidOfferHoldDays(resolved.days)) return invalidHoldDays(resolved.days);

    const amountBaseUnits = holdAmountBaseUnits({
      covers: computeCovers(guarantee.terms),
      coverageRatioBps: args.coverageRatioBps,
    });
    const active = await sumActiveOfferHolds(ctx, { now, excludeGuaranteeId: guarantee._id });
    if (!active.success) return active;
    const preflight = preflightOfferHold({
      freeCapitalBaseUnits: args.freeCapitalBaseUnits,
      activeHoldsBaseUnits: active.data.totalBaseUnits,
      newHoldBaseUnits: amountBaseUnits,
    });
    if (!preflight.success) {
      return {
        success: false,
        error: {
          code: preflight.error.code,
          shortfallBaseUnits: preflight.error.shortfallBaseUnits.toString(),
        },
        message: preflight.message,
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
      amountBaseUnits,
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
          amountBaseUnits: amountBaseUnits.toString(),
          holdDays: resolved.days,
          holdDaysSource: resolved.source,
          expiresAt,
        },
        reserve: {
          freeCapitalBaseUnits: args.freeCapitalBaseUnits.toString(),
          activeHoldsBaseUnits: active.data.totalBaseUnits.toString(),
          coverageRatioBps: args.coverageRatioBps,
        },
        at,
      },
    });

    const tenant = await agencySubmittedTenant(ctx, guarantee);
    if (tenant) {
      await ctx.scheduler.runAfter(0, internal.guarantees.actions.sendProposalNotifications, {
        publicId: guarantee.publicId,
        tenantName: tenant.fullName,
        tenantEmail: tenant.email,
        tenantPhone: tenant.phone,
        rentCents: guarantee.terms.rentCents,
        availableGuaranteeCents: guarantee.capacity.availableCents,
        feeCents: guarantee.terms.feeCents,
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
        amountBaseUnits: amountBaseUnits.toString(),
      },
      message: `Guarantee ${guarantee.publicId} sent for signature; ${amountBaseUnits} base units held for ${resolved.days} days`,
    };
  },
});

/**
 * Mutav sends the accepted contract to the tenant. Before anything is
 * written, the reserve's free capital is read and the offer must fit beside
 * every active hold; the hold then reserves cover × c for the hold period.
 * There is no e-signature integration in the pilot — compliance sends the
 * contract itself and records that it did. `offerHoldDays` is the optional
 * per-contract override of the hold period.
 */
export const sendForSignature = action({
  args: { publicId: v.string(), offerHoldDays: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<Result<SendForSignatureSuccessResult, SendForSignatureErrorResult>> => {
    await requireIdentity(ctx);
    const target: Result<{ mode: OfferMode }, OfferTargetError> = await ctx.runQuery(
      internal.guarantees.registration.checkOfferTarget,
      args,
    );
    if (!target.success) return target;

    const capacity = await reserveReader.readCapacity();
    if (!capacity.success) {
      return { success: false, error: { code: capacity.error.code }, message: capacity.message };
    }
    const sent: Result<SendForSignatureSuccessResult, SendForSignatureErrorResult> =
      await ctx.runMutation(internal.guarantees.registration.sendForSignatureWithHold, {
        ...args,
        freeCapitalBaseUnits: capacity.data.freeCapitalBaseUnits,
        coverageRatioBps: capacity.data.coverageRatioBps,
      });
    return sent;
  },
});

// ---------------------------------------------------------------------------
// confirmRegistration — compliance staff, drafted → active on a verified tx
// ---------------------------------------------------------------------------

export const CONFIRM_REGISTRATION_ERROR_CODE = {
  INVALID_TX_SIGNATURE: "INVALID_TX_SIGNATURE",
  REGISTRATION_REFUSED: "REGISTRATION_REFUSED",
} as const satisfies Record<string, string>;

type RegistrationTargetError = {
  code: typeof GUARANTEE_ERROR_CODE.NOT_FOUND | RegistrationBlocker;
};

type RegistrationTarget = {
  onchainIdHex: string;
  defaultCoverBaseUnits: bigint;
  exitCoverBaseUnits: bigint;
};

async function registrationTarget(
  ctx: QueryCtx | MutationCtx,
  guarantee: Guarantee,
): Promise<Result<RegistrationTarget, RegistrationTargetError>> {
  const agency = await ctx.db.get(guarantee.agencyId);
  const blockers = registrationBlockers({
    status: guarantee.status,
    review: guarantee.underwriting.review,
    signedContractApproved: await hasApprovedSignedContract(ctx, guarantee._id),
    agencyActive: agency?.onboardingState === ONBOARDING_STATE.ACTIVE,
  });
  const blocker = blockers[0];
  if (blocker !== undefined) {
    return {
      success: false,
      error: { code: blocker },
      message: `Guarantee ${guarantee.publicId} cannot be registered: ${blockers.join(", ")}`,
    };
  }
  const covers = computeCovers(guarantee.terms);
  return {
    success: true,
    data: { onchainIdHex: await onchainGuaranteeIdHex(guarantee.publicId), ...covers },
    message: "Guarantee is waiting for its registration",
  };
}

/** Staff-gated: the id and covers the operator's transaction must carry. */
export const loadRegistrationTarget = internalQueryWithMutavRole({ minRole: STAFF_ROLE })({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<Result<RegistrationTarget, RegistrationTargetError>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    return registrationTarget(ctx, guarantee);
  },
});

type PutOnRiskError = {
  code: typeof GUARANTEE_ERROR_CODE.CAPACITY_INVARIANT_BROKEN | GuaranteeTransitionError["code"];
};

/**
 * Put a registered guarantee on risk. Capacity is (re)initialized from the
 * `terms` snapshot — a draft carries no reservation (nothing can default
 * before cover starts), so the full ceiling the guarantee was priced under is
 * available. Billing starts here and nowhere earlier: the one-time activation
 * fee is marked for the next monthly invoice in the same write.
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

type ConfirmedSuccessResult = {
  publicId: string;
  capacity: GuaranteeCapacity;
  onchainIdHex: string;
  txSignature: string;
};

type ConfirmedErrorResult = { code: RegistrationTargetError["code"] | PutOnRiskError["code"] };

/** The write half of a verified registration: drafted → active, billing, hold released. */
export const recordRegistrationConfirmed = internalMutationWithMutavRole({ minRole: STAFF_ROLE })({
  args: {
    publicId: v.string(),
    txSignature: v.string(),
    slot: v.number(),
    registeredAt: v.string(),
  },
  handler: async (ctx, args): Promise<Result<ConfirmedSuccessResult, ConfirmedErrorResult>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    const target = await registrationTarget(ctx, guarantee);
    if (!target.success) return target;

    const activated = await putDraftOnRisk(ctx, {
      guarantee,
      actor: { userId: ctx.user._id, username: ctx.user.name },
    });
    if (!activated.success) return activated;

    const now = Date.now();
    const confirmedAt = new Date(now).toISOString();
    await ctx.db.patch(guarantee._id, {
      registration: {
        onchainIdHex: target.data.onchainIdHex,
        txSignature: args.txSignature,
        slot: args.slot,
        registeredAt: args.registeredAt,
        confirmedAt,
        confirmedBy: ctx.user._id,
      },
      registrationRefusal: undefined,
    });
    const releasedHoldIds = await releaseOfferHolds(ctx, {
      guaranteeId: guarantee._id,
      reason: OFFER_HOLD_RELEASE_REASON.REGISTERED,
      now,
    });
    const after = activated.data.guarantee;

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_ACTIVATED,
      resourceType: "guarantees",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        agencyId: guarantee.agencyId,
        review: guarantee.underwriting.review,
        signedContractApproved: true,
        registration: {
          onchainIdHex: target.data.onchainIdHex,
          defaultCoverBaseUnits: target.data.defaultCoverBaseUnits.toString(),
          exitCoverBaseUnits: target.data.exitCoverBaseUnits.toString(),
          txSignature: args.txSignature,
          slot: args.slot,
          registeredAt: args.registeredAt,
        },
        releasedHoldIds,
        capacity: after.capacity,
        activatedAt: after.activatedAt,
        activationFeeCents: guarantee.terms.oneTimeActivationFeeCents,
      },
    });

    await ctx.scheduler.runAfter(
      0,
      internal.guarantees.actions.sendGuaranteeActivatedNotification,
      { publicId: guarantee.publicId, recipients: await decisionRecipients(ctx, guarantee) },
    );

    return {
      success: true,
      data: {
        publicId: guarantee.publicId,
        capacity: after.capacity,
        onchainIdHex: target.data.onchainIdHex,
        txSignature: args.txSignature,
      },
      message: `Guarantee ${guarantee.publicId} registered on chain and activated`,
    };
  },
});

/**
 * The reserve refused the registration. Not an error state: the guarantee
 * stays `pending_registration`, the program's error is kept for the admin
 * console and the agency sees it is waiting for reserve capacity. The offer
 * hold is kept too — it still marks capital this guarantee is owed.
 */
export const recordRegistrationRefused = internalMutationWithMutavRole({ minRole: STAFF_ROLE })({
  args: {
    publicId: v.string(),
    txSignature: v.string(),
    programErrorCode: v.number(),
    programErrorName: v.string(),
  },
  handler: async (ctx, args): Promise<Result<{ publicId: string }, RegistrationTargetError>> => {
    const guarantee = await findGuaranteeByPublicId(ctx, args.publicId);
    if (!guarantee) return notFound(args.publicId);
    const target = await registrationTarget(ctx, guarantee);
    if (!target.success) return target;

    const refusedAt = new Date().toISOString();
    await ctx.db.patch(guarantee._id, {
      registrationRefusal: {
        programErrorCode: args.programErrorCode,
        programErrorName: args.programErrorName,
        txSignature: args.txSignature,
        refusedAt,
        recordedBy: ctx.user._id,
      },
    });
    await ctx.db.insert("guaranteeHistory", {
      agencyId: guarantee.agencyId,
      guaranteePublicId: guarantee.publicId,
      at: refusedAt,
      username: ctx.user.name,
      message: `Registro recusado pela reserva (${args.programErrorName})`,
    });
    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.GUARANTEE_REGISTRATION_REFUSED,
      resourceType: "guarantees",
      resourceId: guarantee.publicId,
      payload: {
        guaranteeId: guarantee._id,
        agencyId: guarantee.agencyId,
        onchainIdHex: target.data.onchainIdHex,
        txSignature: args.txSignature,
        programErrorCode: args.programErrorCode,
        programErrorName: args.programErrorName,
        at: refusedAt,
      },
    });
    return {
      success: true,
      data: { publicId: guarantee.publicId },
      message: `Registration refusal recorded for ${guarantee.publicId}`,
    };
  },
});

type ConfirmRegistrationErrorResult =
  | { code: ConfirmedErrorResult["code"] }
  | { code: typeof CONFIRM_REGISTRATION_ERROR_CODE.INVALID_TX_SIGNATURE }
  | {
      code:
        | typeof RESERVE_READER_ERROR_CODE.UNAVAILABLE
        | typeof RESERVE_READER_ERROR_CODE.TX_NOT_FOUND
        | typeof RESERVE_READER_ERROR_CODE.NOT_REGISTER_GUARANTEE
        | typeof RESERVE_READER_ERROR_CODE.ARGS_MISMATCH;
    }
  | {
      code: typeof CONFIRM_REGISTRATION_ERROR_CODE.REGISTRATION_REFUSED;
      programErrorCode: number;
      programErrorName: string;
    };

/**
 * Staff record the operator's `register_guarantee` transaction signature.
 * Convex verifies it on chain — the right program, the right instruction,
 * this guarantee's id and covers — before the guarantee goes drafted →
 * active through the single write path. A transaction the reserve refused
 * keeps the guarantee `pending_registration` and stores the program's error.
 * Pilot: the operator signs by hand; later a KMS-backed action signs and
 * confirms, and these states do not change (ADR 0010).
 */
export const confirmRegistration = action({
  args: { publicId: v.string(), txSignature: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<ConfirmedSuccessResult, ConfirmRegistrationErrorResult>> => {
    await requireIdentity(ctx);
    const target: Result<RegistrationTarget, RegistrationTargetError> = await ctx.runQuery(
      internal.guarantees.registration.loadRegistrationTarget,
      { publicId: args.publicId },
    );
    if (!target.success) return target;

    const txSignature = args.txSignature.trim();
    if (!isTxSignatureShape(txSignature)) {
      return {
        success: false,
        error: { code: CONFIRM_REGISTRATION_ERROR_CODE.INVALID_TX_SIGNATURE },
        message: "Not a Solana transaction signature",
      };
    }

    const verdict = await reserveReader.verifyRegistration(txSignature, {
      idHex: target.data.onchainIdHex,
      defaultCoverBaseUnits: target.data.defaultCoverBaseUnits,
      exitCoverBaseUnits: target.data.exitCoverBaseUnits,
    });

    if (!verdict.success) {
      if (verdict.error.code !== RESERVE_READER_ERROR_CODE.PROGRAM_ERROR) {
        return { success: false, error: { code: verdict.error.code }, message: verdict.message };
      }
      const { programErrorCode, programErrorName } = verdict.error;
      const recorded: Result<{ publicId: string }, RegistrationTargetError> = await ctx.runMutation(
        internal.guarantees.registration.recordRegistrationRefused,
        {
          publicId: args.publicId,
          txSignature,
          programErrorCode,
          programErrorName,
        },
      );
      if (!recorded.success) return recorded;
      return {
        success: false,
        error: {
          code: CONFIRM_REGISTRATION_ERROR_CODE.REGISTRATION_REFUSED,
          programErrorCode,
          programErrorName,
        },
        message: `The reserve refused the registration: ${programErrorName}`,
      };
    }

    const confirmed: Result<ConfirmedSuccessResult, ConfirmedErrorResult> = await ctx.runMutation(
      internal.guarantees.registration.recordRegistrationConfirmed,
      {
        publicId: args.publicId,
        txSignature,
        slot: verdict.data.slot,
        registeredAt: verdict.data.registeredAt,
      },
    );
    return confirmed;
  },
});
