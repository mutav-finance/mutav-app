import { v } from "convex/values";
import { logError } from "../lib/logger";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import { assertAgencyAccess, queryWithAgencyScope, queryWithMutavRole } from "../lib/auth";
import type { UserId } from "../users/domain";
import type { AgencyId } from "../agencies/domain";
import type { GuaranteeCapacity, GuaranteeId, GuaranteeState } from "../guarantees/domain";
import {
  DELINQUENCY_STATUS,
  delinquencyStatusValidator,
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

// Temporary: the agency app's status tag knows `open | resolved | canceled`
// only. A staff-verified notice is still outstanding from the agency's side,
// so agency reads surface it as `open` (and count it with the open ones)
// until the agency UI grows a `verified` state. Deleted with the contracts
// facade.
export type AgencyNoticeStatus = Exclude<DelinquencyStatus, typeof DELINQUENCY_STATUS.VERIFIED>;

function toAgencyNoticeStatus(status: DelinquencyStatus): AgencyNoticeStatus {
  return status === DELINQUENCY_STATUS.VERIFIED ? DELINQUENCY_STATUS.OPEN : status;
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
  status: AgencyNoticeStatus;
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
  resolution: {
    kind: NoticeResolutionKind;
    resolvedAt: string;
    resolvedByUserId: UserId;
    coverOperationPublicId: string | null;
    note: string | null;
  } | null;
  cancellation: {
    reason: NoticeCancellationReason;
    canceledAt: string;
    canceledByUserId: UserId;
    note: string | null;
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
 * decoration — `staffMarkResolvedByCover` CLAMPS its draw to
 * `capacity.availableCents`, so an operator who cannot see the remaining
 * ceiling before submitting cannot tell whether the landlord is made whole.
 */
export type DelinquencyAdminQueueRow = {
  publicId: string;
  /**
   * `open` or `verified` — the two outstanding statuses. The queue carries it
   * because the staff dispositions are status-gated: `staffVerifyDefault`
   * takes an `open` notice, `staffMarkResolvedByCover` refuses anything but a
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
};

function shapeDelinquencyNoticeRow(notice: DelinquencyNotice): DelinquencyNoticeRow {
  return {
    publicId: notice.publicId,
    guaranteeId: notice.guaranteeId,
    status: toAgencyNoticeStatus(notice.status),
    rentDueDate: notice.rentDueDate,
    originalAmountCents: notice.originalAmountCents,
    updatedAmountCents: notice.updatedAmountCents,
    evidenceSource: notice.evidenceSource,
    openedAt: notice.openedAt,
    resolvedAt: notice.resolution?.resolvedAt ?? null,
    canceledAt: notice.cancellation?.canceledAt ?? null,
  };
}

function shapeDelinquencyNoticeDetail(notice: DelinquencyNotice): DelinquencyNoticeDetail {
  return {
    ...shapeDelinquencyNoticeRow(notice),
    openedByUserId: notice.openedByUserId,
    agencyId: notice.agencyId,
    resolution: notice.resolution
      ? {
          kind: notice.resolution.kind,
          resolvedAt: notice.resolution.resolvedAt,
          resolvedByUserId: notice.resolution.resolvedByUserId,
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
export const listByAgency = queryWithAgencyScope({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(delinquencyStatusValidator),
    dueDateFrom: v.optional(v.string()),
    dueDateTo: v.optional(v.string()),
    amountFromCents: v.optional(v.number()),
    amountToCents: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: DelinquencyNoticeRow[]; isDone: boolean; continueCursor: string }> => {
    const status = args.status ?? DELINQUENCY_STATUS.OPEN;
    // Normalize both sides of the compare to YYYY-MM-DD so a caller passing
    // an ISO datetime (e.g. "2026-06-05T00:00:00Z") is compared against the
    // stored day, not lex-compared with a longer string that diverges at
    // position 10. `rentDueDate` is enforced to YYYY-MM-DD at write time by
    // openNotice's validator; the .slice keeps this query defensive.
    const dueDateFrom = args.dueDateFrom?.slice(0, 10);
    const dueDateTo = args.dueDateTo?.slice(0, 10);
    const result = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId).eq("status", status))
      .order("desc")
      .paginate(args.paginationOpts);
    // Verified notices ride along with the open page (see `AgencyNoticeStatus`);
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

    const page = [...verifiedRows, ...result.page]
      .sort((a, b) => b._creationTime - a._creationTime)
      .filter(
        (notice) =>
          (dueDateFrom == null || notice.rentDueDate.slice(0, 10) >= dueDateFrom) &&
          (dueDateTo == null || notice.rentDueDate.slice(0, 10) <= dueDateTo) &&
          (args.amountFromCents == null || notice.updatedAmountCents >= args.amountFromCents) &&
          (args.amountToCents == null || notice.updatedAmountCents <= args.amountToCents),
      )
      .map(shapeDelinquencyNoticeRow);

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

    return shapeDelinquencyNoticeDetail(notice);
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
 * it. `staffMarkResolvedByCover` refuses anything but a `verified` notice, so
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
