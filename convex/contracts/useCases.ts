import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashPii } from "../lib/pii";
import { priceContract, splitCommission, feeBreakdown } from "./pricing";
import type {
  Contract,
  ContractApplication,
  ContractApplicationId,
  ContractHistory,
  ContractId,
} from "./domain";
import type { AgencyId } from "../agencies/domain";
import type { Tenant, TenantId, TenantInput } from "../tenants/domain";
import {
  ativoInsuredCentsPlatform,
  contractsByStatus,
  contractsByStatusPlatform,
} from "./aggregate";
import { insertContractAggregates, replaceContractAggregates } from "./aggregateWrites";
import {
  CONTRACT_APPLICATION_VALIDITY_MS,
  CONTRACT_STATUS,
  CONTRACT_ERROR_CODE,
  contractPlanValidator,
  propertyKindValidator,
  DEFAULT_EXIT_COST_MULTIPLIER,
  DEFAULT_PAYER,
  DEFAULT_RENT_MULTIPLIER,
  SCORE_TIER,
  tierForScore,
  getUrgencyTier,
  urgencySortKey,
  expiringRenewalBounds,
} from "./domain";
import {
  normalizeEmbeddedTenant,
  tenantEntityTypeValidator,
  tenantInputFromSubmission,
  tenantInputFromRegistry,
  TENANT_ERROR_CODE,
} from "../tenants/domain";
import { agencySubmittedTenant } from "./tenantIdentity";
import { getOrCreateTenant } from "../tenants/useCases";
import type { Result } from "../lib/result";
import { findFreshAssessment } from "../creditAnalysis/useCases";
import { CAPABILITY, SUBJECT_TYPE } from "../creditAnalysis/domain";
import type { ActivityBucket } from "./domain";
import { getMaxGuaranteeCapacityCents } from "../lib/env";
import { generateContractPublicId } from "../lib/randomId";
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
    // agencies can produce collisions (e.g. publicId `1000036` seeded
    // into both Paulista and Aprovada). We disambiguate by membership:
    // return the first contract whose `agencyId` the caller has access
    // to. Returns null on "no such id" AND "not a member of any owning
    // agency" — same shape as before, no cross-agency existence leak.
    const candidates = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .collect();

    for (const contract of candidates) {
      try {
        await assertAgencyAccess(ctx, contract.agencyId);
      } catch {
        continue;
      }

      const tenant = await ctx.db.get(contract.tenantId);
      // FK-integrity invariant, not a leak case: `tenantId` is required and
      // registry rows are never deleted, so a miss means corrupted data.
      if (!tenant) {
        throw new Error(`Contract ${contract.publicId} references a missing tenants row`);
      }

      // Scoped by agency, not by publicId alone: publicId carries no DB-level
      // uniqueness constraint, so `by_contract` would fold another agency's
      // history rows — username and message included — into this response.
      const history = await ctx.db
        .query("contractHistory")
        .withIndex("by_agency_contract", (q) =>
          q.eq("agencyId", contract.agencyId).eq("contractPublicId", args.publicId),
        )
        .order("desc")
        // Hard cap; if contracts exceed 100 history entries we'll need pagination.
        .take(100);

      const submitted = await agencySubmittedTenant(ctx, contract);

      return shapeContract(contract, submitted ?? tenant, history);
    }

    return null;
  },
});

/**
 * Internal companion to `getByPublicId` for actions that authorize by a
 * non-user model (e.g. tenant checkout flows triggered by publicId-bearer).
 * Returns the raw contract doc — no history, no shaping. The calling
 * internal flow is responsible for whatever authorization is appropriate
 * at its entry point.
 */
export const getByPublicIdInternal = internalQuery({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    return ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique();
  },
});

/**
 * Tenant identity for a contract as the *owning* agency submitted it, for
 * actions that have no `ctx.db` (anchor SEP-9 prefill). Never returns the
 * shared registry row while a submission exists: the registry keeps its first
 * writer's values and is write-once, so shipping it to a third-party anchor
 * would disclose another agency's contact data and freeze a stale one
 * (LGPD-26). Falls back to the registry only for contracts predating the
 * snapshot.
 */
export const getTenantIdentityInternal = internalQuery({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }): Promise<TenantInput | null> => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique();
    if (!contract) return null;

    const submitted = await agencySubmittedTenant(ctx, contract);
    if (submitted) return submitted;

    const tenant = await ctx.db.get(contract.tenantId);
    return tenant ? tenantInputFromRegistry(tenant) : null;
  },
});

/**
 * Resolve each contract's tenant display name. One get per UNIQUE tenantId
 * keeps the registry join O(unique tenants) instead of O(rows); the
 * per-contract creation snapshot then overrides it wherever the agency
 * submitted its own name. A registry miss is an FK-integrity violation
 * (`tenantId` is required, registry rows are never deleted), so it throws.
 */
async function tenantNamesByContract(
  ctx: QueryCtx,
  docs: readonly Contract[],
): Promise<Map<ContractId, string>> {
  const registryNames = new Map<TenantId, string>();
  await Promise.all(
    [...new Set(docs.map((doc) => doc.tenantId))].map(async (tenantId) => {
      const tenant = await ctx.db.get(tenantId);
      if (!tenant) throw new Error(`Contracts reference a missing tenants row ${tenantId}`);
      registryNames.set(tenantId, tenant.fullName);
    }),
  );

  const names = new Map<ContractId, string>();
  await Promise.all(
    docs.map(async (doc) => {
      const submitted = await agencySubmittedTenant(ctx, doc);
      names.set(doc._id, submitted?.fullName ?? registryNames.get(doc.tenantId) ?? "");
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

const CONTRACT_TAB = {
  ALL: "all",
  EXPIRING: "expiring",
  ATIVO: "ativo",
  PENDENTE: "pendente",
  ENCERRADO: "encerrado",
  CANCELADO: "cancelado",
} as const;
type ContractTab = (typeof CONTRACT_TAB)[keyof typeof CONTRACT_TAB];
const contractTabValidator = v.union(
  v.literal(CONTRACT_TAB.ALL),
  v.literal(CONTRACT_TAB.EXPIRING),
  v.literal(CONTRACT_TAB.ATIVO),
  v.literal(CONTRACT_TAB.PENDENTE),
  v.literal(CONTRACT_TAB.ENCERRADO),
  v.literal(CONTRACT_TAB.CANCELADO),
);

/** Paginated list scoped to one agency, filtered by tab. */
export const listByAgency = queryWithAgencyScope({
  args: {
    paginationOpts: paginationOptsValidator,
    tab: v.optional(contractTabValidator),
    referenceDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const referenceDate = resolveReferenceDate(args.referenceDate);
    const tab: ContractTab = args.tab ?? CONTRACT_TAB.ALL;

    const result = await (tab === CONTRACT_TAB.EXPIRING
      ? (() => {
          const bounds = expiringRenewalBounds(referenceDate);
          return ctx.db
            .query("contracts")
            .withIndex("by_agency_status_nextRenewalDate", (q) =>
              q
                .eq("agencyId", ctx.agencyId)
                .eq("status", CONTRACT_STATUS.ATIVO)
                .gte("nextRenewalDate", bounds.gte)
                .lte("nextRenewalDate", bounds.lte),
            )
            .order("asc")
            .paginate(args.paginationOpts);
        })()
      : tab === CONTRACT_TAB.ALL
        ? ctx.db
            .query("contracts")
            .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId))
            .order("desc")
            .paginate(args.paginationOpts)
        : ctx.db
            .query("contracts")
            .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId).eq("status", tab))
            .order("desc")
            .paginate(args.paginationOpts));

    const tenantNames = await tenantNamesByContract(ctx, result.page);

    return {
      ...result,
      page: result.page.map((doc) =>
        shapeContractSummary(doc, tenantNames.get(doc._id) ?? "", referenceDate),
      ),
    };
  },
});

/**
 * Lightweight summary of a contract for list views — drops the heavy
 * `rental`/`property`/`optional`/`documents` fields and joins only the
 * tenant's display name. Use shapeContract for the detail view.
 */
function shapeContractSummary(doc: Contract, tenantName: string, referenceDate: string) {
  const urgency = getUrgencyTier({
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    referenceDate,
  });
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeCents: doc.availableGuaranteeCents,
    tenantName,
    creationTime: doc._creationTime,
    urgency,
    urgencySortKey: urgencySortKey(urgency),
  };
}

const STATUS_KEYS = [
  CONTRACT_STATUS.ATIVO,
  CONTRACT_STATUS.PENDENTE,
  CONTRACT_STATUS.ENCERRADO,
  CONTRACT_STATUS.CANCELADO,
] as const;

type StatusCounts = {
  ativo: number;
  pendente: number;
  encerrado: number;
  cancelado: number;
};

function shapeStatusCountsResult(counts: readonly number[]): StatusCounts {
  return {
    ativo: counts[0] ?? 0,
    pendente: counts[1] ?? 0,
    encerrado: counts[2] ?? 0,
    cancelado: counts[3] ?? 0,
  };
}

/**
 * Per-agency status counts. O(log n) via the namespaced `contractsByStatus`
 * aggregate. Used by `section-cards.tsx` (Painel) KPI tiles.
 */
export const getStatusCounts = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    const counts = await contractsByStatus.countBatch(
      ctx,
      STATUS_KEYS.map((status) => ({
        namespace: ctx.agencyId,
        bounds: {
          lower: { key: status, inclusive: true },
          upper: { key: status, inclusive: true },
        },
      })),
    );

    return shapeStatusCountsResult(counts);
  },
});

/**
 * Per-tab badge counts for the contracts list. Status buckets reuse the
 * O(log n) `contractsByStatus` aggregate; the `expiring` badge counts the
 * indexed ativo renewal range.
 */
export const getContractTabCounts = queryWithAgencyScope({
  args: { referenceDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const referenceDate = resolveReferenceDate(args.referenceDate);
    const statusCounts = await contractsByStatus.countBatch(
      ctx,
      STATUS_KEYS.map((status) => ({
        namespace: ctx.agencyId,
        bounds: {
          lower: { key: status, inclusive: true },
          upper: { key: status, inclusive: true },
        },
      })),
    );
    const counts = shapeStatusCountsResult(statusCounts);

    const bounds = expiringRenewalBounds(referenceDate);
    // Bounded range scan over ativo renewals; revisit with a date-aware aggregate if it outgrows this.
    const expiringRows = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status_nextRenewalDate", (q) =>
        q
          .eq("agencyId", ctx.agencyId)
          .eq("status", CONTRACT_STATUS.ATIVO)
          .gte("nextRenewalDate", bounds.gte)
          .lte("nextRenewalDate", bounds.lte),
      )
      .collect();

    return {
      all: counts.ativo + counts.pendente + counts.encerrado + counts.cancelado,
      expiring: expiringRows.length,
      ativo: counts.ativo,
      pendente: counts.pendente,
      encerrado: counts.encerrado,
      cancelado: counts.cancelado,
    };
  },
});

/**
 * Platform-wide status counts. O(log n) via the un-namespaced
 * `contractsByStatusPlatform` aggregate. Used by the health/transparency page.
 */
export const getStatusCountsGlobal = queryWithAuth({
  args: {},
  handler: async (ctx) => {
    const counts = await contractsByStatusPlatform.countBatch(
      ctx,
      STATUS_KEYS.map((status) => ({
        bounds: {
          lower: { key: status, inclusive: true },
          upper: { key: status, inclusive: true },
        },
      })),
    );

    return shapeStatusCountsResult(counts);
  },
});

/**
 * Platform-wide insured capacity. Sum of worst-case exposure (30x rent-coverage
 * ceiling + 6x exit sublimit) across every contract in status `ativo`, plus the
 * configured global capacity cap. O(log n) via the `ativoInsuredCentsPlatform`
 * aggregate.
 */
export const getInsuredCapacityGlobal = queryWithAuth({
  args: {},
  handler: async (ctx) => {
    const sumInsuredCents = await ativoInsuredCentsPlatform.sum(ctx, {
      bounds: {
        lower: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
        upper: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
      },
    });

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

type ContractTimePoint = {
  activatedAt: string | null;
  deactivatedAt?: string | null;
  status: Contract["status"];
};

function bucketsForContracts(
  contracts: readonly ContractTimePoint[],
  boundaries: readonly PeriodBoundary[],
): ActivityBucket[] {
  return boundaries.map(({ startISO, endISO, key }) => {
    let activated = 0;
    let cancelled = 0;
    let expired = 0;
    let netActive = 0;

    for (const c of contracts) {
      const activatedAt = c.activatedAt;
      const deactivatedAt = c.deactivatedAt ?? null;

      if (activatedAt && activatedAt >= startISO && activatedAt < endISO) {
        activated++;
      }
      if (deactivatedAt && deactivatedAt >= startISO && deactivatedAt < endISO) {
        if (c.status === CONTRACT_STATUS.CANCELADO) cancelled++;
        else if (c.status === CONTRACT_STATUS.ENCERRADO) expired++;
      }

      if (!activatedAt) continue;
      if (activatedAt >= endISO) continue;
      if (deactivatedAt && deactivatedAt < endISO) continue;
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
 * Contract-activity time series, scoped to either one agency or the platform.
 *
 * Auth: `queryWithAuth` + inline `assertAgencyAccess` for the agency arm —
 * since wrapper choice is static per handler, the scope discriminator is the
 * only way to serve both consumers from a single public function.
 *
 * Per-agency scope uses the `by_agency_status` index to bound the scan;
 * platform scope does a full `.collect()` by design. Time-series aggregates
 * are deliberately deferred until the contracts table crosses ~5–10k rows.
 */
export const getActivityByPeriod = queryWithAuth({
  args: {
    scope: activityScopeValidator,
    granularity: activityGranularityValidator,
  },
  handler: async (ctx, { scope, granularity }): Promise<ActivityBucket[]> => {
    let contracts: readonly ContractTimePoint[];
    if (scope.kind === "agency") {
      await assertAgencyAccess(ctx, scope.agencyId);
      contracts = await ctx.db
        .query("contracts")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", scope.agencyId))
        .collect();
    } else {
      contracts = await ctx.db.query("contracts").collect();
    }

    const now = new Date();
    const boundaries =
      granularity === "month"
        ? buildMonthBoundaries(now, ACTIVITY_MONTH_PERIODS)
        : buildWeekBoundaries(now, ACTIVITY_WEEK_PERIODS);

    return bucketsForContracts(contracts, boundaries);
  },
});

/**
 * Active contracts during the given `YYYY-MM` period, shaped for the
 * Commission page. "Active during" means `activatedAt` is on or before
 * the period and the contract wasn't deactivated *before* it — a
 * contract deactivated during the period still earned commission for
 * that period, so it stays in the result. Commission is the same
 * `splitCommission` the wizard previews (taxa at `commissionRate` + prestamista
 * premium at `prestamistaCommissionRate`), recovered from the stored fee + plan.
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

type ActivatedContract = Contract & { activatedAt: string };

function isActiveDuring(c: Contract, period: string): c is ActivatedContract {
  if (!c.activatedAt) return false;
  if (c.activatedAt.slice(0, 7) > period) return false;
  if (c.deactivatedAt && c.deactivatedAt.slice(0, 7) < period) return false;
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

    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId))
      .collect();

    const activeContracts = contracts.filter((c) => isActiveDuring(c, effectivePeriod));
    const tenantNames = await tenantNamesByContract(ctx, activeContracts);

    return activeContracts
      .map((c) => {
        const activatedMonth = c.activatedAt.slice(0, 7);
        const monthsElapsed = Math.min(
          monthDiff(activatedMonth, effectivePeriod) + 1,
          COMMISSION_INSTALLMENTS_TOTAL,
        );
        return {
          contractId: c.publicId,
          tenantName: tenantNames.get(c._id) ?? "",
          rentCents: c.rental.rentCents,
          commissionCents: splitCommission(feeBreakdown(c.rental)).commissionCents,
          installment: `${monthsElapsed}/${COMMISSION_INSTALLMENTS_TOTAL}`,
          activatedAt: c.activatedAt,
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
type OpenContractApplicationErrorResult = { code: typeof CONTRACT_ERROR_CODE.INVALID_TAX_ID };

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
        error: { code: CONTRACT_ERROR_CODE.INVALID_TAX_ID },
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

type CreateContractSuccessResult = { publicId: string };
type CreateContractErrorResult = {
  code:
    | typeof TENANT_ERROR_CODE.INVALID_TAX_ID
    | typeof CONTRACT_ERROR_CODE.TENANT_DENIED
    | typeof CONTRACT_ERROR_CODE.INVALID_RENT
    | typeof CONTRACT_ERROR_CODE.CREDIT_ASSESSMENT_REQUIRED;
};

/**
 * Create a new contract with server-side fee calculation.
 *
 * Registry-only write: resolves the tenant registry row via
 * `getOrCreateTenant` and stores `tenantId` + `tenantApproval` + the
 * creation-time `score`; the resolved registry fields are also captured on
 * the creation history event (`tenantSnapshot`, the as-signed mitigation).
 * The tax-id checksum rejection is the only error Result and happens
 * before any write.
 */
export const create = mutationWithAgencyScope({
  args: {
    property: v.object({
      cep: v.string(),
      streetAndNumber: v.string(),
      neighborhood: v.string(),
      cityUF: v.string(),
    }),
    optional: v.object({
      complement: v.string(),
      tag: v.string(),
      description: v.string(),
    }),
    propertyKind: v.union(v.literal("residencial"), v.literal("comercial")),
    plan: contractPlanValidator,
    rentCents: v.number(),
    condoCents: v.number(),
    otherFeesCents: v.number(),
    tenant: v.object({
      entityType: v.union(v.literal("pf"), v.literal("pj")),
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
  ): Promise<Result<CreateContractSuccessResult, CreateContractErrorResult>> => {
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
    // would flow into fees, the guarantee, and the platform exposure aggregate.
    if (
      !Number.isInteger(args.rentCents) ||
      args.rentCents <= 0 ||
      !Number.isInteger(args.condoCents) ||
      args.condoCents < 0 ||
      !Number.isInteger(args.otherFeesCents) ||
      args.otherFeesCents < 0
    ) {
      return {
        success: false,
        error: { code: CONTRACT_ERROR_CODE.INVALID_RENT },
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
        error: { code: CONTRACT_ERROR_CODE.CREDIT_ASSESSMENT_REQUIRED },
        message: "No fresh credit assessment for this tenant; request one before creating",
      };
    }
    const score = assessment.score;

    // A denied credit tier cannot be priced (no rate exists for `negado`) and
    // must never become a contract. Reject before any write; the narrowed
    // `tier` below is what makes `priceContract` type-check.
    const tier = tierForScore(score);
    if (tier === SCORE_TIER.NEGADO) {
      return {
        success: false,
        error: { code: CONTRACT_ERROR_CODE.TENANT_DENIED },
        message: "Tenant credit tier is denied",
      };
    }

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

    const priced = priceContract({
      rentCents: args.rentCents,
      condoCents: args.condoCents,
      otherFeesCents: args.otherFeesCents,
      tier,
      plan: args.plan,
    });

    const publicId = generateContractPublicId();
    const today = new Date();
    const nextRenewalDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10);

    // Single source for the multipliers written below, so the audit entry
    // mirrors exactly what the rental bundle persisted (they must not drift).
    const rentMultiplier = DEFAULT_RENT_MULTIPLIER;
    const exitCostMultiplier = DEFAULT_EXIT_COST_MULTIPLIER;

    const contractId = await ctx.db.insert("contracts", {
      agencyId: ctx.agencyId,
      publicId,
      tenantId: tenantResult.data.tenantId,
      tenantApproval: { status: "pendente", termApprovedAt: null },
      score,
      status: "pendente",
      activatedAt: null,
      nextRenewalDate,
      availableGuaranteeCents: priced.availableGuaranteeCents,
      rental: {
        propertyKind: args.propertyKind,
        plan: args.plan,
        rentCents: args.rentCents,
        condoCents: args.condoCents,
        otherFeesCents: args.otherFeesCents,
        totalRentCents: priced.totalRentCents,
        feeCents: priced.feeCents,
        oneTimeActivationFeeCents: priced.oneTimeActivationFeeCents,
        setupInstallments: 1,
        exitCostMultiplier,
        rentMultiplier,
        payer: DEFAULT_PAYER,
        pviMigrationSchedule: null,
      },
      property: args.property,
      optional: args.optional,
      documents: [
        { key: "rentalContract", status: "pendente" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
    });

    const doc = await ctx.db.get(contractId);
    if (!doc) throw new Error("Contract insert failed");
    await insertContractAggregates(ctx, doc);

    await ctx.db.insert("contractHistory", {
      agencyId: ctx.agencyId,
      contractPublicId: publicId,
      at: new Date().toISOString(),
      username: ctx.user.name,
      message: "Contrato criado",
      // As-signed snapshot: the checksum-normalized registry fields at
      // creation time, frozen on the append-only history event.
      tenantSnapshot: registryInput,
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.CONTRACT_CREATED,
      resourceType: "contracts",
      resourceId: publicId,
      payload: {
        contractId,
        agencyId: ctx.agencyId,
        propertyKind: args.propertyKind,
        rentCents: args.rentCents,
        totalRentCents: priced.totalRentCents,
        feeCents: priced.feeCents,
        oneTimeActivationFeeCents: priced.oneTimeActivationFeeCents,
        availableGuaranteeCents: priced.availableGuaranteeCents,
        rentMultiplier,
        exitCostMultiplier,
      },
    });

    await ctx.scheduler.runAfter(0, internal.contracts.actions.sendProposalNotifications, {
      publicId,
      tenantName: args.tenant.fullName,
      tenantEmail: args.tenant.email,
      tenantPhone: args.tenant.phone,
      rentCents: args.rentCents,
      availableGuaranteeCents: priced.availableGuaranteeCents,
      feeCents: priced.feeCents,
    });

    return { success: true, data: { publicId }, message: "Contract created" };
  },
});

export const cancelProposal = mutationWithAgencyScope({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    // NOT_FOUND covers both "no such publicId" and "publicId exists but in a
    // different agency" — don't leak cross-agency existence.
    if (!contract || contract.agencyId !== ctx.agencyId) {
      return { success: false, error: { code: "NOT_FOUND" } } as const;
    }
    if (contract.status !== "pendente") {
      return { success: false, error: { code: "NOT_PENDING" } } as const;
    }

    await ctx.db.patch(contract._id, { status: "cancelado" });
    const after = await ctx.db.get(contract._id);
    if (after) await replaceContractAggregates(ctx, contract, after);

    await ctx.db.insert("contractHistory", {
      agencyId: contract.agencyId,
      contractPublicId: args.publicId,
      at: new Date().toISOString(),
      username: ctx.user.name,
      message: "Proposta cancelada",
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.CONTRACT_CANCELED,
      resourceType: "contracts",
      resourceId: args.publicId,
      payload: {
        contractId: contract._id,
        agencyId: contract.agencyId,
        previousStatus: contract.status,
      },
    });

    return { success: true, data: { cancelled: true } } as const;
  },
});

/**
 * Discriminated pf/pj tenant view. Approval fields are contract-level
 * (`tenantApproval`); identity/contact fields come from `identity`, which the
 * caller resolves to the owning agency's own submission — never another
 * agency's values on the shared registry row (LGPD-26).
 */
function shapeContractTenant(doc: Contract, identity: Tenant | TenantInput) {
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

/**
 * Reshape a Convex `contracts` doc + its resolved tenant identity + history
 * into the UI Contract type. Strips system fields (`_id`,
 * `_creationTime`); renames publicId → id.
 */
function shapeContract(doc: Contract, identity: Tenant | TenantInput, history: ContractHistory[]) {
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeCents: doc.availableGuaranteeCents,
    rental: doc.rental,
    property: doc.property,
    optional: doc.optional,
    documents: doc.documents,
    tenant: shapeContractTenant(doc, identity),
    history: history.map((h) => ({
      at: h.at,
      username: h.username,
      message: h.message,
    })),
  };
}
