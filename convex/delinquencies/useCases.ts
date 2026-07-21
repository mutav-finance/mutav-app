import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { assertAgencyAccess, queryWithAgencyScope, queryWithMutavRole } from "../lib/auth";
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
const STATS_TAKE_LIMIT = 1000;

// ---- projection shapes -----------------------------------------------------
// Server-owned response types. Callers (UI, tests, internal wrappers) couple
// to THESE, not to `Doc<'contractDelinquencyNotices'>` — so future schema
// tweaks (new envelope fields, renamed system columns) do not ripple out.

/**
 * List-row shape. Drops Convex system fields (`_id`, `_creationTime`) and
 * the write-side envelopes (`resolution`, `cancellation`) — surfaces just the
 * timestamp needed for a "resolved 3d ago"-style column.
 */
export type DelinquencyNoticeRow = {
  publicId: string;
  contractId: Id<"contracts">;
  status: DelinquencyStatus;
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
  openedByUserId: Id<"users">;
  agencyId: Id<"agencies">;
  resolution: {
    kind: NoticeResolutionKind;
    resolvedAt: string;
    resolvedByUserId: Id<"users">;
    coverOperationPublicId: string | null;
    note: string | null;
  } | null;
  cancellation: {
    reason: NoticeCancellationReason;
    canceledAt: string;
    canceledByUserId: Id<"users">;
    note: string | null;
  } | null;
};

/**
 * Staff-queue row. Includes `agencyId` so the queue UI can group across
 * agencies; drops `status` (always `open` by index) and `openedByUserId`
 * (queue does not surface the agency-side author).
 */
export type DelinquencyAdminQueueRow = {
  publicId: string;
  agencyId: Id<"agencies">;
  contractId: Id<"contracts">;
  rentDueDate: string;
  originalAmountCents: number;
  updatedAmountCents: number;
  evidenceSource: NoticeEvidenceSource;
  openedAt: string;
};

function shapeDelinquencyNoticeRow(notice: DelinquencyNotice): DelinquencyNoticeRow {
  return {
    publicId: notice.publicId,
    contractId: notice.contractId,
    status: notice.status,
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

function shapeDelinquencyAdminQueueRow(notice: DelinquencyNotice): DelinquencyAdminQueueRow {
  return {
    publicId: notice.publicId,
    agencyId: notice.agencyId,
    contractId: notice.contractId,
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
 * composite index tuple narrow. TODO: promote to `by_agency_status_dueDate`
 * once filter usage or row counts justify it.
 *
 * ⚠️ Post-index filters run AFTER `.paginate()`, so the returned `page.length`
 * can be smaller than `paginationOpts.numItems` while `isDone === false`.
 * Callers must keep paging until `isDone` — do not treat a short page as EOF.
 * TODO: when the UI actually wires filters, switch to an index-native variant
 * (e.g. a `by_agency_status_dueDate` composite) so page size stays honest.
 *
 * UI adapter placement: the agency's `DelinquencyPage` renders a
 * `DelinquencyRow` shape with `propertyId` + formatted `noticeAt`. That
 * adapter (property join + `Intl` date formatting per active locale) lives
 * client-side in `apps/agency/src/components/delinquencies/` — the property
 * join needs a `contracts.get` per row and the date format is locale-aware,
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
    const result = await ctx.db
      .query("contractDelinquencyNotices")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId).eq("status", status))
      .order("desc")
      .paginate(args.paginationOpts);

    const page = result.page
      .filter(
        (notice) =>
          (args.dueDateFrom == null || notice.rentDueDate >= args.dueDateFrom) &&
          (args.dueDateTo == null || notice.rentDueDate <= args.dueDateTo) &&
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
 * `invoices.getByPublicId` and `contracts.getByPublicId`.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<DelinquencyNoticeDetail | null> => {
    const notice = await ctx.db
      .query("contractDelinquencyNotices")
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
    approxResolved: boolean;
    approxCanceled: boolean;
  }> => {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const [openRows, resolvedRows, canceledRows] = await Promise.all([
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) =>
          q.eq("agencyId", ctx.agencyId).eq("status", DELINQUENCY_STATUS.OPEN),
        )
        .take(STATS_TAKE_LIMIT),
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) =>
          q.eq("agencyId", ctx.agencyId).eq("status", DELINQUENCY_STATUS.RESOLVED),
        )
        .take(STATS_TAKE_LIMIT),
      ctx.db
        .query("contractDelinquencyNotices")
        .withIndex("by_agency_status", (q) =>
          q.eq("agencyId", ctx.agencyId).eq("status", DELINQUENCY_STATUS.CANCELED),
        )
        .take(STATS_TAKE_LIMIT),
    ]);

    return {
      openCount: openRows.length,
      resolvedCountLast30d: resolvedRows.filter(
        (notice) => (notice.resolution?.resolvedAt ?? "") >= since,
      ).length,
      canceledCountLast30d: canceledRows.filter(
        (notice) => (notice.cancellation?.canceledAt ?? "") >= since,
      ).length,
      approxResolved: resolvedRows.length === STATS_TAKE_LIMIT,
      approxCanceled: canceledRows.length === STATS_TAKE_LIMIT,
    };
  },
});

/**
 * Cross-agency staff queue of open notices, FIFO by `openedAt`.
 * `compliance` is the correct rung — support is KYC-only per the mutavStaff
 * ladder; admin over-privileges a read. Index-native ordering, no
 * post-filtering.
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
      .query("contractDelinquencyNotices")
      .withIndex("by_status_openedAt", (q) => q.eq("status", DELINQUENCY_STATUS.OPEN))
      .order("asc")
      .paginate(args.paginationOpts);

    return {
      page: result.page.map(shapeDelinquencyAdminQueueRow),
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
  handler: async (ctx, { publicId }): Promise<Doc<"contractDelinquencyNotices"> | null> => {
    return ctx.db
      .query("contractDelinquencyNotices")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique();
  },
});
