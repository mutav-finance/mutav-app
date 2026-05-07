import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Idempotent dev seed — inserts the fictional contract `1000001` plus its
 * two history entries.
 *
 * Registered as `internalMutation`, so it cannot be called from the client
 * over the public API. Invoke from the Convex dashboard or via the CLI:
 *
 *     npx convex run seed:fictionalContract
 *
 * Safe to re-run: each row is keyed by `publicId` / `(contractPublicId, at)`
 * and we delete-then-insert to keep the dataset deterministic across runs.
 *
 * This is dev-only seed data. Do NOT call this from production deployments.
 */
export const fictionalContract = internalMutation({
  args: {},
  handler: async (ctx) => {
    const PUBLIC_ID = "1000001";

    // Delete any prior copy so re-runs produce a deterministic state.
    const existing = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", PUBLIC_ID))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }

    let priorHistory = await ctx.db
      .query("contractHistory")
      .withIndex("by_contract", (q) => q.eq("contractPublicId", PUBLIC_ID))
      .take(100);
    while (priorHistory.length > 0) {
      for (const row of priorHistory) {
        await ctx.db.delete(row._id);
      }
      priorHistory = await ctx.db
        .query("contractHistory")
        .withIndex("by_contract", (q) => q.eq("contractPublicId", PUBLIC_ID))
        .take(100);
    }

    await ctx.db.insert("contracts", {
      publicId: PUBLIC_ID,
      status: "ativo",
      nextRenewalDate: "2027-08-15",
      availableGuaranteeBRL: 90_000,
      rental: {
        propertyKind: "residencial",
        rentBRL: 3_200,
        condoBRL: 450,
        otherFeesBRL: 0,
        totalRentBRL: 3_650,
        feeBRL: 5_120,
        oneTimeActivationFeeBRL: 200,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01310-100",
        streetAndNumber: "Av. Paulista, 1500",
        neighborhood: "Bela Vista",
        cityUF: "São Paulo/SP",
      },
      optional: {
        complement: "Apto 204",
        tag: "",
        description: "",
      },
      documents: [
        { key: "rentalContract", status: "pendente" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Maria Silva Santos",
        cpf: "000.000.000-00",
        birthDate: "1990-05-12",
        email: "maria.exemplo@example.com",
        phone: "(11) 90000-0000",
        termApprovedAt: "2026-04-22T17:36:00-03:00",
      },
    });

    await ctx.db.insert("contractHistory", {
      contractPublicId: PUBLIC_ID,
      at: "2026-04-22T10:32:00-03:00",
      username: "usuario.exemplo",
      message:
        "Criada Solicitação #1000001 do tipo residencial, no produto Flex (Custo de saída: 6,00x; Cobertura: 40x; Comissão: 2,00%), com setup de R$ 200,00 e valor de aluguel R$ 3.200,00, valor do condomínio R$ 450,00, valor das taxas R$ 0,00, totalizando R$ 3.650,00. O imóvel está situado no endereço Av. Paulista, 1500, Bela Vista, São Paulo/SP.",
    });

    await ctx.db.insert("contractHistory", {
      contractPublicId: PUBLIC_ID,
      at: "2026-04-22T17:03:00-03:00",
      username: "usuario.exemplo",
      message:
        "Atualizado status do contrato: 1000001. | Para: Aprovado. | Por usuário: usuario.exemplo",
    });

    return { publicId: PUBLIC_ID };
  },
});

/**
 * Bulk wipe of seeded data — admin only.
 * Useful before re-running `fictionalContract` from a clean slate.
 */
export const clearFictional = internalMutation({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (contract) {
      await ctx.db.delete(contract._id);
    }
    let history = await ctx.db
      .query("contractHistory")
      .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
      .take(100);
    while (history.length > 0) {
      for (const row of history) {
        await ctx.db.delete(row._id);
      }
      history = await ctx.db
        .query("contractHistory")
        .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
        .take(100);
    }
    return null;
  },
});
