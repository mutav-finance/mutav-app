import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Result } from "../lib/result";
import { assertAgencyAccess, mutationWithAgencyScope, mutationWithMutavRole } from "../lib/auth";
import {
  GUARANTEE_STATE,
  isInsured,
  type Guarantee,
  type GuaranteeId,
  type GuaranteeState,
} from "../guarantees/domain";
import {
  applyGuaranteeTransition,
  reserveCoverCapacity,
  type CoverCapacityError,
  type GuaranteeActor,
} from "../guarantees/transitions";
import type { UserId } from "../users/domain";
import { AUDIT_ACTION } from "../audit/domain";
import {
  DELINQUENCY_STATUS,
  assertTransition,
  NOTICE_RESOLUTION_KIND,
  NOTICE_CANCELLATION_REASON,
  NOTICE_EVIDENCE_SOURCE,
  noticeEvidenceSourceValidator,
  type DelinquencyNotice,
  type DelinquencyNoticeId,
} from "./domain";
import type { TransitionError } from "./machine";

// Reused across every state-changing mutation: the machine's guard error
// codes map 1:1 onto the mutation-level error codes for transition failures.
type TransitionErrorCode = TransitionError["code"];

/**
 * Agency-side dispositions act on `open` notices only. The machine allows
 * `verified → resolved | canceled` because staff close verified notices
 * (cover committed, dispute, dismissal); an agency must not be able to make a
 * default that compliance has already confirmed disappear.
 */
const NOTICE_VERIFIED_ERROR_CODE = "NOTICE_VERIFIED";
type NoticeVerifiedErrorCode = typeof NOTICE_VERIFIED_ERROR_CODE;

/**
 * The mirror image on the staff side: a cover draw is only legal against a
 * default compliance has actually confirmed. Without this the notice machine
 * alone would let `open → resolved(cover_committed)` through, and a sibling
 * notice's verification would supply the guarantee state the draw checks.
 */
const NOTICE_NOT_VERIFIED_ERROR_CODE = "NOTICE_NOT_VERIFIED";
type NoticeNotVerifiedErrorCode = typeof NOTICE_NOT_VERIFIED_ERROR_CODE;

/**
 * One wire code for "the guarantee machine refused the state change this
 * notice disposition implies". `applyGuaranteeTransition` reports seven
 * distinct guard codes; surfacing them raw would ask every caller to carry a
 * message key per guarantee state, and the caller's remedy is the same in all
 * seven cases. The refusal's own sentence travels in `message`.
 */
const GUARANTEE_REFUSED_ERROR_CODE = "GUARANTEE_TRANSITION_REFUSED";
type GuaranteeRefusedErrorCode = typeof GUARANTEE_REFUSED_ERROR_CODE;

type CoverCapacityErrorCode = CoverCapacityError["code"];

async function guaranteeActorFor(ctx: MutationCtx, userId: UserId): Promise<GuaranteeActor> {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error(`Authenticated user ${userId} has no row`);
  return { userId, username: user.name };
}

async function loadGuarantee(ctx: MutationCtx, guaranteeId: GuaranteeId): Promise<Guarantee> {
  const guarantee = await ctx.db.get(guaranteeId);
  if (!guarantee) throw new Error(`Notice points at a missing guarantee ${guaranteeId}`);
  return guarantee;
}

/**
 * Is anything still outstanding on this guarantee besides the notice being
 * closed right now? `by_guarantee_dueDate` ranges on its `guaranteeId` prefix,
 * so this reads exactly the notices of one guarantee — a handful, one per
 * missed rent — and nothing else. There is no (guarantee, status) index and
 * the row count does not warrant one.
 */
async function hasOtherOutstandingNotice(
  ctx: MutationCtx,
  {
    guaranteeId,
    exceptNoticeId,
  }: { guaranteeId: GuaranteeId; exceptNoticeId: DelinquencyNoticeId },
): Promise<boolean> {
  const notices = await ctx.db
    .query("guaranteeDelinquencyNotices")
    .withIndex("by_guarantee_dueDate", (q) => q.eq("guaranteeId", guaranteeId))
    .collect();
  return notices.some(
    (candidate) =>
      candidate._id !== exceptNoticeId &&
      (candidate.status === DELINQUENCY_STATUS.OPEN ||
        candidate.status === DELINQUENCY_STATUS.VERIFIED),
  );
}

/**
 * The only state an agency-filed notice can have put the guarantee in, so the
 * only one an agency disposition may take it out of. The machine would also
 * accept `default_verified → active` and `cover_committed → active`; walking
 * either of those back erases a confirmed default (and, for cover, a payout)
 * from the state counts and the transparency default rate, which is a
 * compliance judgement rather than a data-entry correction.
 */
const AGENCY_RETURN_TO_ACTIVE_FROM: readonly GuaranteeState[] = [GUARANTEE_STATE.IN_ARREARS];

/**
 * A compliance dismissal says the reported arrears was never real, so it may
 * also undo the verification this same office made — otherwise dismissing the
 * only notice of an episode strands the guarantee in `default_verified` with
 * nothing outstanding and no way back. `cover_committed` is deliberately
 * absent: cover has already moved cents, and handing them back needs
 * `releaseCoverCapacity`, deferred with the receivable ledger.
 */
const STAFF_DISMISSAL_RETURN_TO_ACTIVE_FROM: readonly GuaranteeState[] = [
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
];

/**
 * A guarantee is in arrears only while an outstanding notice says so, so the
 * last open or verified notice closing is what earns it its way back to
 * `active`. Returns the row to move, or null to leave the guarantee alone.
 *
 * `from` is the caller's own authority, not the machine's: the machine says
 * which moves are structurally legal, this list says which of them THIS
 * disposition is entitled to make.
 */
async function planReturnToActive(
  ctx: MutationCtx,
  { notice, from }: { notice: DelinquencyNotice; from: readonly GuaranteeState[] },
): Promise<Guarantee | null> {
  const guarantee = await loadGuarantee(ctx, notice.guaranteeId);
  if (!from.includes(guarantee.status)) return null;
  const stillOutstanding = await hasOtherOutstandingNotice(ctx, {
    guaranteeId: guarantee._id,
    exceptNoticeId: notice._id,
  });
  return stillOutstanding ? null : guarantee;
}

async function returnGuaranteeToActive(
  ctx: MutationCtx,
  { guarantee, actor, message }: { guarantee: Guarantee; actor: GuaranteeActor; message: string },
): Promise<void> {
  const applied = await applyGuaranteeTransition(ctx, {
    guarantee,
    to: GUARANTEE_STATE.ACTIVE,
    actor,
    message,
  });
  // The notice row is already patched here, so a refusal cannot be reported as
  // a clean Result without committing a half-applied cure. `planReturnToActive`
  // only hands back a state the machine can leave for `active`, so this fires
  // on a genuine invariant break — throwing rolls the whole transaction back.
  if (!applied.success) throw new Error(applied.message);
}

// ---------------------------------------------------------------------------
// openNotice — agency files a new delinquency notice
// ---------------------------------------------------------------------------

type OpenNoticeSuccess = { publicId: string };
type OpenNoticeError = {
  code:
    | "GUARANTEE_NOT_FOUND"
    | "GUARANTEE_NOT_INSURED"
    | "DUPLICATE_NOTICE"
    | "INVALID_EVIDENCE_SOURCE"
    | "INVALID_RENT_DUE_DATE"
    | "INVALID_AMOUNT"
    | GuaranteeRefusedErrorCode;
};

// YYYY-MM-DD, calendar-plausible (day 01-31). We don't fully validate
// calendar validity (Feb 30 is accepted); a later normalize-via-Date pass
// can tighten this if needed. Prevents ambiguous formats like ISO
// datetimes ("2026-06-05T00:00:00Z") which would bypass the
// `by_guarantee_dueDate` duplicate check and split the publicId collision
// domain — two calls for the same day would produce distinct publicIds.
const RENT_DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The agency-side entry point for filing a delinquency notice. Restricts
 * `evidenceSource` to `agency_reported` — higher-trust provenance
 * (`bank_attested`, `onchain_observed`, `system_scheduled`) belongs to
 * system paths and would falsely elevate the row on the transparency
 * dashboard if agencies could self-attest.
 */
export const openNotice = mutationWithAgencyScope({
  args: {
    guaranteePublicId: v.string(),
    rentDueDate: v.string(),
    originalAmountCents: v.number(),
    evidenceSource: v.optional(noticeEvidenceSourceValidator),
  },
  handler: async (ctx, args): Promise<Result<OpenNoticeSuccess, OpenNoticeError>> => {
    const evidenceSource = args.evidenceSource ?? NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED;
    if (evidenceSource !== NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED) {
      return {
        success: false,
        error: { code: "INVALID_EVIDENCE_SOURCE" },
        message:
          "Agency callers may only file notices with evidenceSource='agency_reported'. Higher-trust provenance is system-only.",
      };
    }

    if (!RENT_DUE_DATE_PATTERN.test(args.rentDueDate)) {
      return {
        success: false,
        error: { code: "INVALID_RENT_DUE_DATE" },
        message: `rentDueDate must be YYYY-MM-DD (got '${args.rentDueDate}').`,
      };
    }

    if (!Number.isInteger(args.originalAmountCents) || args.originalAmountCents <= 0) {
      return {
        success: false,
        error: { code: "INVALID_AMOUNT" },
        message: `originalAmountCents must be a positive integer (got ${args.originalAmountCents}).`,
      };
    }

    // `publicId` carries no DB-level uniqueness constraint, so the same value
    // can exist under two agencies; the caller's agency picks the row.
    const candidates = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.guaranteePublicId))
      .collect();
    const guarantee = candidates.find((candidate) => candidate.agencyId === ctx.agencyId);

    // Merge not-found + wrong-agency: same error surface avoids leaking
    // cross-agency existence to a caller that only has membership in a
    // different agency.
    if (!guarantee) {
      return {
        success: false,
        error: { code: "GUARANTEE_NOT_FOUND" },
        message: `No guarantee '${args.guaranteePublicId}' in this agency.`,
      };
    }

    // Any in-force state accepts a notice — a guarantee already in arrears or
    // under cover can miss another rent. Drafts and closed guarantees cannot.
    if (!isInsured(guarantee)) {
      return {
        success: false,
        error: { code: "GUARANTEE_NOT_INSURED" },
        message: `Guarantee '${guarantee.publicId}' is not in force (current status: '${guarantee.status}').`,
      };
    }

    // Idempotency: one OPEN notice per (guarantee, dueDate). Prior notices
    // that resolved or canceled are legal — the agency may re-file if a
    // stale/withdrawn notice needs to be reopened.
    const priorForDueDate = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_guarantee_dueDate", (q) =>
        q.eq("guaranteeId", guarantee._id).eq("rentDueDate", args.rentDueDate),
      )
      .collect();

    if (priorForDueDate.some((n) => n.status === DELINQUENCY_STATUS.OPEN)) {
      return {
        success: false,
        error: { code: "DUPLICATE_NOTICE" },
        message: `An open notice already exists for guarantee '${guarantee.publicId}' on ${args.rentDueDate}.`,
      };
    }

    // publicId: DN-<guaranteePublicId>-<yyyy-mm-dd>. basePublicId encodes the
    // exact rentDueDate, so every candidate collision is on the same
    // (guaranteeId, rentDueDate) tuple — which is exactly the
    // `by_guarantee_dueDate` prefix scanned into `priorForDueDate`. Suffixes
    // -2, -3, ... deterministic and greppable rather than random; picked
    // in-memory to avoid per-candidate DB round-trips.
    const yyyymmdd = args.rentDueDate.slice(0, 10);
    const basePublicId = `DN-${args.guaranteePublicId}-${yyyymmdd}`;
    const takenPublicIds = new Set(priorForDueDate.map((n) => n.publicId));
    let publicId = basePublicId;
    let suffix = 2;
    while (takenPublicIds.has(publicId)) {
      publicId = `${basePublicId}-${suffix}`;
      suffix += 1;
    }

    // The guarantee enters arrears in THIS transaction: a notice that commits
    // without the state change would leave every dashboard reading the
    // guarantee as performing. Run before the insert so a machine refusal
    // returns a Result with nothing written. A guarantee already past `active`
    // keeps the state it has and still records the notice — a tenant under
    // cover can miss another rent; `drafted` and `closed` never get here, the
    // `isInsured` guard above turned them away.
    if (guarantee.status === GUARANTEE_STATE.ACTIVE) {
      const applied = await applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.IN_ARREARS,
        actor: { userId: ctx.user._id, username: ctx.user.name },
        message: "Inadimplência registrada",
      });
      if (!applied.success) {
        return {
          success: false,
          error: { code: GUARANTEE_REFUSED_ERROR_CODE },
          message: applied.message,
        };
      }
    }

    const openedAt = new Date().toISOString();
    // TODO(audit): emit appendAuditEntry once agency-side audit lands. Pilot
    // relies on the openedByUserId column plus staff-side entries; see
    // docs/architecture/admin.md.
    await ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId,
      guaranteeId: guarantee._id,
      agencyId: ctx.agencyId,
      status: DELINQUENCY_STATUS.OPEN,
      rentDueDate: args.rentDueDate,
      originalAmountCents: args.originalAmountCents,
      updatedAmountCents: args.originalAmountCents,
      evidenceSource,
      openedAt,
      openedByUserId: ctx.user._id,
    });

    return {
      success: true,
      data: { publicId },
      message: `Delinquency notice '${publicId}' opened.`,
    };
  },
});

// ---------------------------------------------------------------------------
// markResolved — agency-triggered resolution (tenant_cured, stale)
// ---------------------------------------------------------------------------

type MarkResolvedSuccess = { publicId: string; guaranteeReturnedToActive: boolean };
type MarkResolvedError = {
  code: "NOTICE_NOT_FOUND" | NoticeVerifiedErrorCode | TransitionErrorCode;
};

/**
 * Agency-side resolution. Deliberately excludes `cover_committed` and
 * `staff_dispute` at the validator — those are staff-only dispositions.
 * Bare mutation + inline assertAgencyAccess is the resource-by-id pattern:
 * the deep-linkable noticePublicId means the agency ID comes from the row,
 * not from client args.
 */
export const markResolved = mutation({
  args: {
    noticePublicId: v.string(),
    resolution: v.object({
      kind: v.union(
        v.literal(NOTICE_RESOLUTION_KIND.TENANT_CURED),
        v.literal(NOTICE_RESOLUTION_KIND.STALE),
      ),
      note: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Result<MarkResolvedSuccess, MarkResolvedError>> => {
    const notice = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    // Write path: let the throw propagate on cross-agency access. Unlike
    // reads, writes should fail loudly — the caller must not silently
    // observe a null when their action was refused. `membership.userId` is
    // the authenticated caller's id — assertAgencyAccess resolved it from
    // the identity token — so no separate user re-fetch is needed.
    const membership = await assertAgencyAccess(ctx, notice.agencyId);

    if (notice.status === DELINQUENCY_STATUS.VERIFIED) {
      return {
        success: false,
        error: { code: NOTICE_VERIFIED_ERROR_CODE },
        message: `Delinquency notice '${notice.publicId}' is staff-verified; only staff may close it.`,
      };
    }

    const guard = assertTransition(notice.status, DELINQUENCY_STATUS.RESOLVED);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    // Only a cure says the arrears are gone. `stale` means the notice aged out
    // with nobody acting on it — the debt behind it was never shown to be
    // settled, so it must not hand the guarantee back its performing state.
    const cured =
      args.resolution.kind === NOTICE_RESOLUTION_KIND.TENANT_CURED
        ? await planReturnToActive(ctx, { notice, from: AGENCY_RETURN_TO_ACTIVE_FROM })
        : null;

    // TODO(audit): emit appendAuditEntry once agency-side audit lands; see
    // docs/architecture/admin.md.
    await ctx.db.patch(notice._id, {
      status: DELINQUENCY_STATUS.RESOLVED,
      resolution: {
        kind: args.resolution.kind,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: membership.userId,
        note: args.resolution.note,
      },
    });

    if (cured) {
      await returnGuaranteeToActive(ctx, {
        guarantee: cured,
        actor: await guaranteeActorFor(ctx, membership.userId),
        message: "Inadimplência regularizada",
      });
    }

    return {
      success: true,
      data: { publicId: notice.publicId, guaranteeReturnedToActive: cured !== null },
      message: `Delinquency notice '${notice.publicId}' resolved (${args.resolution.kind}).`,
    };
  },
});

// ---------------------------------------------------------------------------
// markCanceled — agency-triggered cancellation (agency_withdrew, duplicate,
// data_error)
// ---------------------------------------------------------------------------

type MarkCanceledSuccess = { publicId: string; guaranteeReturnedToActive: boolean };
type MarkCanceledError = {
  code: "NOTICE_NOT_FOUND" | NoticeVerifiedErrorCode | TransitionErrorCode;
};

/**
 * Agency-side cancellation. Validator excludes `staff_dismissed`, mirroring
 * the resolution/cancellation split enforced across the domain: staff-only
 * dispositions never reach an agency-facing wire type.
 */
export const markCanceled = mutation({
  args: {
    noticePublicId: v.string(),
    cancellation: v.object({
      reason: v.union(
        v.literal(NOTICE_CANCELLATION_REASON.AGENCY_WITHDREW),
        v.literal(NOTICE_CANCELLATION_REASON.DUPLICATE),
        v.literal(NOTICE_CANCELLATION_REASON.DATA_ERROR),
      ),
      note: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Result<MarkCanceledSuccess, MarkCanceledError>> => {
    const notice = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    // See markResolved above for why membership.userId (not a re-fetch) is
    // the authored-by id on a bare mutation.
    const membership = await assertAgencyAccess(ctx, notice.agencyId);

    if (notice.status === DELINQUENCY_STATUS.VERIFIED) {
      return {
        success: false,
        error: { code: NOTICE_VERIFIED_ERROR_CODE },
        message: `Delinquency notice '${notice.publicId}' is staff-verified; only staff may close it.`,
      };
    }

    const guard = assertTransition(notice.status, DELINQUENCY_STATUS.CANCELED);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    // A canceled notice is a notice that should never have existed, so it also
    // stops holding the guarantee in arrears. It never touches capacity: only
    // a cover resolution reserves, and cover is staff-only on a verified
    // notice, which an agency cannot cancel.
    const withdrawn = await planReturnToActive(ctx, {
      notice,
      from: AGENCY_RETURN_TO_ACTIVE_FROM,
    });

    // TODO(audit): emit appendAuditEntry once agency-side audit lands; see
    // docs/architecture/admin.md.
    await ctx.db.patch(notice._id, {
      status: DELINQUENCY_STATUS.CANCELED,
      cancellation: {
        reason: args.cancellation.reason,
        canceledAt: new Date().toISOString(),
        canceledByUserId: membership.userId,
        note: args.cancellation.note,
      },
    });

    if (withdrawn) {
      await returnGuaranteeToActive(ctx, {
        guarantee: withdrawn,
        actor: await guaranteeActorFor(ctx, membership.userId),
        message: "Acionamento de inadimplência cancelado",
      });
    }

    return {
      success: true,
      data: { publicId: notice.publicId, guaranteeReturnedToActive: withdrawn !== null },
      message: `Delinquency notice '${notice.publicId}' canceled (${args.cancellation.reason}).`,
    };
  },
});

// ---------------------------------------------------------------------------
// staffVerifyDefault — compliance confirms the reported arrears is a default
// ---------------------------------------------------------------------------

type StaffVerifyDefaultSuccess = {
  publicId: string;
  guaranteeStatus: GuaranteeState;
};
type StaffVerifyDefaultError = {
  code: "NOTICE_NOT_FOUND" | TransitionErrorCode | GuaranteeRefusedErrorCode;
};

/**
 * Guarantee states that already recognize the default episode this notice
 * belongs to. The second missed rent of one episode arrives while the
 * guarantee is past `in_arrears`, and the machine has no `default_verified`
 * self-edge and no edge back from `cover_committed` — so attempting the hop
 * again would refuse every notice filed after the first, and only the opening
 * notice of a default could ever be verified or covered.
 */
const DEFAULT_ALREADY_RECOGNIZED: readonly GuaranteeState[] = [
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
  GUARANTEE_STATE.IN_EVICTION,
];

/**
 * The gate between "the agency says the tenant missed rent" and "Mutav owes
 * the landlord". Verification is what makes a cover draw legal, so it carries
 * the compliance role and moves both machines at once: the notice to
 * `verified`, and the guarantee from `in_arrears` to `default_verified` the
 * first time an episode is confirmed.
 */
export const staffVerifyDefault = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    noticePublicId: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<StaffVerifyDefaultSuccess, StaffVerifyDefaultError>> => {
    const notice = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    const guard = assertTransition(notice.status, DELINQUENCY_STATUS.VERIFIED);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    // The guarantee moves first: it is the only step that can still be refused
    // without a write, and its own guards run before its first patch.
    const guarantee = await loadGuarantee(ctx, notice.guaranteeId);
    let guaranteeStatus: GuaranteeState = guarantee.status;
    if (guarantee.status === GUARANTEE_STATE.IN_ARREARS) {
      const applied = await applyGuaranteeTransition(ctx, {
        guarantee,
        to: GUARANTEE_STATE.DEFAULT_VERIFIED,
        actor: { userId: ctx.user._id, username: ctx.user.name },
        message: "Inadimplência confirmada pela Mutav",
      });
      if (!applied.success) {
        return {
          success: false,
          error: { code: GUARANTEE_REFUSED_ERROR_CODE },
          message: applied.message,
        };
      }
      guaranteeStatus = applied.data.to;
    } else if (!DEFAULT_ALREADY_RECOGNIZED.includes(guarantee.status)) {
      return {
        success: false,
        error: { code: GUARANTEE_REFUSED_ERROR_CODE },
        message: `Guarantee '${guarantee.publicId}' is '${guarantee.status}'; a default can only be verified on a guarantee in arrears or one already in default.`,
      };
    }

    const verifiedAt = new Date().toISOString();
    await ctx.db.patch(notice._id, {
      status: DELINQUENCY_STATUS.VERIFIED,
      verification: {
        verifiedAt,
        verifiedByUserId: ctx.user._id,
        note: args.note,
      },
    });

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.DELINQUENCY_VERIFIED,
      resourceType: "guaranteeDelinquencyNotices",
      resourceId: notice.publicId,
      payload: {
        noticeId: notice._id,
        guaranteeId: notice.guaranteeId,
        agencyId: notice.agencyId,
        originalAmountCents: notice.originalAmountCents,
        updatedAmountCents: notice.updatedAmountCents,
        verifiedAt,
        note: args.note ?? null,
      },
    });

    return {
      success: true,
      data: { publicId: notice.publicId, guaranteeStatus },
      message: `Delinquency notice '${notice.publicId}' verified.`,
    };
  },
});

// ---------------------------------------------------------------------------
// staffMarkResolvedByCover — cover_committed resolution, compliance+ only
// ---------------------------------------------------------------------------

type StaffResolveByCoverSuccess = { publicId: string; appliedCoverCents: number };
type StaffResolveByCoverError = {
  code:
    | "NOTICE_NOT_FOUND"
    | NoticeNotVerifiedErrorCode
    | TransitionErrorCode
    | GuaranteeRefusedErrorCode
    | CoverCapacityErrorCode;
};

/**
 * cover_committed is the money-committing resolution: Mutav has drawn from
 * the reserve to pay the landlord and a Regressive Receivable is born.
 * Compliance+ gate + hash-chained audit entry — coverOperationPublicId is
 * a free-form string until the coverOperations table lands (later slice).
 */
export const staffMarkResolvedByCover = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    noticePublicId: v.string(),
    // TODO(link): migrate to v.id("coverOperations") when the cover-integration
    // branch lands — currently coupled via publicId as a natural key.
    coverOperationPublicId: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<StaffResolveByCoverSuccess, StaffResolveByCoverError>> => {
    const notice = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    const guard = assertTransition(notice.status, DELINQUENCY_STATUS.RESOLVED);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    // The compliance gate on the money: cover draws against THIS notice, so
    // THIS notice must be the one compliance verified. The guarantee-state
    // check below cannot stand in for it — a sibling notice's verification is
    // what put the guarantee in `default_verified`.
    if (notice.status !== DELINQUENCY_STATUS.VERIFIED) {
      return {
        success: false,
        error: { code: NOTICE_NOT_VERIFIED_ERROR_CODE },
        message: `Delinquency notice '${notice.publicId}' is '${notice.status}'; only a staff-verified default may draw cover.`,
      };
    }

    const guarantee = await loadGuarantee(ctx, notice.guaranteeId);
    // Pre-check by state, not by the machine, so the draw below is the FIRST
    // write of the transaction: reserving cents and only then discovering the
    // guarantee cannot be covered would either commit an orphan reservation or
    // force a throw where a typed refusal belongs. The hop happens once per
    // episode — the first cover moves the guarantee to `cover_committed`, and
    // each further verified notice of the same episode draws more cents against
    // the same ceiling without moving the state again.
    const isFirstDraw = guarantee.status === GUARANTEE_STATE.DEFAULT_VERIFIED;
    if (!isFirstDraw && guarantee.status !== GUARANTEE_STATE.COVER_COMMITTED) {
      return {
        success: false,
        error: { code: GUARANTEE_REFUSED_ERROR_CODE },
        message: `Guarantee '${guarantee.publicId}' is '${guarantee.status}'; cover may only be committed against a verified default.`,
      };
    }

    // Draw the UPDATED amount, not the original: `updatedAmountCents` is what
    // the tenant owes the landlord at cover time — the original plus whatever
    // juros and multa have accrued since — and that is the figure Mutav pays
    // out. The schema keeps the field required and seeds it equal to the
    // original at open, so there is no "if present" branch to write.
    const actor: GuaranteeActor = { userId: ctx.user._id, username: ctx.user.name };
    const reserved = await reserveCoverCapacity(ctx, {
      guarantee,
      amountCents: notice.updatedAmountCents,
      actor,
    });
    if (!reserved.success) {
      return { success: false, error: { code: reserved.error.code }, message: reserved.message };
    }

    if (isFirstDraw) {
      const drawn = await loadGuarantee(ctx, notice.guaranteeId);
      const applied = await applyGuaranteeTransition(ctx, {
        guarantee: drawn,
        to: GUARANTEE_STATE.COVER_COMMITTED,
        actor,
        message: "Cobertura acionada pela Mutav",
      });
      // The from-state was checked above and capacity is already committed — a
      // refusal here is an invariant break, so throw and let the transaction
      // take the reservation back with it.
      if (!applied.success) throw new Error(applied.message);
    }

    const resolvedAt = new Date().toISOString();
    await ctx.db.patch(notice._id, {
      status: DELINQUENCY_STATUS.RESOLVED,
      resolution: {
        kind: NOTICE_RESOLUTION_KIND.COVER_COMMITTED,
        resolvedAt,
        resolvedByUserId: ctx.user._id,
        coverOperationPublicId: args.coverOperationPublicId,
        // The clamped figure, never the face amount: a later dispute reversal
        // releases exactly this many cents.
        appliedCoverCents: reserved.data.appliedCents,
        note: args.note,
      },
    });

    // Audit AFTER the patch: hash-chained entries should reflect committed
    // state only. If the patch throws, the audit row rolls back with the
    // rest of the transaction — no orphan entries in either direction.
    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.DELINQUENCY_RESOLVED_BY_COVER,
      resourceType: "guaranteeDelinquencyNotices",
      resourceId: notice.publicId,
      payload: {
        noticeId: notice._id,
        guaranteeId: notice.guaranteeId,
        agencyId: notice.agencyId,
        coverOperationPublicId: args.coverOperationPublicId,
        originalAmountCents: notice.originalAmountCents,
        updatedAmountCents: notice.updatedAmountCents,
        appliedCoverCents: reserved.data.appliedCents,
        capacity: reserved.data.capacity,
        resolvedAt,
        note: args.note ?? null,
      },
    });

    return {
      success: true,
      data: { publicId: notice.publicId, appliedCoverCents: reserved.data.appliedCents },
      message: `Delinquency notice '${notice.publicId}' resolved by cover for ${reserved.data.appliedCents} cents.`,
    };
  },
});

// ---------------------------------------------------------------------------
// staffMarkCanceledByDismissal — staff_dismissed OR staff_dispute
// ---------------------------------------------------------------------------

type StaffDismissSuccess = {
  publicId: string;
  terminalStatus: "canceled" | "resolved";
  guaranteeReturnedToActive: boolean;
};
type StaffDismissError = { code: "NOTICE_NOT_FOUND" | TransitionErrorCode };

/**
 * The two staff-only terminal dispositions share auth gate, cross-agency
 * scope, and audit shape — collapsed into one mutation with a discriminated
 * arg. Per contract-default-scenarios.md, `staff_dispute` is a RESOLUTION on
 * the notice (not a cancellation); the guarantee-level `closed(dispute_reversal)`
 * that follows belongs to the guarantees domain and is not this mutation's
 * responsibility.
 *
 * The two dispositions differ on the guarantee: a dismissal says the arrears
 * was never real and hands the guarantee back its performing state once nothing
 * else is outstanding, while a dispute leaves it in default for the reversal to
 * close.
 */
export const staffMarkCanceledByDismissal = mutationWithMutavRole({ minRole: "compliance" })({
  args: {
    noticePublicId: v.string(),
    disposition: v.object({
      kind: v.union(
        v.literal(NOTICE_CANCELLATION_REASON.STAFF_DISMISSED),
        v.literal(NOTICE_RESOLUTION_KIND.STAFF_DISPUTE),
      ),
      note: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Result<StaffDismissSuccess, StaffDismissError>> => {
    const notice = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.noticePublicId))
      .unique();
    if (!notice) {
      return {
        success: false,
        error: { code: "NOTICE_NOT_FOUND" },
        message: `No delinquency notice '${args.noticePublicId}'.`,
      };
    }

    const isDispute = args.disposition.kind === NOTICE_RESOLUTION_KIND.STAFF_DISPUTE;
    const target = isDispute ? DELINQUENCY_STATUS.RESOLVED : DELINQUENCY_STATUS.CANCELED;

    const guard = assertTransition(notice.status, target);
    if (!guard.success) {
      return { success: false, error: { code: guard.error.code }, message: guard.message };
    }

    // Planned before the notice is patched, so `hasOtherOutstandingNotice`
    // still sees this row's pre-dismissal status and excludes it by id rather
    // than by chance.
    const dismissed = isDispute
      ? null
      : await planReturnToActive(ctx, {
          notice,
          from: STAFF_DISMISSAL_RETURN_TO_ACTIVE_FROM,
        });

    const now = new Date().toISOString();
    if (isDispute) {
      await ctx.db.patch(notice._id, {
        status: DELINQUENCY_STATUS.RESOLVED,
        resolution: {
          kind: NOTICE_RESOLUTION_KIND.STAFF_DISPUTE,
          resolvedAt: now,
          resolvedByUserId: ctx.user._id,
          note: args.disposition.note,
        },
      });
    } else {
      await ctx.db.patch(notice._id, {
        status: DELINQUENCY_STATUS.CANCELED,
        cancellation: {
          reason: NOTICE_CANCELLATION_REASON.STAFF_DISMISSED,
          canceledAt: now,
          canceledByUserId: ctx.user._id,
          note: args.disposition.note,
        },
      });
    }

    await ctx.appendStaffAudit({
      action: isDispute ? AUDIT_ACTION.DELINQUENCY_DISPUTED : AUDIT_ACTION.DELINQUENCY_DISMISSED,
      resourceType: "guaranteeDelinquencyNotices",
      resourceId: notice.publicId,
      payload: {
        noticeId: notice._id,
        guaranteeId: notice.guaranteeId,
        agencyId: notice.agencyId,
        kind: args.disposition.kind,
        guaranteeReturnedToActive: dismissed !== null,
        at: now,
        note: args.disposition.note ?? null,
      },
    });

    if (dismissed) {
      await returnGuaranteeToActive(ctx, {
        guarantee: dismissed,
        actor: { userId: ctx.user._id, username: ctx.user.name },
        message: "Acionamento de inadimplência descartado pela Mutav",
      });
    }

    return {
      success: true,
      data: {
        publicId: notice.publicId,
        terminalStatus: target,
        guaranteeReturnedToActive: dismissed !== null,
      },
      message: `Delinquency notice '${notice.publicId}' ${target} by staff (${args.disposition.kind}).`,
    };
  },
});
