import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashPii } from "../lib/pii";
import { priceContract } from "../../apps/agency/src/lib/pricing/contract";
import type { Contract, ContractHistory } from "./domain";
import { contractsByStatus } from "./aggregate";
import { CONTRACT_STATUS, tierForScore } from "./domain";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { assertAgencyAccess, mutationWithAgencyScope, queryWithAgencyScope } from "../lib/auth";

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
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    if (!contract) {
      return null;
    }

    try {
      await assertAgencyAccess(ctx, contract.agencyId);
    } catch {
      return null;
    }

    const history = await ctx.db
      .query("contractHistory")
      .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
      .order("desc")
      // Hard cap; if contracts exceed 100 history entries we'll need pagination.
      .take(100);

    return shapeContract(contract, history);
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

/**
 * Real-time pipeline summary for one agency.
 *
 * Returns the count of contracts in each status using the `contractsByStatus`
 * aggregate — O(log n), no full-table scan.
 *
 * Used by `section-cards.tsx` (Painel) to display KPI tiles.
 */
export const getPipelineSummary = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    const statuses = [
      CONTRACT_STATUS.ATIVO,
      CONTRACT_STATUS.PENDENTE,
      CONTRACT_STATUS.ENCERRADO,
      CONTRACT_STATUS.CANCELADO,
    ] as const;

    const counts = await contractsByStatus.countBatch(
      ctx,
      statuses.map((status) => ({
        namespace: ctx.agencyId,
        bounds: {
          lower: { key: status, inclusive: true },
          upper: { key: status, inclusive: true },
        },
      })),
    );

    return {
      ativo: counts[0] ?? 0,
      pendente: counts[1] ?? 0,
      encerrado: counts[2] ?? 0,
      cancelado: counts[3] ?? 0,
    };
  },
});

/** Monthly contract counts for the given agency, up to the last 12 months. */
export const countByMonth = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    // Build the last 12 calendar months as "YYYY-MM" labels
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }

    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId))
      .collect();

    return months.map((month) => {
      let netActive = 0;
      let activated = 0;
      let cancelled = 0;
      let expired = 0;

      for (const c of contracts) {
        // activations this month
        if (c.activatedAt && c.activatedAt.slice(0, 7) === month) activated++;

        // deactivations this month
        if (c.deactivatedAt && c.deactivatedAt.slice(0, 7) === month) {
          if (c.status === "cancelado") cancelled++;
          else if (c.status === "encerrado") expired++;
        }

        // net active snapshot at end of month
        if (!c.activatedAt) continue;
        if (c.activatedAt.slice(0, 7) > month) continue;
        const deactivated = c.deactivatedAt ?? null;
        if (deactivated && deactivated.slice(0, 7) <= month) continue;
        netActive++;
      }

      return { month, netActive, activated, cancelled, expired };
    });
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

/**
 * Reads the most recent credit report for `document` (CPF or CNPJ digits)
 * from the `tenantCreditReports` cache. Returns null if no result exists
 * within the 24-hour TTL — the caller should trigger `requestCreditScore`
 * to schedule a fresh lookup.
 */
export const getCachedCreditScore = queryWithAgencyScope({
  args: { document: v.string() },
  handler: async (ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) return null;

    const docHash = await hashPii(digits);
    const cutoff = Date.now() - CREDIT_CACHE_TTL_MS;

    const report = await ctx.db
      .query("tenantCreditReports")
      .withIndex("by_agency_cpf_time", (q) =>
        q.eq("agencyId", ctx.agencyId).eq("cpfHash", docHash).gt("pulledAt", cutoff),
      )
      .order("desc")
      .first();

    if (!report) return null;
    return { score: report.score, tier: report.tier };
  },
});

/**
 * Ensures a fresh credit score is available for `document`.
 * - If a cached result exists within 24 h, returns `{ status: "cached" }`.
 * - For CNPJ (PJ entities): inserts a mock score synchronously (no bureau API).
 * - For CPF: schedules `fetchCreditScore` action; returns `{ status: "fetching" }`.
 *   The action writes to `tenantCreditReports`, which triggers `getCachedCreditScore`
 *   to update reactively in the wizard UI.
 */
export const requestCreditScore = mutationWithAgencyScope({
  args: { document: v.string() },
  handler: async (ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) {
      return { status: "invalid" } as const;
    }

    const docHash = await hashPii(digits);
    const cutoff = Date.now() - CREDIT_CACHE_TTL_MS;

    const cached = await ctx.db
      .query("tenantCreditReports")
      .withIndex("by_agency_cpf_time", (q) =>
        q.eq("agencyId", ctx.agencyId).eq("cpfHash", docHash).gt("pulledAt", cutoff),
      )
      .order("desc")
      .first();

    if (cached) return { status: "cached" } as const;

    // CNPJ — no bureau API in this milestone; insert deterministic mock inline
    if (digits.length === 14) {
      const score = (parseInt(digits.slice(-4), 10) % 601) + 300;
      await ctx.db.insert("tenantCreditReports", {
        agencyId: ctx.agencyId,
        cpfHash: docHash,
        score,
        tier: tierForScore(score),
        provider: "mock",
        pulledAt: Date.now(),
      });
      return { status: "inserted" } as const;
    }

    // CPF — schedule async action (BigDataCorp or mock based on SCORE_PROVIDER)
    await ctx.scheduler.runAfter(0, internal.contracts.actions.fetchCreditScore, {
      cpf: digits,
      agencyId: ctx.agencyId,
    });
    return { status: "fetching" } as const;
  },
});

/**
 * Persists a resolved credit score from `fetchCreditScore`. Called via
 * `ctx.runMutation` from the internalAction — never called directly by clients.
 */
export const saveCreditReport = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    cpf: v.string(),
    score: v.number(),
    tier: v.union(v.literal("bom"), v.literal("regular"), v.literal("ruim"), v.literal("negado")),
    provider: v.string(),
    providerRef: v.optional(v.string()),
  },
  handler: async (ctx, { agencyId, cpf, score, tier, provider, providerRef }) => {
    const cpfHash = await hashPii(cpf.replace(/\D/g, ""));
    await ctx.db.insert("tenantCreditReports", {
      agencyId,
      cpfHash,
      score,
      tier,
      provider,
      providerRef,
      pulledAt: Date.now(),
    });
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
        exitCostMultiplier: "5x",
        rentMultiplier: "30x",
        payer: "inquilino",
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
    await contractsByStatus.insert(ctx, doc);

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
        rentMultiplier: "30x",
        exitCostMultiplier: "5x",
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
    if (after) await contractsByStatus.replace(ctx, contract, after);

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
