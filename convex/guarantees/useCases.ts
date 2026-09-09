import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashPii } from "../lib/pii";
import { priceGuarantee, splitCommission } from "./pricing";
import type {
  ActivityBucket,
  ContractApplication,
  ContractApplicationId,
  Guarantee,
  GuaranteeHistory,
  GuaranteeId,
  GuaranteeEvent,
  GuaranteeState,
  StateTimelineBucket,
} from "./domain";
import type { AgencyId } from "../agencies/domain";
import type { Tenant, TenantInput } from "../tenants/domain";
import type { Lease } from "../leases/domain";
import { PRODUCT_ERROR_CODE } from "../products/domain";
import { contractsByStatus, countByStatePlatform, sumInsuredExposure } from "./aggregate";
import { insertGuaranteeAggregates } from "./aggregateWrites";
import { applyGuaranteeTransition } from "./transitions";
import {
  CLOSE_REASON,
  CONTRACT_APPLICATION_VALIDITY_MS,
  DOCUMENT_KEY,
  DOCUMENT_STATUS,
  GUARANTEE_ERROR_CODE,
  GUARANTEE_EVENT,
  GUARANTEE_STATE,
  GUARANTEE_STATES,
  guaranteePlanValidator,
  guaranteeStateValidator,
  SCORE_TIER,
  TENANT_APPROVAL_STATUS,
  tierForScore,
  getUrgencyTier,
  urgencySortKey,
  expiringRenewalBounds,
} from "./domain";
import {
  buildLeaseRent,
  DEFAULT_PAYER,
  isValidRentInput,
  leasePropertyValidator,
  leaseRentInputValidator,
  propertyKindValidator,
  ufFromCityUF,
} from "../leases/domain";
import { resolveProduct } from "../products/useCases";
import {
  normalizeEmbeddedTenant,
  tenantEntityTypeValidator,
  TENANT_ERROR_CODE,
} from "../tenants/domain";
import { agencySubmittedTenant } from "./tenantIdentity";
import { getOrCreateTenant } from "../tenants/useCases";
import type { Result } from "../lib/result";
import { findFreshAssessment } from "../creditAnalysis/useCases";
import { CAPABILITY, SUBJECT_TYPE } from "../creditAnalysis/domain";
import { getMaxGuaranteeCapacityCents } from "../lib/env";
import { generateGuaranteePublicId, generateLeasePublicId } from "../lib/randomId";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import {
  assertAgencyAccess,
  mutationWithAgencyScope,
  queryWithAgencyScope,
  queryWithAuth,
} from "../lib/auth";

/**
 * Resource-by-id read. The publicId is the only thing in the URL on the
 * detail route, so the wrapper can't pre-scope by agencyId from args — we
 * verify membership against the resource's `agencyId` inline. Returns null
 * on both "no such id" and "not a member of that agency", to avoid leaking
 * cross-agency existence.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    // `.collect()` instead of `.unique()` because `publicId` carries no
    // DB-level uniqueness constraint — seed re-runs across multiple
    // agencies can produce collisions. We disambiguate by membership:
    // return the first guarantee whose `agencyId` the caller has access
    // to. Returns null on "no such id" AND "not a member of any owning
    // agency" — same shape as before, no cross-agency existence leak.
    const candidates = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .collect();

    for (const guarantee of candidates) {
      try {
        await assertAgencyAccess(ctx, guarantee.agencyId);
      } catch {
        continue;
      }

      // FK-integrity invariants, not leak cases: `leaseId` is required and
      // lease rows are never deleted, so a miss means corrupted data.
      const lease = await ctx.db.get(guarantee.leaseId);
      if (!lease) {
        throw new Error(`Guarantee ${guarantee.publicId} references a missing leases row`);
      }

      // Scoped by agency, not by publicId alone: publicId carries no DB-level
      // uniqueness constraint, so `by_guarantee` would fold another agency's
      // history rows — username and message included — into this response.
      const history = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_agency_guarantee", (q) =>
          q.eq("agencyId", guarantee.agencyId).eq("guaranteePublicId", args.publicId),
        )
        .order("desc")
        // Hard cap; if guarantees exceed 100 history entries we'll need pagination.
        .take(100);

      // No fallback to the registry row. It keeps its first writer's values,
      // so serving it here shows this agency whatever the *other* agency
      // submitted for the same person — the disclosure this domain exists to
      // prevent. Every guarantee carries its own submission (`create` in
      // production, the seed's snapshot pass otherwise), so an absent one is
      // corrupted data, not a case to paper over.
      const submitted = await agencySubmittedTenant(ctx, guarantee);
      if (!submitted) {
        throw new Error(`Guarantee ${guarantee.publicId} has no tenant submission of its own`);
      }

      return shapeGuarantee({ guarantee, lease, identity: submitted, history });
    }

    return null;
  },
});

/**
 * Tenant identity for a guarantee as the *owning* agency submitted it, for
 * actions that have no `ctx.db` (anchor SEP-9 prefill). This is the one read
 * path that hands tenant PII to a third party, so it is scoped and fail-closed
 * on both axes.
 *
 * `agencyId` is required, not derived: `publicId` carries no DB-level
 * uniqueness constraint, so resolving by it alone either throws on `.unique()`
 * or picks whichever agency's guarantee sorts first and ships that tenant's
 * data under the caller's session.
 *
 * The shared registry row is never a fallback here. It keeps its first writer's
 * values and is never patched, so serving it would disclose another agency's
 * contact data to the anchor and pin it there permanently (LGPD-26). A
 * guarantee with no submission of its own yields `null`; prefill is a
 * convenience and the deposit still works without it.
 */
export const getTenantIdentityInternal = internalQuery({
  args: { agencyId: v.id("agencies"), publicId: v.string() },
  handler: async (ctx, { agencyId, publicId }): Promise<TenantInput | null> => {
    const candidates = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .collect();

    const guarantee = candidates.find((candidate) => candidate.agencyId === agencyId);
    if (!guarantee) return null;

    return agencySubmittedTenant(ctx, guarantee);
  },
});

/**
 * Resolve each guarantee's tenant display name from the identity the listing
 * agency itself submitted. The shared `tenants` registry is deliberately not
 * consulted: it holds its first writer's values, so reading it here would put
 * another agency's version of the same person in this agency's list.
 */
async function tenantNamesByGuarantee(
  ctx: QueryCtx,
  docs: readonly Guarantee[],
): Promise<Map<GuaranteeId, string>> {
  const names = new Map<GuaranteeId, string>();
  await Promise.all(
    docs.map(async (doc) => {
      const submitted = await agencySubmittedTenant(ctx, doc);
      // Blank rather than the registry name: a list row showing the name the
      // *other* agency submitted is the same disclosure as the detail view,
      // just quieter.
      names.set(doc._id, submitted?.fullName ?? "");
    }),
  );
  return names;
}

const REFERENCE_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function currentReferenceDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveReferenceDate(input: string | undefined): string {
  return input && REFERENCE_DATE_PATTERN.test(input) ? input : currentReferenceDate();
}

const GUARANTEE_TAB = {
  ALL: "all",
  EXPIRING: "expiring",
} as const;
const guaranteeTabValidator = v.union(
  v.literal(GUARANTEE_TAB.ALL),
  v.literal(GUARANTEE_TAB.EXPIRING),
  guaranteeStateValidator,
);

/**
 * Paginated list scoped to one agency, filtered by tab: `all`, `expiring`, or
 * one of the seven guarantee states. `expiring` scans the indexed `active`
 * renewal window only — a guarantee in arrears or under cover is chased
 * through the delinquency queue, not the renewal list.
 */
export const listByAgency = queryWithAgencyScope({
  args: {
    paginationOpts: paginationOptsValidator,
    tab: v.optional(guaranteeTabValidator),
    referenceDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const referenceDate = resolveReferenceDate(args.referenceDate);
    const tab = args.tab ?? GUARANTEE_TAB.ALL;

    const result = await (tab === GUARANTEE_TAB.EXPIRING
      ? (() => {
          const bounds = expiringRenewalBounds(referenceDate);
          return ctx.db
            .query("guarantees")
            .withIndex("by_agency_status_nextRenewalDate", (q) =>
              q
                .eq("agencyId", ctx.agencyId)
                .eq("status", GUARANTEE_STATE.ACTIVE)
                .gte("nextRenewalDate", bounds.gte)
                .lte("nextRenewalDate", bounds.lte),
            )
            .order("asc")
            .paginate(args.paginationOpts);
        })()
      : tab === GUARANTEE_TAB.ALL
        ? ctx.db
            .query("guarantees")
            .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId))
            .order("desc")
            .paginate(args.paginationOpts)
        : ctx.db
            .query("guarantees")
            .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId).eq("status", tab))
            .order("desc")
            .paginate(args.paginationOpts));

    const tenantNames = await tenantNamesByGuarantee(ctx, result.page);

    return {
      ...result,
      page: result.page.map((doc) =>
        shapeGuaranteeSummary(doc, tenantNames.get(doc._id) ?? "", referenceDate),
      ),
    };
  },
});

/**
 * Lightweight summary of a guarantee for list views — drops the `terms`,
 * `documents` and lease join and carries only the tenant's display name.
 * Use `shapeGuarantee` for the detail view.
 *
 * `availableCapacityCents` is a projection, not the row: the row keeps
 * `available + reserved = ceiling` for the whole life, but a closed guarantee
 * covers nothing, so the list advertises 0 for it.
 */
function shapeGuaranteeSummary(doc: Guarantee, tenantName: string, referenceDate: string) {
  const urgency = getUrgencyTier({
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    referenceDate,
  });
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    closure: doc.closure ?? null,
    nextRenewalDate: doc.nextRenewalDate,
    availableCapacityCents: doc.status === GUARANTEE_STATE.CLOSED ? 0 : doc.capacity.availableCents,
    tenantName,
    creationTime: doc._creationTime,
    urgency,
    urgencySortKey: urgencySortKey(urgency),
  };
}

type StateCounts = Record<GuaranteeState, number>;

function singleKeyBounds(state: GuaranteeState) {
  return {
    lower: { key: state, inclusive: true },
    upper: { key: state, inclusive: true },
  };
}

/**
 * Zip a `countBatch` result back onto the seven states. The batch is issued
 * in `GUARANTEE_STATES` order, so position i is the count for state i.
 */
function shapeStateCounts(counts: readonly number[]): StateCounts {
  return {
    drafted: counts[0] ?? 0,
    active: counts[1] ?? 0,
    in_arrears: counts[2] ?? 0,
    default_verified: counts[3] ?? 0,
    cover_committed: counts[4] ?? 0,
    in_eviction: counts[5] ?? 0,
    closed: counts[6] ?? 0,
  };
}

async function stateCountsForAgency(ctx: QueryCtx, agencyId: AgencyId): Promise<StateCounts> {
  const counts = await contractsByStatus.countBatch(
    ctx,
    GUARANTEE_STATES.map((state) => ({ namespace: agencyId, bounds: singleKeyBounds(state) })),
  );
  return shapeStateCounts(counts);
}

/**
 * Per-agency state counts, one key per guarantee state. O(log n) via the
 * namespaced `contractsByStatus` aggregate. Used by the dashboard KPI tiles.
 */
export const getStatusCounts = queryWithAgencyScope({
  args: {},
  handler: async (ctx): Promise<StateCounts> => stateCountsForAgency(ctx, ctx.agencyId),
});

/**
 * Per-tab badge counts for the guarantees list. State buckets reuse the
 * O(log n) `contractsByStatus` aggregate; the `expiring` badge counts the
 * indexed `active` renewal range (same window `listByAgency` paginates).
 */
export const getGuaranteeTabCounts = queryWithAgencyScope({
  args: { referenceDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const referenceDate = resolveReferenceDate(args.referenceDate);
    const counts = await stateCountsForAgency(ctx, ctx.agencyId);

    const bounds = expiringRenewalBounds(referenceDate);
    // Bounded range scan over active renewals; revisit with a date-aware
    // aggregate if it outgrows this.
    const expiringRows = await ctx.db
      .query("guarantees")
      .withIndex("by_agency_status_nextRenewalDate", (q) =>
        q
          .eq("agencyId", ctx.agencyId)
          .eq("status", GUARANTEE_STATE.ACTIVE)
          .gte("nextRenewalDate", bounds.gte)
          .lte("nextRenewalDate", bounds.lte),
      )
      .collect();

    return {
      all: GUARANTEE_STATES.reduce((sum, state) => sum + counts[state], 0),
      expiring: expiringRows.length,
      ...counts,
    };
  },
});

/**
 * Platform-wide state counts, one key per guarantee state. O(log n) via the
 * un-namespaced `contractsByStatusPlatform` aggregate. Used by the
 * health/transparency page.
 */
export const getStatusCountsGlobal = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<StateCounts> => countByStatePlatform(ctx),
});

/**
 * Platform-wide insured capacity. Sum of worst-case exposure (remaining
 * rent-coverage capacity + exit-cost sublimit) across every in-force
 * guarantee, plus the configured global capacity cap. O(log n) per insured
 * state via the `ativoInsuredCentsPlatform` aggregate.
 */
export const getInsuredCapacityGlobal = queryWithAuth({
  args: {},
  handler: async (ctx) => {
    const sumInsuredCents = await sumInsuredExposure(ctx);

    return {
      sumInsuredCents,
      maxCapacityCents: getMaxGuaranteeCapacityCents(),
    };
  },
});

const ACTIVITY_MONTH_PERIODS = 12;
const ACTIVITY_WEEK_PERIODS = 52;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthPeriodKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function dayPeriodKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Returns the UTC Monday at 00:00:00 for the week containing `at`. ISO-8601
 * weeks start on Monday.
 */
function utcMondayStart(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

type PeriodBoundary = { startISO: string; endISO: string; key: string };

function buildMonthBoundaries(now: Date, count: number): PeriodBoundary[] {
  const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const boundaries: PeriodBoundary[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(
      Date.UTC(startOfThisMonth.getUTCFullYear(), startOfThisMonth.getUTCMonth() - i, 1),
    );
    const end = new Date(
      Date.UTC(startOfThisMonth.getUTCFullYear(), startOfThisMonth.getUTCMonth() - i + 1, 1),
    );
    boundaries.push({
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      key: monthPeriodKey(start),
    });
  }
  return boundaries;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function buildWeekBoundaries(now: Date, count: number): PeriodBoundary[] {
  const currentMondayMs = utcMondayStart(now).getTime();
  const boundaries: PeriodBoundary[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const startMs = currentMondayMs - i * WEEK_MS;
    const endMs = startMs + WEEK_MS;
    const start = new Date(startMs);
    boundaries.push({
      startISO: start.toISOString(),
      endISO: new Date(endMs).toISOString(),
      key: dayPeriodKey(start),
    });
  }
  return boundaries;
}

type GuaranteeTimePoint = Pick<Guarantee, "activatedAt" | "closure">;

/**
 * A guarantee leaves the in-force book at `closure.closedAt`. A draft
 * canceled before activation counts as `cancelled`; every other close
 * reason (end of lease, rescission, eviction, …) counts as `expired`.
 */
function bucketsForGuarantees(
  guarantees: readonly GuaranteeTimePoint[],
  boundaries: readonly PeriodBoundary[],
): ActivityBucket[] {
  return boundaries.map(({ startISO, endISO, key }) => {
    let activated = 0;
    let cancelled = 0;
    let expired = 0;
    let netActive = 0;

    for (const g of guarantees) {
      const activatedAt = g.activatedAt;
      const closedAt = g.closure?.closedAt ?? null;

      if (activatedAt && activatedAt >= startISO && activatedAt < endISO) {
        activated++;
      }
      if (closedAt && closedAt >= startISO && closedAt < endISO) {
        if (g.closure?.reason === CLOSE_REASON.CANCELED_PRE_ACTIVATION) cancelled++;
        else expired++;
      }

      if (!activatedAt) continue;
      if (activatedAt >= endISO) continue;
      if (closedAt && closedAt < endISO) continue;
      netActive++;
    }

    return { period: key, activated, cancelled, expired, netActive };
  });
}

const activityScopeValidator = v.union(
  v.object({ kind: v.literal("agency"), agencyId: v.id("agencies") }),
  v.object({ kind: v.literal("platform") }),
);

const activityGranularityValidator = v.union(v.literal("month"), v.literal("week"));

/**
 * Guarantee-activity time series, scoped to either one agency or the platform.
 *
 * Auth: `queryWithAuth` + inline `assertAgencyAccess` for the agency arm —
 * since wrapper choice is static per handler, the scope discriminator is the
 * only way to serve both consumers from a single public function.
 *
 * Per-agency scope uses the `by_agency_status` index to bound the scan;
 * platform scope does a full `.collect()` by design. Time-series aggregates
 * are deliberately deferred until the guarantees table crosses ~5–10k rows.
 *
 * NO CLIENT. `getStateTimelineByPeriod` replaced it in both cards (the
 * dashboard and `/transparency`), and the event-bar panel beneath the
 * composition reads that query's `eventCount` rather than these coarser
 * series — one replay, one round trip. Delete this with its tests in the
 * cleanup PR.
 */
export const getActivityByPeriod = queryWithAuth({
  args: {
    scope: activityScopeValidator,
    granularity: activityGranularityValidator,
  },
  handler: async (ctx, { scope, granularity }): Promise<ActivityBucket[]> => {
    let guarantees: readonly GuaranteeTimePoint[];
    if (scope.kind === "agency") {
      await assertAgencyAccess(ctx, scope.agencyId);
      guarantees = await ctx.db
        .query("guarantees")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", scope.agencyId))
        .collect();
    } else {
      guarantees = await ctx.db.query("guarantees").collect();
    }

    const now = new Date();
    const boundaries =
      granularity === "month"
        ? buildMonthBoundaries(now, ACTIVITY_MONTH_PERIODS)
        : buildWeekBoundaries(now, ACTIVITY_WEEK_PERIODS);

    return bucketsForGuarantees(guarantees, boundaries);
  },
});

/**
 * A guarantee's position on the machine, replayed from its history rows.
 * `agencyId` is part of the key because `publicId` is unique per agency, not
 * across the platform — keying on the id alone would merge two agencies'
 * guarantees in the platform arm.
 */
function guaranteeTimelineKey(agencyId: AgencyId, guaranteePublicId: string): string {
  return `${agencyId}:${guaranteePublicId}`;
}

function emptyStateCounts(): Record<GuaranteeState, number> {
  return {
    drafted: 0,
    active: 0,
    in_arrears: 0,
    default_verified: 0,
    cover_committed: 0,
    in_eviction: 0,
    closed: 0,
  };
}

function emptyEventCounts(): Record<GuaranteeEvent, number> {
  return {
    created: 0,
    activated: 0,
    default_verified: 0,
    cover_paid: 0,
    closed: 0,
  };
}

/**
 * The event a transition counts as, or `null` when it is a move the event
 * panel does not track (a cure, an eviction filing). `activated` is only the
 * first sale — a return to `active` after arrears or a payout is a cure, not
 * new business, so the `from` state is part of the test.
 */
function eventForTransition(from: GuaranteeState, to: GuaranteeState): GuaranteeEvent | null {
  if (to === GUARANTEE_STATE.ACTIVE) {
    return from === GUARANTEE_STATE.DRAFTED ? GUARANTEE_EVENT.ACTIVATED : null;
  }
  if (to === GUARANTEE_STATE.DEFAULT_VERIFIED) return GUARANTEE_EVENT.DEFAULT_VERIFIED;
  if (to === GUARANTEE_STATE.COVER_COMMITTED) return GUARANTEE_EVENT.COVER_PAID;
  if (to === GUARANTEE_STATE.CLOSED) return GUARANTEE_EVENT.CLOSED;
  return null;
}

/** Index of the boundary whose half-open window contains `atISO`, else -1. */
function boundaryIndexFor(atISO: string, boundaries: readonly PeriodBoundary[]): number {
  return boundaries.findIndex(({ startISO, endISO }) => atISO >= startISO && atISO < endISO);
}

type ReplayedTransition = { at: string; from: GuaranteeState; to: GuaranteeState };

type TimelineGuarantee = Pick<Guarantee, "agencyId" | "publicId" | "status">;
type TimelineHistory = Pick<
  GuaranteeHistory,
  "agencyId" | "guaranteePublicId" | "at" | "transition"
>;

/**
 * Composition of the book at the end of each boundary, plus the lifecycle
 * events inside it, by replaying the structured `guaranteeHistory.transition`
 * rows.
 *
 * Semantics, so the series is readable without the code:
 * - a guarantee is counted only from the instant it exists — the earliest `at`
 *   on ANY of its history rows, transition or not, since creation writes a
 *   free-text row. Without that bound a guarantee sold six months ago would be
 *   counted as `drafted` in the six buckets before it, and the total would be
 *   flat at today's book size for the whole window;
 * - state at boundary B = the `to` of the last transition with `at < B.end`;
 * - before its first transition a guarantee is counted in that transition's
 *   `from` state — that IS the state it was in;
 * - a guarantee with no history rows at all is counted in its current status in
 *   every bucket. Nothing dates it, and `_creationTime` cannot stand in: it is
 *   the seed run time for every demo row and would empty the whole series;
 * - an event lands in the bucket whose half-open window contains its
 *   timestamp, so anything older than the window contributes no bar. A
 *   guarantee with no history rows produces no events at all.
 *
 * History rows whose guarantee is out of scope are ignored, and a row with no
 * `transition` (creation, reprice) is not a machine move — but it still counts
 * as evidence that the guarantee existed.
 */
function replayStateTimeline(
  guarantees: readonly TimelineGuarantee[],
  history: readonly TimelineHistory[],
  boundaries: readonly PeriodBoundary[],
): StateTimelineBucket[] {
  const transitionsByGuarantee = new Map<string, ReplayedTransition[]>();
  const existsFromByGuarantee = new Map<string, string>();
  for (const row of history) {
    const key = guaranteeTimelineKey(row.agencyId, row.guaranteePublicId);
    const earliest = existsFromByGuarantee.get(key);
    if (earliest === undefined || row.at < earliest) existsFromByGuarantee.set(key, row.at);
    const transition = row.transition;
    if (!transition) continue;
    const replayed = { at: row.at, from: transition.from, to: transition.to };
    const existing = transitionsByGuarantee.get(key);
    if (existing) existing.push(replayed);
    else transitionsByGuarantee.set(key, [replayed]);
  }
  for (const rows of transitionsByGuarantee.values()) {
    rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  const buckets = boundaries.map(({ key }) => ({
    period: key,
    countByState: emptyStateCounts(),
    eventCount: emptyEventCounts(),
  }));

  for (const guarantee of guarantees) {
    const key = guaranteeTimelineKey(guarantee.agencyId, guarantee.publicId);
    const transitions = transitionsByGuarantee.get(key) ?? [];
    const existsFromISO = existsFromByGuarantee.get(key);

    if (existsFromISO !== undefined) {
      const createdIn = buckets[boundaryIndexFor(existsFromISO, boundaries)];
      if (createdIn) createdIn.eventCount.created++;
    }
    for (const transition of transitions) {
      const event = eventForTransition(transition.from, transition.to);
      if (!event) continue;
      const happenedIn = buckets[boundaryIndexFor(transition.at, boundaries)];
      if (happenedIn) happenedIn.eventCount[event]++;
    }

    const first = transitions[0];
    let state: GuaranteeState = first ? first.from : guarantee.status;
    let next = 0;
    boundaries.forEach(({ endISO }, index) => {
      let pending = transitions[next];
      while (pending && pending.at < endISO) {
        state = pending.to;
        next++;
        pending = transitions[next];
      }
      // A bucket that closed before the guarantee's first recorded moment is a
      // period it did not exist in — counting it there would invent book.
      if (existsFromISO !== undefined && endISO <= existsFromISO) return;
      const bucket = buckets[index];
      if (bucket) bucket.countByState[state]++;
    });
  }

  return buckets;
}

/**
 * Guarantee **state timeline** — one count per lifecycle state per period,
 * for the same scopes, granularities and auth shape as `getActivityByPeriod`.
 *
 * `getActivityByPeriod` derives its four coarse series from `activatedAt` and
 * `closure.closedAt`, the only two timestamps the guarantee row carries, so it
 * can never show `in_arrears`, `default_verified`, `cover_committed` or
 * `in_eviction`. This one replays `guaranteeHistory.transition` instead and
 * therefore sees every state the machine can reach.
 *
 * Per-agency scope bounds both scans on an index (`by_agency_status`,
 * `by_agency_guarantee`); platform scope collects both tables by design, the
 * same trade `getActivityByPeriod` already makes.
 *
 * The binding table here is `guaranteeHistory`, not `guarantees`: it takes a
 * row per creation, per guarded transition and per reprice, is never pruned,
 * and is read in full even though only the last 12 months matter. So the
 * platform arm reaches Convex's per-query document-read ceiling at roughly
 * `guarantees × average path length`, well before the ~5–10k guarantee rows
 * the activity series is deferred against. The fix when it binds is a
 * `by_at` / `by_agency_at` index ranged from the window's first boundary, with
 * the opening state replayed backwards from `guarantees.status`.
 */
export const getStateTimelineByPeriod = queryWithAuth({
  args: {
    scope: activityScopeValidator,
    granularity: activityGranularityValidator,
  },
  handler: async (ctx, { scope, granularity }): Promise<StateTimelineBucket[]> => {
    let guarantees: readonly TimelineGuarantee[];
    let history: readonly TimelineHistory[];
    if (scope.kind === "agency") {
      await assertAgencyAccess(ctx, scope.agencyId);
      guarantees = await ctx.db
        .query("guarantees")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", scope.agencyId))
        .collect();
      history = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_agency_guarantee", (q) => q.eq("agencyId", scope.agencyId))
        .collect();
    } else {
      guarantees = await ctx.db.query("guarantees").collect();
      history = await ctx.db.query("guaranteeHistory").collect();
    }

    const now = new Date();
    const boundaries =
      granularity === "month"
        ? buildMonthBoundaries(now, ACTIVITY_MONTH_PERIODS)
        : buildWeekBoundaries(now, ACTIVITY_WEEK_PERIODS);

    return replayStateTimeline(guarantees, history, boundaries);
  },
});

/**
 * Guarantees in force during the given `YYYY-MM` period, shaped for the
 * Commission page. "In force during" means `activatedAt` is on or before
 * the period and the guarantee wasn't closed *before* it — one closed during
 * the period still earned commission for that period, so it stays in the
 * result. Commission is the same `splitCommission` the wizard previews (taxa
 * at `commissionRate` + prestamista premium at `prestamistaCommissionRate`),
 * read entirely from the guarantee's stored `terms` snapshot — never from the
 * live product row, so a catalog edit cannot reprice commission already owed.
 */
const COMMISSION_INSTALLMENTS_TOTAL = 12;
const PERIOD_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthDiff(fromYYYYMM: string, toYYYYMM: string): number {
  const [fy, fm] = fromYYYYMM.split("-").map(Number);
  const [ty, tm] = toYYYYMM.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function currentPeriodMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

type ActivatedGuarantee = Guarantee & { activatedAt: string };

function isInForceDuring(g: Guarantee, period: string): g is ActivatedGuarantee {
  if (!g.activatedAt) return false;
  if (g.activatedAt.slice(0, 7) > period) return false;
  const closedAt = g.closure?.closedAt;
  if (closedAt && closedAt.slice(0, 7) < period) return false;
  return true;
}

export const listForCommissionByMonth = queryWithAgencyScope({
  args: { periodMonth: v.string() },
  handler: async (ctx, { periodMonth }) => {
    if (!PERIOD_MONTH_PATTERN.test(periodMonth)) {
      return [];
    }

    // Cap server-side: the UI guards next-month, but a stale tab or a
    // direct caller could still request a future period.
    const effectivePeriod = periodMonth > currentPeriodMonth() ? currentPeriodMonth() : periodMonth;

    const guarantees = await ctx.db
      .query("guarantees")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId))
      .collect();

    const inForce = guarantees.filter((g) => isInForceDuring(g, effectivePeriod));
    const tenantNames = await tenantNamesByGuarantee(ctx, inForce);

    return inForce
      .map((g) => {
        const activatedMonth = g.activatedAt.slice(0, 7);
        const monthsElapsed = Math.min(
          monthDiff(activatedMonth, effectivePeriod) + 1,
          COMMISSION_INSTALLMENTS_TOTAL,
        );
        return {
          guaranteeId: g.publicId,
          tenantName: tenantNames.get(g._id) ?? "",
          rentCents: g.terms.rentCents,
          commissionCents: splitCommission(g.terms).commissionCents,
          installment: `${monthsElapsed}/${COMMISSION_INSTALLMENTS_TOTAL}`,
          activatedAt: g.activatedAt,
        };
      })
      .sort((a, b) => a.activatedAt.localeCompare(b.activatedAt));
  },
});

const CREDIT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isSupportedTaxIdLength(digits: string): boolean {
  return digits.length === 11 || digits.length === 14;
}

/**
 * The agency's live declaration that it holds or is seeking a rental
 * relationship with this subject — the Lei 12.414 art. 15 precondition a
 * bureau consultation is checked against. Scoped to the calling agency, so
 * one agency's declaration never authorises another's pull.
 */
async function findBindingApplication(
  ctx: QueryCtx,
  args: { agencyId: AgencyId; subjectHash: string; notBefore: number },
): Promise<ContractApplication | null> {
  return ctx.db
    .query("contractApplications")
    .withIndex("by_agency_subject_time", (q) =>
      q
        .eq("agencyId", args.agencyId)
        .eq("subjectHash", args.subjectHash)
        .gt("openedAt", args.notBefore),
    )
    .order("desc")
    .first();
}

export const getCachedCreditScore = queryWithAgencyScope({
  args: { document: v.string() },
  handler: async (ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    if (!isSupportedTaxIdLength(digits)) return null;

    const subjectHash = await hashPii(digits);
    const now = Date.now();

    // The cache is a bureau consultation the agency already paid for, so it
    // is reachable only under the same art. 15 binding that authorised the
    // pull. Without it the reader would learn whether this subject was ever
    // consulted, and what it scored, from a cache probe alone.
    const application = await findBindingApplication(ctx, {
      agencyId: ctx.agencyId,
      subjectHash,
      notBefore: now - CONTRACT_APPLICATION_VALIDITY_MS,
    });
    if (!application) return null;

    const assessment = await findFreshAssessment(ctx, {
      agencyId: ctx.agencyId,
      subjectHash,
      notBefore: now - CREDIT_CACHE_TTL_MS,
    });
    if (
      !assessment ||
      assessment.status !== "ok" ||
      assessment.score == null ||
      assessment.tier == null
    ) {
      return null;
    }
    return { score: assessment.score, tier: assessment.tier };
  },
});

type OpenContractApplicationSuccessResult = { applicationId: ContractApplicationId };
type OpenContractApplicationErrorResult = { code: typeof GUARANTEE_ERROR_CODE.INVALID_TAX_ID };

/**
 * Record the agency's intent to rent to this subject. Attributable to the
 * member who declared it, and the only thing that authorises a bureau
 * consultation on the subject.
 */
export const openContractApplication = mutationWithAgencyScope({
  args: {
    document: v.string(),
    entityType: tenantEntityTypeValidator,
    propertyKind: propertyKindValidator,
    cep: v.string(),
    rentCents: v.number(),
  },
  handler: async (
    ctx,
    { document, entityType, propertyKind, cep, rentCents },
  ): Promise<Result<OpenContractApplicationSuccessResult, OpenContractApplicationErrorResult>> => {
    const digits = document.replace(/\D/g, "");
    if (!isSupportedTaxIdLength(digits)) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.INVALID_TAX_ID },
        message: "Tax ID must be 11 (CPF) or 14 (CNPJ) digits",
      };
    }

    const applicationId = await ctx.db.insert("contractApplications", {
      agencyId: ctx.agencyId,
      subjectHash: await hashPii(digits),
      entityType,
      propertyKind,
      cep: cep.replace(/\D/g, ""),
      rentCents,
      openedBy: ctx.user._id,
      openedAt: Date.now(),
    });

    return {
      success: true,
      data: { applicationId },
      message: "Contract application opened",
    };
  },
});

export const requestCreditScore = mutationWithAgencyScope({
  args: { document: v.string() },
  handler: async (ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    if (!isSupportedTaxIdLength(digits)) {
      return { status: "invalid" } as const;
    }

    const subjectHash = await hashPii(digits);
    const now = Date.now();

    // Lei 12.414 art. 15: a consulente may only reach a bureau about someone
    // it holds or is seeking a commercial relationship with. Checked before
    // the cache here, and again on `getCachedCreditScore`, so an unbound
    // caller learns nothing about prior pulls through either path.
    const application = await findBindingApplication(ctx, {
      agencyId: ctx.agencyId,
      subjectHash,
      notBefore: now - CONTRACT_APPLICATION_VALIDITY_MS,
    });
    if (!application) return { status: "no_application" } as const;

    const fresh = await findFreshAssessment(ctx, {
      agencyId: ctx.agencyId,
      subjectHash,
      notBefore: now - CREDIT_CACHE_TTL_MS,
    });
    // Any fresh assessment gates re-scheduling — including an `unavailable`
    // one. Re-running the pull re-charges the provider, so a transient outage
    // is not retried until the TTL expires; getCachedCreditScore returns null
    // meanwhile.
    if (fresh) return { status: "cached" } as const;

    await ctx.scheduler.runAfter(0, internal.creditAnalysis.actions.runCreditAnalysis, {
      agencyId: ctx.agencyId,
      subjectType: SUBJECT_TYPE.TENANT,
      document: digits,
      capability: CAPABILITY.CREDIT_SCORE,
      applicationId: application._id,
    });
    return { status: "fetching" } as const;
  },
});

type CreateGuaranteeSuccessResult = { publicId: string; leasePublicId: string };
type CreateGuaranteeErrorResult = {
  code:
    | typeof TENANT_ERROR_CODE.INVALID_TAX_ID
    | typeof GUARANTEE_ERROR_CODE.TENANT_DENIED
    | typeof GUARANTEE_ERROR_CODE.INVALID_RENT
    | typeof GUARANTEE_ERROR_CODE.CREDIT_ASSESSMENT_REQUIRED
    | typeof PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE;
};

/**
 * Create a lease and its first guarantee, priced server-side against the
 * resolved product.
 *
 * Pilot shape: every create opens a fresh lease (`openGuaranteeId` set to the
 * new guarantee in the same transaction — the one-open-guarantee rule holds
 * trivially). Re-guaranteeing an existing lease arrives with the lifecycle
 * mutations and goes through `assertLeaseAcceptsGuarantee`.
 *
 * Registry-only tenant write: resolves the tenant registry row via
 * `getOrCreateTenant` and stores `tenantId` on the lease; the resolved
 * registry fields are also captured on the creation history event
 * (`tenantSnapshot`, the as-signed mitigation). Every error Result happens
 * before any write.
 */
export const create = mutationWithAgencyScope({
  args: {
    lease: v.object({
      propertyKind: propertyKindValidator,
      property: leasePropertyValidator,
      tag: v.string(),
      description: v.string(),
      rent: leaseRentInputValidator,
    }),
    plan: guaranteePlanValidator,
    productSlug: v.optional(v.string()),
    tenant: v.object({
      entityType: tenantEntityTypeValidator,
      fullName: v.string(),
      cpf: v.string(),
      cnpj: v.optional(v.string()),
      birthDate: v.string(),
      email: v.string(),
      phone: v.string(),
    }),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<CreateGuaranteeSuccessResult, CreateGuaranteeErrorResult>> => {
    const registryInput = normalizeEmbeddedTenant(args.tenant);
    if (!registryInput) {
      return {
        success: false,
        error: { code: TENANT_ERROR_CODE.INVALID_TAX_ID },
        message: "Tenant tax ID failed checksum validation",
      };
    }

    // Money inputs are integer cents; rent must be positive. The wizard guards
    // this client-side, but the mutation is the trust boundary — a negative rent
    // would flow into fees, the capacity ceiling, and the platform exposure
    // aggregate.
    if (!isValidRentInput(args.lease.rent)) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.INVALID_RENT },
        message: "Rent and fee amounts must be non-negative integer cents (rent > 0)",
      };
    }

    // The score is re-read from the assessment this agency actually pulled —
    // it is never accepted from the caller. It sets the price and decides the
    // denial, so a client-supplied value would let the browser buy itself a
    // better tier or walk past a `negado`. It is also the input to an
    // automated decision about a person, which has to be traceable to a
    // recorded provenance rather than to a request body.
    const assessment = await findFreshAssessment(ctx, {
      agencyId: ctx.agencyId,
      subjectHash: await hashPii(registryInput.taxId),
      notBefore: Date.now() - CREDIT_CACHE_TTL_MS,
    });
    if (!assessment || assessment.status !== "ok" || assessment.score == null) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.CREDIT_ASSESSMENT_REQUIRED },
        message: "No fresh credit assessment for this tenant; request one before creating",
      };
    }
    const score = assessment.score;

    // A denied credit tier cannot be priced (no product carries a rate for
    // `negado`) and must never become a guarantee. Reject before any write;
    // the narrowed `tier` below is what makes `priceGuarantee` type-check.
    const tier = tierForScore(score);
    if (tier === SCORE_TIER.NEGADO) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.TENANT_DENIED },
        message: "Tenant credit tier is denied",
      };
    }

    const now = new Date();
    const nowISO = now.toISOString();

    const productResult = await resolveProduct(ctx, {
      agencyId: ctx.agencyId,
      uf: ufFromCityUF(args.lease.property.cityUF),
      tier,
      propertyKind: args.lease.propertyKind,
      requestedSlug: args.productSlug,
      at: nowISO,
    });
    if (!productResult.success) {
      return {
        success: false,
        error: { code: PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE },
        message: productResult.message,
      };
    }
    const product = productResult.data.product;

    const tenantResult = await getOrCreateTenant(ctx, {
      input: registryInput,
      actor: { kind: "user", userId: ctx.user._id },
    });
    if (!tenantResult.success) {
      return {
        success: false,
        error: { code: TENANT_ERROR_CODE.INVALID_TAX_ID },
        message: tenantResult.message,
      };
    }

    const leasePublicId = generateLeasePublicId();
    const leaseId = await ctx.db.insert("leases", {
      agencyId: ctx.agencyId,
      publicId: leasePublicId,
      tenantId: tenantResult.data.tenantId,
      propertyKind: args.lease.propertyKind,
      property: args.lease.property,
      tag: args.lease.tag,
      description: args.lease.description,
      rent: buildLeaseRent(args.lease.rent),
      payer: DEFAULT_PAYER,
      openGuaranteeId: null,
    });

    const publicId = generateGuaranteePublicId();
    const priced = priceGuarantee(
      {
        rentCents: args.lease.rent.rentCents,
        tier,
        plan: args.plan,
        productSlug: product.slug,
        appliedAt: nowISO,
      },
      product.terms,
    );
    const nextRenewalDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      .toISOString()
      .slice(0, 10);

    const guaranteeId = await ctx.db.insert("guarantees", {
      agencyId: ctx.agencyId,
      leaseId,
      publicId,
      productId: product._id,
      status: GUARANTEE_STATE.DRAFTED,
      activatedAt: null,
      nextRenewalDate,
      underwriting: { score, tier, assessmentId: assessment._id },
      tenantApproval: { status: TENANT_APPROVAL_STATUS.PENDENTE, termApprovedAt: null },
      terms: priced.terms,
      capacity: priced.capacity,
      documents: [
        { key: DOCUMENT_KEY.RENTAL_CONTRACT, status: DOCUMENT_STATUS.PENDENTE },
        { key: DOCUMENT_KEY.INSPECTION, status: DOCUMENT_STATUS.PENDENTE },
        { key: DOCUMENT_KEY.POLICY, status: DOCUMENT_STATUS.PENDENTE },
      ],
    });

    const doc = await ctx.db.get(guaranteeId);
    if (!doc) throw new Error("Guarantee insert failed");
    await insertGuaranteeAggregates(ctx, doc);

    await ctx.db.patch(leaseId, { openGuaranteeId: guaranteeId });

    await ctx.db.insert("guaranteeHistory", {
      agencyId: ctx.agencyId,
      guaranteePublicId: publicId,
      at: nowISO,
      username: ctx.user.name,
      message: "Garantia criada",
      // As-signed snapshot: the checksum-normalized registry fields at
      // creation time, frozen on the append-only history event.
      tenantSnapshot: registryInput,
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.LEASE_CREATED,
      resourceType: "leases",
      resourceId: leasePublicId,
      payload: {
        leaseId,
        agencyId: ctx.agencyId,
        propertyKind: args.lease.propertyKind,
        rent: buildLeaseRent(args.lease.rent),
      },
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.GUARANTEE_CREATED,
      resourceType: "guarantees",
      resourceId: publicId,
      payload: {
        guaranteeId,
        leaseId,
        agencyId: ctx.agencyId,
        productId: product._id,
        status: GUARANTEE_STATE.DRAFTED,
        terms: priced.terms,
        capacity: priced.capacity,
      },
    });

    await ctx.scheduler.runAfter(0, internal.guarantees.actions.sendProposalNotifications, {
      publicId,
      tenantName: args.tenant.fullName,
      tenantEmail: args.tenant.email,
      tenantPhone: args.tenant.phone,
      rentCents: args.lease.rent.rentCents,
      availableGuaranteeCents: priced.capacity.availableCents,
      feeCents: priced.terms.feeCents,
    });

    return { success: true, data: { publicId, leasePublicId }, message: "Guarantee created" };
  },
});

type CancelDraftSuccessResult = { canceled: true };
type CancelDraftErrorResult = {
  code: typeof GUARANTEE_ERROR_CODE.NOT_FOUND | typeof GUARANTEE_ERROR_CODE.NOT_DRAFTED;
};

/**
 * Close a draft before activation (`drafted → closed`, reason
 * `canceled_pre_activation`). Lives here rather than in `mutations.ts` because
 * the agency detail page binds to `api.guarantees.useCases.cancelDraft`; the
 * lifecycle mechanics belong to the shared helper, so there is still exactly
 * one implementation of the transition.
 */
export const cancelDraft = mutationWithAgencyScope({
  args: { publicId: v.string() },
  handler: async (ctx, args): Promise<Result<CancelDraftSuccessResult, CancelDraftErrorResult>> => {
    const candidates = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .collect();
    const guarantee = candidates.find((candidate) => candidate.agencyId === ctx.agencyId);

    // NOT_FOUND covers both "no such publicId" and "publicId exists but in a
    // different agency" — don't leak cross-agency existence.
    if (!guarantee) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.NOT_FOUND },
        message: "Guarantee not found",
      };
    }

    const applied = await applyGuaranteeTransition(ctx, {
      guarantee,
      to: GUARANTEE_STATE.CLOSED,
      closure: { reason: CLOSE_REASON.CANCELED_PRE_ACTIVATION },
      actor: { userId: ctx.user._id, username: ctx.user.name },
      message: "Proposta cancelada",
    });
    // Every machine refusal collapses to one agency-facing code: from an
    // agency's point of view the only thing that can be wrong here is that the
    // guarantee is no longer a draft, and `guaranteeDetails.errors.NOT_DRAFTED`
    // is the message it already renders.
    if (!applied.success) {
      return {
        success: false,
        error: { code: GUARANTEE_ERROR_CODE.NOT_DRAFTED },
        message: applied.message,
      };
    }

    return { success: true, data: { canceled: true }, message: "Draft canceled" };
  },
});

/**
 * Discriminated pf/pj tenant view. Approval fields are guarantee-level
 * (`tenantApproval`); identity/contact fields come from `identity`, which the
 * caller resolves to the owning agency's own submission — never another
 * agency's values on the shared registry row (LGPD-26).
 */
function shapeGuaranteeTenant(doc: Guarantee, identity: Tenant | TenantInput) {
  const shared = {
    approvalStatus: doc.tenantApproval.status,
    termApprovedAt: doc.tenantApproval.termApprovedAt,
    taxId: identity.taxId,
    fullName: identity.fullName,
    email: identity.email,
    phone: identity.phone,
  };
  if (identity.entityType === "pj") {
    return { ...shared, entityType: "pj" as const, contactCpf: identity.contactCpf };
  }
  return { ...shared, entityType: "pf" as const, birthDate: identity.birthDate };
}

function shapeLease(lease: Lease) {
  return {
    id: lease.publicId,
    propertyKind: lease.propertyKind,
    property: lease.property,
    tag: lease.tag,
    description: lease.description,
    rent: lease.rent,
    payer: lease.payer,
  };
}

/**
 * Reshape a `guarantees` doc + its lease + resolved tenant identity + history
 * into the UI detail type. Strips system fields (`_id`, `_creationTime`);
 * renames publicId → id.
 */
function shapeGuarantee({
  guarantee,
  lease,
  identity,
  history,
}: {
  guarantee: Guarantee;
  lease: Lease;
  identity: Tenant | TenantInput;
  history: GuaranteeHistory[];
}) {
  return {
    id: guarantee.publicId,
    agencyId: guarantee.agencyId,
    status: guarantee.status,
    closure: guarantee.closure ?? null,
    activatedAt: guarantee.activatedAt,
    nextRenewalDate: guarantee.nextRenewalDate,
    underwriting: guarantee.underwriting,
    terms: guarantee.terms,
    capacity: guarantee.capacity,
    documents: guarantee.documents,
    lease: shapeLease(lease),
    tenant: shapeGuaranteeTenant(guarantee, identity),
    history: history.map((h) => ({
      at: h.at,
      username: h.username,
      message: h.message,
    })),
  };
}
