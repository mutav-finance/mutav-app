import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";
import { internal } from "../_generated/api";
import { priceContract } from "../../src/lib/pricing/contract";
import type { Contract, ContractHistory } from "./domain";
import { contractsByStatus } from "./aggregate";
import { CONTRACT_STATUS, tierForScore } from "./domain";
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
 * Mock credit-bureau score for a CPF or CNPJ. Pure computation today; the
 * real-bureau call goes here so the swap is single-file. Agency-scoped so
 * future billed lookups can be attributed and rate-limited per agency.
 */
export const lookupTenantScore = queryWithAgencyScope({
  args: { document: v.string() },
  handler: async (_ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    const score = (parseInt(digits.slice(-4), 10) % 601) + 300;
    return { score, tier: tierForScore(score) };
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
    rentMultiplier: v.union(v.literal("24x"), v.literal("36x"), v.literal("48x")),
    exitCostMultiplier: v.union(v.literal("3x"), v.literal("5x"), v.literal("7x")),
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
      rentMultiplier: args.rentMultiplier,
      exitCostMultiplier: args.exitCostMultiplier,
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
        exitCostMultiplier: args.exitCostMultiplier,
        rentMultiplier: args.rentMultiplier,
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
