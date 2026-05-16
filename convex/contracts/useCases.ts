import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Contract, ContractHistory } from "./domain";
import { contractsByStatus } from "./aggregate";
import { CONTRACT_STATUS } from "./domain";

const COVERAGE_MULT: { "24x": number; "36x": number; "48x": number } = {
  "24x": 1.0,
  "36x": 1.05,
  "48x": 1.1,
};
const EXIT_MULT: { "3x": number; "5x": number; "7x": number } = {
  "3x": 1.0,
  "5x": 1.02,
  "7x": 1.05,
};
const RENT_MULT_VALUE: { "24x": number; "36x": number; "48x": number } = {
  "24x": 24,
  "36x": 36,
  "48x": 48,
};

function generatePublicId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "CTR-";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Public read of one contract by its human-facing public id.
 *
 * SECURITY POSTURE (MVP):
 * No identity check today (`auth.config.ts` has empty providers). Replace
 * the body with `await requireIdentity(ctx)` + an agency-scoped ownership
 * check before going to production.
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

    const history = await ctx.db
      .query("contractHistory")
      .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
      .order("desc")
      // Hard cap; if contracts exceed 100 history entries we'll need pagination.
      .take(100);

    return shapeContract(contract, history);
  },
});

/** Public paginated list — same security caveat as `getByPublicId`. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("contracts").order("desc").paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map(shapeContractSummary),
    };
  },
});

/** Paginated list scoped to one agency. */
export const listByAgency = query({
  args: {
    agencyId: v.id("agencies"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", args.agencyId))
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
export const getPipelineSummary = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    const statuses = [
      CONTRACT_STATUS.ATIVO,
      CONTRACT_STATUS.PENDENTE,
      CONTRACT_STATUS.ENCERRADO,
      CONTRACT_STATUS.CANCELADO,
    ] as const;

    const counts = await contractsByStatus.countBatch(
      ctx,
      statuses.map((status) => ({
        namespace: agencyId,
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
export const countByMonth = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    const now = new Date();
    // Build the last 12 calendar months as "YYYY-MM" labels
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }

    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", args.agencyId))
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

/** Lookup tenant name by CPF from existing contracts in this agency. */
// TODO(auth): requireIdentity + getMembership check before exposing tenant PII
export const lookupTenantByCpf = query({
  args: { agencyId: v.id("agencies"), cpf: v.string() },
  handler: async (ctx, { agencyId, cpf }) => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_agency_tenant_cpf", (q) => q.eq("agencyId", agencyId).eq("tenantCpf", cpf))
      .first();
    if (!contract) return null;
    return { fullName: contract.tenant.fullName, email: contract.tenant.email };
  },
});

/** Create a new contract with server-side fee calculation. */
// TODO(auth): requireIdentity + getMembership check before writing to any agencyId
export const create = mutation({
  args: {
    agencyId: v.id("agencies"),
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
    const totalRentCents = args.rentCents + args.condoCents + args.otherFeesCents;
    const feeRate = args.tenant.score >= 800 ? 0.075 : args.tenant.score >= 600 ? 0.1 : 0.125;
    const feeCents = Math.round(
      args.rentCents *
        feeRate *
        COVERAGE_MULT[args.rentMultiplier] *
        EXIT_MULT[args.exitCostMultiplier],
    );
    const oneTimeActivationFeeCents = 15_000;
    const availableGuaranteeCents = args.rentCents * RENT_MULT_VALUE[args.rentMultiplier];

    const publicId = generatePublicId();
    const today = new Date();
    const nextRenewalDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10);

    const contractId = await ctx.db.insert("contracts", {
      agencyId: args.agencyId,
      publicId,
      tenantCpf: args.tenant.cpf,
      status: "pendente",
      activatedAt: null,
      nextRenewalDate,
      availableGuaranteeCents,
      rental: {
        propertyKind: args.propertyKind,
        rentCents: args.rentCents,
        condoCents: args.condoCents,
        otherFeesCents: args.otherFeesCents,
        totalRentCents,
        feeCents,
        oneTimeActivationFeeCents,
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
      agencyId: args.agencyId,
      contractPublicId: publicId,
      at: new Date().toISOString(),
      username: "Sistema",
      message: "Contrato criado",
    });

    await ctx.scheduler.runAfter(0, internal.contracts.actions.sendProposalNotifications, {
      publicId,
      tenantName: args.tenant.fullName,
      tenantEmail: args.tenant.email,
      tenantPhone: args.tenant.phone,
      rentCents: args.rentCents,
      availableGuaranteeCents,
      feeCents,
    });

    return { publicId };
  },
});

/** Permanently deletes a pending contract and its history. */
export const deleteProposal = mutation({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    if (!contract) return;
    if (contract.status !== "pendente") throw new Error("Only pending proposals can be deleted");

    const history = await ctx.db
      .query("contractHistory")
      .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
      .collect();

    await Promise.all(history.map((h) => ctx.db.delete(h._id)));
    await ctx.db.delete(contract._id);
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
