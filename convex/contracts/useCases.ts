import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashPii } from "../lib/pii";
import { priceContract } from "../../apps/agency/src/lib/pricing/contract";
import type { Contract, ContractHistory } from "./domain";
import {
  ativoInsuredCentsPlatform,
  contractsByStatus,
  contractsByStatusPlatform,
} from "./aggregate";
import { insertContractAggregates, replaceContractAggregates } from "./aggregateWrites";
import {
  CONTRACT_STATUS,
  DEFAULT_EXIT_COST_MULTIPLIER,
  DEFAULT_PAYER,
  DEFAULT_RENT_MULTIPLIER,
} from "./domain";
import { findFreshAssessment } from "../creditRisk/useCases";
import { CAPABILITY, SUBJECT_TYPE } from "../creditRisk/domain";
import type { ActivityBucket } from "./domain";
import { getMaxGuaranteeCapacityCents } from "../lib/env";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import {
  assertAgencyAccess,
  mutationWithAgencyScope,
  queryWithAgencyScope,
  queryWithAuth,
} from "../lib/auth";

function generatePublicId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "CTR-";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

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

      const history = await ctx.db
        .query("contractHistory")
        .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
        .order("desc")
        // Hard cap; if contracts exceed 100 history entries we'll need pagination.
        .take(100);

      return shapeContract(contract, history);
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

/** Paginated list scoped to one agency. */
export const listByAgency = queryWithAgencyScope({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map(shapeContractSummary),
    };
  },
});

/**
 * Lightweight summary of a contract for list views — drops the heavy
 * `rental`/`property`/`optional`/`documents`/`tenant` fields.
 * Use shapeContract for the detail view.
 */
function shapeContractSummary(doc: Contract) {
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeCents: doc.availableGuaranteeCents,
    tenantName: doc.tenant.fullName,
    creationTime: doc._creationTime,
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
 * Platform-wide insured capacity. Sum of `availableGuaranteeCents` across
 * every contract in status `ativo`, plus the configured global capacity cap.
 * O(log n) via the `ativoInsuredCentsPlatform` aggregate.
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
 * that period, so it stays in the result. Commission is a placeholder
 * 1.5% of `rentCents` until the rate-card domain ships (#83 —
 * `pricingVersion` snapshot).
 */
const COMMISSION_RATE_BPS = 150; // 150 basis points = 1.5%
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

    return contracts
      .filter((c) => isActiveDuring(c, effectivePeriod))
      .map((c) => {
        const activatedMonth = c.activatedAt.slice(0, 7);
        const monthsElapsed = Math.min(
          monthDiff(activatedMonth, effectivePeriod) + 1,
          COMMISSION_INSTALLMENTS_TOTAL,
        );
        return {
          contractId: c.publicId,
          tenantName: c.tenant.fullName,
          rentCents: c.rental.rentCents,
          commissionCents: Math.round((c.rental.rentCents * COMMISSION_RATE_BPS) / 10000),
          installment: `${monthsElapsed}/${COMMISSION_INSTALLMENTS_TOTAL}`,
          activatedAt: c.activatedAt,
        };
      })
      .sort((a, b) => a.activatedAt.localeCompare(b.activatedAt));
  },
});

const CREDIT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const getCachedCreditScore = queryWithAgencyScope({
  args: { document: v.string() },
  handler: async (ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) return null;

    const subjectHash = await hashPii(digits);
    const assessment = await findFreshAssessment(ctx, {
      agencyId: ctx.agencyId,
      subjectHash,
      notBefore: Date.now() - CREDIT_CACHE_TTL_MS,
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

export const requestCreditScore = mutationWithAgencyScope({
  args: { document: v.string() },
  handler: async (ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) {
      return { status: "invalid" } as const;
    }

    const subjectHash = await hashPii(digits);
    const fresh = await findFreshAssessment(ctx, {
      agencyId: ctx.agencyId,
      subjectHash,
      notBefore: Date.now() - CREDIT_CACHE_TTL_MS,
    });
    // Any fresh assessment gates re-scheduling — including an `unavailable`
    // one. Re-running the pull re-charges the provider, so a transient outage
    // is not retried until the TTL expires; getCachedCreditScore returns null
    // meanwhile.
    if (fresh) return { status: "cached" } as const;

    await ctx.scheduler.runAfter(0, internal.creditRisk.actions.runCreditAnalysis, {
      agencyId: ctx.agencyId,
      subjectType: SUBJECT_TYPE.TENANT,
      document: digits,
      capability: CAPABILITY.CREDIT_SCORE,
    });
    return { status: "fetching" } as const;
  },
});

/** Lookup tenant name by CPF from existing contracts in this agency. */
export const lookupTenantByCpf = queryWithAgencyScope({
  args: { cpf: v.string() },
  handler: async (ctx, { cpf }) => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_agency_tenant_cpf", (q) => q.eq("agencyId", ctx.agencyId).eq("tenantCpf", cpf))
      .first();
    if (!contract) return null;
    return { fullName: contract.tenant.fullName, email: contract.tenant.email };
  },
});

/** Create a new contract with server-side fee calculation. */
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
      score: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const priced = priceContract({
      rentCents: args.rentCents,
      condoCents: args.condoCents,
      otherFeesCents: args.otherFeesCents,
      score: args.tenant.score,
    });

    const publicId = generatePublicId();
    const today = new Date();
    const nextRenewalDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10);

    const contractId = await ctx.db.insert("contracts", {
      agencyId: ctx.agencyId,
      publicId,
      tenantCpf: args.tenant.cpf,
      status: "pendente",
      activatedAt: null,
      nextRenewalDate,
      availableGuaranteeCents: priced.availableGuaranteeCents,
      rental: {
        propertyKind: args.propertyKind,
        rentCents: args.rentCents,
        condoCents: args.condoCents,
        otherFeesCents: args.otherFeesCents,
        totalRentCents: priced.totalRentCents,
        feeCents: priced.feeCents,
        oneTimeActivationFeeCents: priced.oneTimeActivationFeeCents,
        setupInstallments: 1,
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
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
      tenant: {
        approvalStatus: "pendente",
        entityType: args.tenant.entityType,
        fullName: args.tenant.fullName,
        cpf: args.tenant.cpf,
        cnpj: args.tenant.cnpj,
        birthDate: args.tenant.birthDate,
        email: args.tenant.email,
        phone: args.tenant.phone,
        score: args.tenant.score,
        termApprovedAt: null,
      },
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
        // TODO: mirror the actual written values when this mutation grows to
        // accept multipliers from args. Today these always equal the defaults
        // written above, so audit and rental stay in lockstep.
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
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

    return { publicId };
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
 * Reshape a Convex `contracts` doc + history into the UI Contract type.
 * Strips system fields (`_id`, `_creationTime`); renames publicId → id.
 */
function shapeContract(doc: Contract, history: ContractHistory[]) {
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
    tenant: doc.tenant,
    history: history.map((h) => ({
      at: h.at,
      username: h.username,
      message: h.message,
    })),
  };
}
