import { v } from "convex/values";
import { logError } from "../lib/logger";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import { assertAgencyAccess, queryWithAgencyScope, queryWithMutavRole } from "../lib/auth";
import type { UserId } from "../users/domain";
import type { AgencyId } from "../agencies/domain";
import {
  GUARANTEE_STATE,
  INSURED_STATES,
  isInsured,
  type GuaranteeCapacity,
  type GuaranteeId,
  type GuaranteeState,
} from "../guarantees/domain";
import { agencySubmittedTenant } from "../guarantees/tenantIdentity";
import { latestDueDateOnOrBefore } from "../leases/domain";
import { listEvidenceForNotice, type ClaimEvidenceRow } from "./claimEvidence";
import { claimReadiness, claimRulesFor } from "./claims";
import type { CoverOperation, CoverOperationStatus } from "../coverOperations/domain";
import {
  DELINQUENCY_STATUS,
  DELINQUENCY_STATUSES,
  agencyCanAct,
  brazilToday,
  caseGroupOf,
  caseGroupValidator,
  claimableFromDate,
  delinquencyStatusValidator,
  toAgencyCaseStatus,
  type AgencyCaseStatus,
  type CaseGroup,
  type ClaimEvidenceKind,
  type ClaimRequirement,
  type ClaimStatus,
  type DelinquencyNotice,
  type DelinquencyStatus,
  type NoticeEvidenceSource,
  type NoticeResolutionKind,
  type NoticeCancellationReason,
} from "./domain";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// Exported so tests can saturate the take ceiling to exercise the approx-flag
// branch without hard-coding the number in two places.
export const STATS_TAKE_LIMIT = 1000;

// The agency's `open` filter means "still outstanding": a staff-verified
// notice has not been settled either, so it stays in the same list. Each row
// still carries its own `caseStatus`, so the two are told apart on screen.
function matchesAgencyStatusFilter(
  status: DelinquencyStatus,
  filter: DelinquencyStatus | undefined,
): boolean {
  if (filter === undefined) return true;
  if (filter === DELINQUENCY_STATUS.OPEN) {
    return status === DELINQUENCY_STATUS.OPEN || status === DELINQUENCY_STATUS.VERIFIED;
  }
  return status === filter;
}

/**
 * The two non-terminal statuses — what the staff queue holds. Narrower than
 * `DelinquencyStatus` so a caller switching on a queue row does not have to
 * write unreachable `resolved` / `canceled` arms.
 */
export type OutstandingNoticeStatus =
  | typeof DELINQUENCY_STATUS.OPEN
  | typeof DELINQUENCY_STATUS.VERIFIED;

// ---- projection shapes -----------------------------------------------------
// Server-owned response types. Callers (UI, tests, internal wrappers) couple
// to THESE, not to `Doc<'guaranteeDelinquencyNotices'>` — so future schema
// tweaks (new envelope fields, renamed system columns) do not ripple out.

/**
 * List-row shape. Drops Convex system fields (`_id`, `_creationTime`) and
 * the write-side envelopes (`resolution`, `cancellation`) — surfaces just the
 * timestamp needed for a "resolved 3d ago"-style column.
 */
export type DelinquencyNoticeRow = {
  publicId: string;
  guaranteeId: GuaranteeId;
  status: DelinquencyStatus;
  caseStatus: AgencyCaseStatus;
  /** Whether the agency may still withdraw the notice or mark it cured. */
  canAct: boolean;
  claimStatus: ClaimStatus | null;
  /**
   * First day the claim may be filed. Returned so the client can split
   * `reported` from `ready_to_claim` as days pass without a data change
   * (a query result does not refresh on its own when the date rolls over).
   */
  claimableFrom: string;
  rentDueDate: string;
  originalAmountCents: number;
  updatedAmountCents: number;
  evidenceSource: NoticeEvidenceSource;
  openedAt: string;
  resolvedAt: string | null;
  canceledAt: string | null;
};

/**
 * Detail shape — superset of the row with the full resolution/cancellation
 * envelopes for the detail drawer. Still no Convex system fields.
 */
export type DelinquencyNoticeDetail = DelinquencyNoticeRow & {
  openedByUserId: UserId;
  agencyId: AgencyId;
  /** When staff confirmed the default; null until then. */
  verifiedAt: string | null;
  guaranteePublicId: string;
  /** Blank when the agency's own submission is missing (never the registry's). */
  tenantName: string;
  streetAndNumber: string;
  complement: string;
  resolution: {
    kind: NoticeResolutionKind;
    resolvedAt: string;
    /** Null when the system expired the notice. */
    resolvedByUserId: UserId | null;
    coverOperationPublicId: string | null;
    note: string | null;
  } | null;
  cancellation: {
    reason: NoticeCancellationReason;
    canceledAt: string;
    canceledByUserId: UserId;
    note: string | null;
  } | null;
  claim: {
    claimedAmountCents: number;
    submittedAt: string;
    requests: {
      id: string;
      evidenceKind: ClaimEvidenceKind;
      reason: string;
      dueAt: string;
      requestedAt: string;
      resolvedAt: string | null;
    }[];
  } | null;
  evidence: ClaimEvidenceRow[];
  /** What still blocks filing the claim; empty once it can be filed. */
  missingRequirements: ClaimRequirement[];
  /** The payout behind a cover resolution; null for every other outcome. */
  cover: {
    status: CoverOperationStatus;
    requestedCents: number;
    appliedCents: number;
    executedAt: string | null;
    paymentReference: string | null;
  } | null;
};

/**
 * Staff-queue row. Includes `agencyId` so the queue UI can group across
 * agencies; drops `openedByUserId` (the queue does not surface the
 * agency-side author).
 *
 * The joined fields are what a triage decision needs and cannot be fetched
 * per row from the client: the staff queue spans agencies, and every
 * guarantee, lease and tenant read the admin console could reach is either
 * agency-scoped or membership-gated. `guaranteeCapacity` in particular is not
 * decoration — `coverOperations.staffRecordCover` CLAMPS its draw to
 * `capacity.availableCents`, so an operator who cannot see the remaining
 * ceiling before submitting cannot tell whether the landlord is made whole.
 */
export type DelinquencyAdminQueueRow = {
  publicId: string;
  /**
   * `open` or `verified` — the two outstanding statuses. The queue carries it
   * because the staff dispositions are status-gated: `staffVerifyDefault`
   * takes an `open` notice, `coverOperations.staffRecordCover` refuses anything but a
   * `verified` one.
   */
  status: OutstandingNoticeStatus;
  agencyId: AgencyId;
  agencyName: string;
  guaranteeId: GuaranteeId;
  guaranteePublicId: string;
  guaranteeState: GuaranteeState;
  guaranteeCapacity: GuaranteeCapacity;
  /** Null only when the lease's registry row is gone — rendered as a dash. */
  tenantName: string | null;
  rentDueDate: string;
  originalAmountCents: number;
  updatedAmountCents: number;
  evidenceSource: NoticeEvidenceSource;
  openedAt: string;
  /**
   * Null while the agency has only reported late rent: staff can verify a
   * notice only once its claim is `submitted`.
   */
  claimStatus: ClaimStatus | null;
  claimedAmountCents: number | null;
  evidence: ClaimEvidenceRow[];
};

async function loadCoverOperation(
  ctx: QueryCtx,
  notice: DelinquencyNotice,
): Promise<CoverOperation | null> {
  const coverOperationId = notice.resolution?.coverOperationId;
  return coverOperationId ? await ctx.db.get(coverOperationId) : null;
}

async function claimableFromFor(ctx: QueryCtx, notice: DelinquencyNotice): Promise<string> {
  const guarantee = await ctx.db.get(notice.guaranteeId);
  if (!guarantee) {
    throw new Error(`Delinquency notice ${notice.publicId} references a missing guarantees row`);
  }
  const rules = await claimRulesFor(ctx, guarantee);
  return claimableFromDate({ rentDueDate: notice.rentDueDate, rules });
}

async function shapeAgencyNoticeRow(
  ctx: QueryCtx,
  notice: DelinquencyNotice,
  today: string,
): Promise<DelinquencyNoticeRow> {
  return shapeDelinquencyNoticeRow(notice, {
    coverOperation: await loadCoverOperation(ctx, notice),
    claimableFrom: await claimableFromFor(ctx, notice),
    today,
  });
}

function shapeDelinquencyNoticeRow(
  notice: DelinquencyNotice,
  {
    coverOperation,
    claimableFrom,
    today,
  }: { coverOperation: CoverOperation | null; claimableFrom: string; today: string },
): DelinquencyNoticeRow {
  return {
    publicId: notice.publicId,
    guaranteeId: notice.guaranteeId,
    status: notice.status,
    caseStatus: toAgencyCaseStatus({ notice, coverOperation, claimableFrom, today }),
    canAct: agencyCanAct(notice.status),
    claimStatus: notice.claim?.status ?? null,
    claimableFrom,
    rentDueDate: notice.rentDueDate,
    originalAmountCents: notice.originalAmountCents,
    updatedAmountCents: notice.updatedAmountCents,
    evidenceSource: notice.evidenceSource,
    openedAt: notice.openedAt,
    resolvedAt: notice.resolution?.resolvedAt ?? null,
    canceledAt: notice.cancellation?.canceledAt ?? null,
  };
}

async function shapeDelinquencyNoticeDetail(
  ctx: QueryCtx,
  notice: DelinquencyNotice,
): Promise<DelinquencyNoticeDetail> {
  const coverOperation = await loadCoverOperation(ctx, notice);
  const readiness = await claimReadiness(ctx, notice);
  const guarantee = await ctx.db.get(notice.guaranteeId);
  if (!guarantee) {
    throw new Error(`Delinquency notice ${notice.publicId} references a missing guarantees row`);
  }
  const lease = await ctx.db.get(guarantee.leaseId);
  if (!lease) {
    throw new Error(`Guarantee ${guarantee.publicId} references a missing leases row`);
  }
  const tenant = await agencySubmittedTenant(ctx, guarantee);
  return {
    ...shapeDelinquencyNoticeRow(notice, {
      coverOperation,
      claimableFrom: readiness.claimableFrom,
      today: brazilToday(Date.now()),
    }),
    claim: notice.claim
      ? {
          claimedAmountCents: notice.claim.claimedAmountCents,
          submittedAt: notice.claim.submittedAt,
          requests: notice.claim.requests.map((request) => ({
            id: request.id,
            evidenceKind: request.evidenceKind,
            reason: request.reason,
            dueAt: request.dueAt,
            requestedAt: request.requestedAt,
            resolvedAt: request.resolvedAt ?? null,
          })),
        }
      : null,
    evidence: await listEvidenceForNotice(ctx, notice._id),
    missingRequirements: readiness.missing,
    openedByUserId: notice.openedByUserId,
    agencyId: notice.agencyId,
    verifiedAt: notice.verification?.verifiedAt ?? null,
    guaranteePublicId: guarantee.publicId,
    tenantName: tenant?.fullName ?? "",
    streetAndNumber: lease.property.streetAndNumber,
    complement: lease.property.complement,
    resolution: notice.resolution
      ? {
          kind: notice.resolution.kind,
          resolvedAt: notice.resolution.resolvedAt,
          resolvedByUserId: notice.resolution.resolvedByUserId ?? null,
          coverOperationPublicId: notice.resolution.coverOperationPublicId ?? null,
          note: notice.resolution.note ?? null,
        }
      : null,
    cancellation: notice.cancellation
      ? {
          reason: notice.cancellation.reason,
          canceledAt: notice.cancellation.canceledAt,
          canceledByUserId: notice.cancellation.canceledByUserId,
          note: notice.cancellation.note ?? null,
        }
      : null,
    cover: coverOperation
      ? {
          status: coverOperation.status,
          requestedCents: coverOperation.requestedCents,
          appliedCents: coverOperation.appliedCents,
          executedAt: coverOperation.execution?.executedAt ?? null,
          paymentReference: coverOperation.execution?.paymentReference ?? null,
        }
      : null,
  };
}

function outstandingStatusOf(notice: DelinquencyNotice): OutstandingNoticeStatus {
  if (notice.status === DELINQUENCY_STATUS.OPEN || notice.status === DELINQUENCY_STATUS.VERIFIED) {
    return notice.status;
  }
  throw new Error(
    `Delinquency notice ${notice.publicId} is '${notice.status}'; the staff queue holds outstanding notices only.`,
  );
}

/**
 * Async because the queue row is a join. `agencyId`, `guaranteeId` and
 * `leaseId` are required columns and none of those rows are ever deleted, so
 * a miss is corrupted data rather than an access case — it throws, exactly as
 * `guarantees.getByPublicId` does for a missing lease.
 *
 * The tenant name comes from the shared registry row rather than the owning
 * agency's own submission. The agency-facing reads refuse that fallback
 * because it would show agency A whatever agency B wrote for the same person
 * (LGPD-26); this caller is platform-scoped compliance staff, who already
 * read every agency, so the disclosure that rule prevents cannot happen here.
 */
async function shapeDelinquencyAdminQueueRow(
  ctx: QueryCtx,
  notice: DelinquencyNotice,
): Promise<DelinquencyAdminQueueRow> {
  const agency = await ctx.db.get(notice.agencyId);
  if (!agency) {
    throw new Error(`Delinquency notice ${notice.publicId} references a missing agencies row`);
  }
  const guarantee = await ctx.db.get(notice.guaranteeId);
  if (!guarantee) {
    throw new Error(`Delinquency notice ${notice.publicId} references a missing guarantees row`);
  }
  const lease = await ctx.db.get(guarantee.leaseId);
  if (!lease) {
    throw new Error(`Guarantee ${guarantee.publicId} references a missing leases row`);
  }
  const tenant = await ctx.db.get(lease.tenantId);

  return {
    publicId: notice.publicId,
    status: outstandingStatusOf(notice),
    agencyId: notice.agencyId,
    agencyName: agency.name,
    guaranteeId: notice.guaranteeId,
    guaranteePublicId: guarantee.publicId,
    guaranteeState: guarantee.status,
    guaranteeCapacity: guarantee.capacity,
    tenantName: tenant?.fullName ?? null,
    rentDueDate: notice.rentDueDate,
    originalAmountCents: notice.originalAmountCents,
    updatedAmountCents: notice.updatedAmountCents,
    evidenceSource: notice.evidenceSource,
    openedAt: notice.openedAt,
    claimStatus: notice.claim?.status ?? null,
    claimedAmountCents: notice.claim?.claimedAmountCents ?? null,
    evidence: await listEvidenceForNotice(ctx, notice._id),
  };
}

// ---- queries ---------------------------------------------------------------

/**
 * Paginated agency-scoped notice list. `by_agency_status` pre-filters both
 * dimensions; date/amount filters run post-index on the page to keep the
 * composite index tuple narrow.
 *
 * ⚠️ Paginator contract caveat when ANY of `dueDateFrom`/`dueDateTo`/
 * `amountFromCents`/`amountToCents` is set: post-index filtering runs AFTER
 * `.paginate()`, so `page.length` is a CEILING (`≤ paginationOpts.numItems`),
 * NOT a target. A short page does NOT signal end-of-list — callers MUST keep
 * paging until `isDone === true`. Treat `numItems` as "at most this many per
 * page" and never as "if fewer, we're done".
 *
 * TODO(index): promote to a composite `by_agency_status_dueDate` (and/or
 * `_amount`) once filter usage or row counts justify it — that would move
 * every predicate into the index scan and restore honest page sizes.
 *
 * UI adapter placement: the agency's `DelinquencyPage` renders a
 * `DelinquencyRow` shape with `propertyId` + formatted `noticeAt`. That
 * adapter (property join + `Intl` date formatting per active locale) lives
 * client-side in `apps/agency/src/components/delinquencies/` — the property
 * join needs a guarantee → lease read per row and the date format is locale-aware,
 * neither of which belongs in this projection.
 */
// A guarantee files at most one notice per rent due date, so this bounds
// decades of monthly history while keeping the read finite.
const GUARANTEE_NOTICE_HISTORY_LIMIT = 500;

export const listByAgency = queryWithAgencyScope({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(delinquencyStatusValidator),
    dueDateFrom: v.optional(v.string()),
    dueDateTo: v.optional(v.string()),
    amountFromCents: v.optional(v.number()),
    amountToCents: v.optional(v.number()),
    // Scopes the list to one guarantee's notice history. Here an omitted
    // `status` means every status, not `open`: the guarantee page links in to
    // show the whole history, and one guarantee's notices are a handful, so the
    // list is read whole instead of paged.
    guaranteePublicId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: DelinquencyNoticeRow[]; isDone: boolean; continueCursor: string }> => {
    // Normalize both sides of the compare to YYYY-MM-DD so a caller passing
    // an ISO datetime (e.g. "2026-06-05T00:00:00Z") is compared against the
    // stored day, not lex-compared with a longer string that diverges at
    // position 10. `rentDueDate` is enforced to YYYY-MM-DD at write time by
    // openNotice's validator; the .slice keeps this query defensive.
    const today = brazilToday(Date.now());
    const dueDateFrom = args.dueDateFrom?.slice(0, 10);
    const dueDateTo = args.dueDateTo?.slice(0, 10);
    const matchesFilters = (notice: DelinquencyNotice) =>
      (dueDateFrom == null || notice.rentDueDate.slice(0, 10) >= dueDateFrom) &&
      (dueDateTo == null || notice.rentDueDate.slice(0, 10) <= dueDateTo) &&
      (args.amountFromCents == null || notice.originalAmountCents >= args.amountFromCents) &&
      (args.amountToCents == null || notice.originalAmountCents <= args.amountToCents);

    const { guaranteePublicId } = args;
    if (guaranteePublicId !== undefined) {
      // `publicId` is unique only per agency, so the caller's agency picks the
      // row — a publicId from another agency resolves to nothing and yields an
      // empty page rather than that agency's notices.
      const guarantee = (
        await ctx.db
          .query("guarantees")
          .withIndex("by_publicId", (q) => q.eq("publicId", guaranteePublicId))
          .collect()
      ).find((candidate) => candidate.agencyId === ctx.agencyId);
      const notices = guarantee
        ? await ctx.db
            .query("guaranteeDelinquencyNotices")
            .withIndex("by_guarantee_dueDate", (q) => q.eq("guaranteeId", guarantee._id))
            .take(GUARANTEE_NOTICE_HISTORY_LIMIT)
        : [];
      const page = await Promise.all(
        notices
          .filter(
            (notice) =>
              matchesAgencyStatusFilter(notice.status, args.status) && matchesFilters(notice),
          )
          .sort((a, b) => b._creationTime - a._creationTime)
          .map((notice) => shapeAgencyNoticeRow(ctx, notice, today)),
      );
      return { page, isDone: true, continueCursor: "" };
    }

    const status = args.status ?? DELINQUENCY_STATUS.OPEN;
    const result = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId).eq("status", status))
      .order("desc")
      .paginate(args.paginationOpts);
    // Verified notices ride along with the open page (see
    // `matchesAgencyStatusFilter`);
    // the agency list reads a single page, so a bounded take is enough.
    const verifiedRows =
      status === DELINQUENCY_STATUS.OPEN
        ? await ctx.db
            .query("guaranteeDelinquencyNotices")
            .withIndex("by_agency_status", (q) =>
              q.eq("agencyId", ctx.agencyId).eq("status", DELINQUENCY_STATUS.VERIFIED),
            )
            .order("desc")
            .take(args.paginationOpts.numItems)
        : [];

    const page = await Promise.all(
      [...verifiedRows, ...result.page]
        .sort((a, b) => b._creationTime - a._creationTime)
        .filter(matchesFilters)
        .map((notice) => shapeAgencyNoticeRow(ctx, notice, today)),
    );

    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * Resource-by-id read. Returns null on both not-found and cross-agency
 * access-denied to avoid leaking existence — same shape as
 * `invoices.getByPublicId` and `guarantees.getByPublicId`.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<DelinquencyNoticeDetail | null> => {
    const notice = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!notice) return null;

    try {
      await assertAgencyAccess(ctx, notice.agencyId);
    } catch {
      return null;
    }

    return await shapeDelinquencyNoticeDetail(ctx, notice);
  },
});

/**
 * Per-agency KPI counts: total open + 30-day resolved/canceled windows.
 *
 * ⚠️ Interim correctness ceiling: `.take(STATS_TAKE_LIMIT)` returns notices
 * in `by_agency_status` order (agency+status only — NO time ordering), so
 * `.order('desc')` here means "descending by document id", not by resolvedAt.
 * The 30-day counts are only accurate while an agency has ≤1000 total
 * resolved/canceled notices; once it exceeds that, recent notices could sit
 * outside the take window and be under-counted. `approxResolved` /
 * `approxCanceled` flag when the take limit was hit so the UI can render a
 * "1000+" style label rather than silently under-report.
 *
 * Envelope invariant: terminal rows (`resolved`/`canceled`) must carry their
 * resolution/cancellation envelope. A missing envelope is a schema-drift bug,
 * not a valid row — silently coercing to `''` would lex-compare LOWER than
 * any ISO string and drop the row from the 30-day KPI without signal. The
 * counter logs and skips a malformed row rather than under-count it silently.
 *
 * TODO(#agg): swap to a namespaced `notice-by-status` aggregate before any
 * agency approaches ~1000 recent notices — or add a
 * `by_agency_status_resolvedAt` / `_canceledAt` index and range-scan since
 * `since`, which drops the ceiling entirely.
 */
export const openStats = queryWithAgencyScope({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    openCount: number;
    resolvedCountLast30d: number;
    canceledCountLast30d: number;
    approxOpen: boolean;
    approxResolved: boolean;
    approxCanceled: boolean;
  }> => {
    // Envelope timestamps compare via Date, not lex — a future writer
    // emitting non-Z ISO offsets (e.g. seed rows with `-03:00`) still gets
    // ordered correctly. Lex-compare would silently exclude offset-carrying
    // rows whose lexicographic ordering diverges from their true instant.
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    // `.order('desc')` is load-bearing: without it Convex returns the OLDEST
    // rows first, so any agency with >STATS_TAKE_LIMIT rows in a status
    // would get resolvedCountLast30d/canceledCountLast30d = 0 (the 1000
    // oldest rows are all outside the window). `.order('desc')` + take
    // gives us the most-recent 1000 — the window we actually want.
    const [openRows, verifiedRows, resolvedRows, canceledRows] = await Promise.all([
      ctx.db
        .query("guaranteeDelinquencyNotices")
        .withIndex("by_agency_status", (q) =>
          q.eq("agencyId", ctx.agencyId).eq("status", DELINQUENCY_STATUS.OPEN),
        )
        .order("desc")
        .take(STATS_TAKE_LIMIT),
      ctx.db
        .query("guaranteeDelinquencyNotices")
        .withIndex("by_agency_status", (q) =>
          q.eq("agencyId", ctx.agencyId).eq("status", DELINQUENCY_STATUS.VERIFIED),
        )
        .order("desc")
        .take(STATS_TAKE_LIMIT),
      ctx.db
        .query("guaranteeDelinquencyNotices")
        .withIndex("by_agency_status", (q) =>
          q.eq("agencyId", ctx.agencyId).eq("status", DELINQUENCY_STATUS.RESOLVED),
        )
        .order("desc")
        .take(STATS_TAKE_LIMIT),
      ctx.db
        .query("guaranteeDelinquencyNotices")
        .withIndex("by_agency_status", (q) =>
          q.eq("agencyId", ctx.agencyId).eq("status", DELINQUENCY_STATUS.CANCELED),
        )
        .order("desc")
        .take(STATS_TAKE_LIMIT),
    ]);

    const resolvedCountLast30d = resolvedRows.filter((notice) => {
      const resolvedAt = notice.resolution?.resolvedAt;
      if (resolvedAt == null) {
        logError(
          `[delinquencies.openStats] resolved notice ${notice.publicId} is missing its resolution envelope; skipping in 30d KPI.`,
        );
        return false;
      }
      return new Date(resolvedAt) >= since;
    }).length;

    const canceledCountLast30d = canceledRows.filter((notice) => {
      const canceledAt = notice.cancellation?.canceledAt;
      if (canceledAt == null) {
        logError(
          `[delinquencies.openStats] canceled notice ${notice.publicId} is missing its cancellation envelope; skipping in 30d KPI.`,
        );
        return false;
      }
      return new Date(canceledAt) >= since;
    }).length;

    return {
      openCount: openRows.length + verifiedRows.length,
      resolvedCountLast30d,
      canceledCountLast30d,
      approxOpen: openRows.length === STATS_TAKE_LIMIT || verifiedRows.length === STATS_TAKE_LIMIT,
      approxResolved: resolvedRows.length === STATS_TAKE_LIMIT,
      approxCanceled: canceledRows.length === STATS_TAKE_LIMIT,
    };
  },
});

/**
 * Cross-agency staff queue of outstanding notices, FIFO by `openedAt`.
 * `compliance` is the correct rung — support is KYC-only per the mutavStaff
 * ladder; admin over-privileges a read.
 *
 * `verified` rides along with `open` for the same reason it does in
 * `listByAgency`: verification is a step INSIDE the queue, not an exit from
 * it. `coverOperations.staffRecordCover` refuses anything but a `verified` notice, so
 * a queue that dropped a notice the moment compliance verified it would make
 * the cover step unreachable from the only screen that offers it.
 *
 * The merge is first-page-only. `.paginate()` cursors belong to the `open`
 * index scan alone, so taking the verified rows on every page would repeat
 * each of them once per page rather than paging them. Verified notices are
 * the short leg of the queue by construction (they are the ones staff have
 * already picked up), so a bounded take on the first page shows the work
 * without inventing a second cursor.
 */
export const listOpenAdminQueue = queryWithMutavRole({ minRole: "compliance" })({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    args,
  ): Promise<{
    page: DelinquencyAdminQueueRow[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const result = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_status_openedAt", (q) => q.eq("status", DELINQUENCY_STATUS.OPEN))
      .order("asc")
      .paginate(args.paginationOpts);

    const verifiedRows =
      args.paginationOpts.cursor === null
        ? await ctx.db
            .query("guaranteeDelinquencyNotices")
            .withIndex("by_status_openedAt", (q) => q.eq("status", DELINQUENCY_STATUS.VERIFIED))
            .order("asc")
            .take(args.paginationOpts.numItems)
        : [];

    // Plain lex compare, not `localeCompare`: `by_status_openedAt` orders the
    // rows lexicographically, so the merge has to use the same comparison the
    // index used or the two legs interleave in an order neither scan produced.
    const notices = [...verifiedRows, ...result.page].sort((a, b) =>
      a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : 0,
    );

    return {
      page: await Promise.all(notices.map((notice) => shapeDelinquencyAdminQueueRow(ctx, notice))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Private companion to `getByPublicId`. Callers (mutations, actions,
 * scheduled jobs) that authorize by a non-user model must invoke this
 * instead — auth is enforced at the public entry point, not here.
 *
 * Returns the raw `Doc<>` intentionally: internal callers legitimately need
 * every field (including `_id`, `_creationTime`, envelope timestamps) to
 * perform writes or downstream lookups. The explicit annotation makes that
 * intent load-bearing rather than inferred.
 */
export const getByPublicIdInternal = internalQuery({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }): Promise<DelinquencyNotice | null> => {
    return ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique();
  },
});

// ---- reporting late rent: guarantee picker ----------------------------------

/**
 * One row of the "which guarantee?" picker an agency sees when it reports late
 * rent from the claims list. People pick by tenant and address, so those lead;
 * the public id rides along only so the chosen row can be submitted.
 */
export type ReportableGuaranteeRow = {
  guaranteePublicId: string;
  guaranteeState: GuaranteeState;
  /** False for drafts: they match the search but cannot take a notice. */
  eligible: boolean;
  /** Blank when the agency's own submission is missing (never the registry's). */
  tenantName: string;
  streetAndNumber: string;
  complement: string;
  cityUF: string;
  totalRentCents: number;
  dueDay: number;
  activatedAt: string | null;
  /** The most recent due date that has passed; null for drafts. */
  lastDueDate: string | null;
  /** `YYYY-MM` months that already have an open or staff-verified notice. */
  outstandingMonths: string[];
};

const REPORTABLE_PER_STATE_LIMIT = 500;

/**
 * Every guarantee the agency could report late rent on, plus its drafts flagged
 * ineligible so a search for a tenant whose guarantee is not yet in force
 * explains itself instead of returning nothing. Sorted by the due date that
 * passed most recently — the rent that just came due is the likely one.
 *
 * One `by_agency_status` read per state: the insured states are not
 * contiguous in the index, and an agency's book is dozens of rows, so the
 * text match runs on the client.
 */
export const listReportableGuarantees = queryWithAgencyScope({
  args: {},
  handler: async (ctx): Promise<ReportableGuaranteeRow[]> => {
    const today = brazilToday(Date.now());
    const states: readonly GuaranteeState[] = [...INSURED_STATES, GUARANTEE_STATE.DRAFTED];
    const guarantees = (
      await Promise.all(
        states.map((status) =>
          ctx.db
            .query("guarantees")
            .withIndex("by_agency_status", (q) =>
              q.eq("agencyId", ctx.agencyId).eq("status", status),
            )
            .take(REPORTABLE_PER_STATE_LIMIT),
        ),
      )
    ).flat();

    const rows = await Promise.all(
      guarantees.map(async (guarantee): Promise<ReportableGuaranteeRow> => {
        const lease = await ctx.db.get(guarantee.leaseId);
        if (!lease) {
          throw new Error(`Guarantee ${guarantee.publicId} references a missing leases row`);
        }
        const tenant = await agencySubmittedTenant(ctx, guarantee);
        const eligible = isInsured(guarantee);
        const notices = await ctx.db
          .query("guaranteeDelinquencyNotices")
          .withIndex("by_guarantee_dueDate", (q) => q.eq("guaranteeId", guarantee._id))
          .take(GUARANTEE_NOTICE_HISTORY_LIMIT);
        return {
          guaranteePublicId: guarantee.publicId,
          guaranteeState: guarantee.status,
          eligible,
          tenantName: tenant?.fullName ?? "",
          streetAndNumber: lease.property.streetAndNumber,
          complement: lease.property.complement,
          cityUF: lease.property.cityUF,
          totalRentCents: lease.rent.totalRentCents,
          dueDay: lease.rent.dueDay,
          activatedAt: guarantee.activatedAt,
          lastDueDate: eligible
            ? latestDueDateOnOrBefore({ isoDate: today, dueDay: lease.rent.dueDay })
            : null,
          outstandingMonths: notices
            .filter(
              (notice) =>
                notice.status === DELINQUENCY_STATUS.OPEN ||
                notice.status === DELINQUENCY_STATUS.VERIFIED,
            )
            .map((notice) => notice.rentDueDate.slice(0, 7)),
        };
      }),
    );

    return rows.sort(compareReportable);
  },
});

/** Eligible first, then the most recently passed due date, then tenant name. */
function compareReportable(a: ReportableGuaranteeRow, b: ReportableGuaranteeRow): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  const byDueDate = (b.lastDueDate ?? "").localeCompare(a.lastDueDate ?? "");
  if (byDueDate !== 0) return byDueDate;
  return a.tenantName.localeCompare(b.tenantName, "pt-BR");
}

// ---- the agency's claims queue ----------------------------------------------

/**
 * One case in the agency's queue. People recognise a case by tenant, address
 * and month, so those lead; the public ids ride along for links only.
 */
export type ClaimCaseRow = {
  publicId: string;
  guaranteePublicId: string;
  tenantName: string;
  streetAndNumber: string;
  complement: string;
  rentDueDate: string;
  originalAmountCents: number;
  caseStatus: AgencyCaseStatus;
  claimableFrom: string;
  /** Earliest deadline among unanswered staff requests; null when none. */
  requestDueAt: string | null;
  /** The latest thing that happened to the case, for the "Atualizado" column. */
  updatedAt: string;
};

const CASES_PER_STATUS_LIMIT = 200;

function lastActivityAt(notice: DelinquencyNotice): string {
  const stamps = [
    notice.openedAt,
    notice.claim?.submittedAt,
    ...(notice.claim?.requests.flatMap((request) => [request.requestedAt, request.resolvedAt]) ??
      []),
    notice.verification?.verifiedAt,
    notice.resolution?.resolvedAt,
    notice.cancellation?.canceledAt,
  ].filter((stamp): stamp is string => typeof stamp === "string");
  return stamps.reduce((latest, stamp) =>
    Date.parse(stamp) > Date.parse(latest) ? stamp : latest,
  );
}

/**
 * The agency's claims queue: the cases of one group plus the size of every
 * group (for the tab counts and the nav badge). The group is derived from the
 * case status, which needs the cover row and today's date, so all statuses
 * are read and partitioned here rather than by index — an agency's case book
 * is small, and each status read is bounded.
 */
export const listCases = queryWithAgencyScope({
  args: { group: caseGroupValidator },
  handler: async (
    ctx,
    args,
  ): Promise<{ rows: ClaimCaseRow[]; counts: Record<CaseGroup, number> }> => {
    const today = brazilToday(Date.now());
    const notices = (
      await Promise.all(
        DELINQUENCY_STATUSES.map((status) =>
          ctx.db
            .query("guaranteeDelinquencyNotices")
            .withIndex("by_agency_status", (q) =>
              q.eq("agencyId", ctx.agencyId).eq("status", status),
            )
            .order("desc")
            .take(CASES_PER_STATUS_LIMIT),
        ),
      )
    ).flat();

    const counts: Record<CaseGroup, number> = { needs_you: 0, with_mutav: 0, closed: 0 };
    const rows: ClaimCaseRow[] = [];
    for (const notice of notices) {
      const claimableFrom = await claimableFromFor(ctx, notice);
      const caseStatus = toAgencyCaseStatus({
        notice,
        coverOperation: await loadCoverOperation(ctx, notice),
        claimableFrom,
        today,
      });
      const group = caseGroupOf(caseStatus);
      counts[group] += 1;
      if (group !== args.group) continue;

      const guarantee = await ctx.db.get(notice.guaranteeId);
      if (!guarantee) {
        throw new Error(
          `Delinquency notice ${notice.publicId} references a missing guarantees row`,
        );
      }
      const lease = await ctx.db.get(guarantee.leaseId);
      if (!lease) {
        throw new Error(`Guarantee ${guarantee.publicId} references a missing leases row`);
      }
      const tenant = await agencySubmittedTenant(ctx, guarantee);
      const openDeadlines = (notice.claim?.requests ?? [])
        .filter((request) => request.resolvedAt === undefined)
        .map((request) => request.dueAt)
        .sort();
      rows.push({
        publicId: notice.publicId,
        guaranteePublicId: guarantee.publicId,
        tenantName: tenant?.fullName ?? "",
        streetAndNumber: lease.property.streetAndNumber,
        complement: lease.property.complement,
        rentDueDate: notice.rentDueDate,
        originalAmountCents: notice.originalAmountCents,
        caseStatus,
        claimableFrom,
        requestDueAt: openDeadlines[0] ?? null,
        updatedAt: lastActivityAt(notice),
      });
    }

    rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { rows, counts };
  },
});
