import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { contractsByStatus } from "./aggregate";
import { contractStatusValidator } from "./domain";

/**
 * Insert a new contract and register it in the aggregate.
 *
 * Exposed as `internalMutation` — public surface (action / HTTP handler)
 * must call this via `ctx.runMutation(internal.contracts.mutations.insert, ...)`.
 *
 * Call manually for dev:
 *   bunx convex run contracts/mutations:insert '{...}'
 */
export const insert = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    publicId: v.string(),
    status: contractStatusValidator,
    activatedAt: v.union(v.string(), v.null()),
    nextRenewalDate: v.string(),
    availableGuaranteeCents: v.number(),
    rental: v.object({
      propertyKind: v.union(v.literal("residencial"), v.literal("comercial")),
      rentCents: v.number(),
      condoCents: v.number(),
      otherFeesCents: v.number(),
      totalRentCents: v.number(),
      feeCents: v.number(),
      oneTimeActivationFeeCents: v.number(),
      setupInstallments: v.number(),
      exitCostMultiplier: v.string(),
      rentMultiplier: v.string(),
      payer: v.string(),
      pviMigrationSchedule: v.union(v.string(), v.null()),
    }),
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
    documents: v.array(
      v.object({
        key: v.union(v.literal("rentalContract"), v.literal("inspection"), v.literal("policy")),
        status: v.union(v.literal("pendente"), v.literal("enviado"), v.literal("aprovado")),
      }),
    ),
    tenant: v.object({
      approvalStatus: v.union(v.literal("aprovado"), v.literal("pendente"), v.literal("reprovado")),
      fullName: v.string(),
      cpf: v.string(),
      birthDate: v.string(),
      email: v.string(),
      phone: v.string(),
      termApprovedAt: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const contractId = await ctx.db.insert("contracts", args);
    const doc = await ctx.db.get(contractId);
    if (!doc) throw new Error("Contract insert failed");

    await contractsByStatus.insert(ctx, doc);

    return contractId;
  },
});

/**
 * Update the status of an existing contract and keep the aggregate in sync.
 *
 * Only the `status` field is changed; all other fields remain untouched.
 */
export const updateStatus = internalMutation({
  args: {
    contractId: v.id("contracts"),
    status: contractStatusValidator,
  },
  handler: async (ctx, { contractId, status }) => {
    const before = await ctx.db.get(contractId);
    if (!before) throw new Error(`Contract ${contractId} not found`);

    if (before.status === status) return; // no-op

    const patch: { status: typeof status; activatedAt?: string; deactivatedAt?: string } = {
      status,
    };
    if (status === "ativo" && before.activatedAt === null) {
      patch.activatedAt = new Date().toISOString();
    }
    if (before.status === "ativo" && status !== "ativo" && !before.deactivatedAt) {
      patch.deactivatedAt = new Date().toISOString();
    }

    await ctx.db.patch(contractId, patch);
    const after = await ctx.db.get(contractId);
    if (!after) throw new Error("Contract disappeared mid-mutation");

    // Replace updates the aggregate: removes the old (namespace, key) entry
    // and inserts the new one atomically.
    await contractsByStatus.replace(ctx, before, after);
  },
});
