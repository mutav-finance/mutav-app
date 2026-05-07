import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Idempotent dev seed — inserts two fictional imobiliárias, one contract
 * each, contract history for the first, and one payment per agency.
 * Wipes prior copies so re-runs produce a deterministic dataset.
 *
 *     bunx convex run seed:fictionalContract
 *
 * Dev-only. Do NOT call from production.
 */
export const fictionalContract = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Wipe in dependency order: payments → history → contracts → agencies.
    for (const table of ["payments", "contractHistory", "contracts", "agencies"] as const) {
      let rows = await ctx.db.query(table).take(200);
      while (rows.length > 0) {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
        rows = await ctx.db.query(table).take(200);
      }
    }

    const agencyPaulistaId: Id<"agencies"> = await ctx.db.insert("agencies", {
      name: "Imobiliária Paulista",
      cnpj: "00000000000100",
      createdAt: "2026-01-15T00:00:00-03:00",
    });

    const agencyAtlanticaId: Id<"agencies"> = await ctx.db.insert("agencies", {
      name: "Imobiliária Atlântica",
      cnpj: "00000000000200",
      createdAt: "2026-02-01T00:00:00-03:00",
    });

    const PUBLIC_ID_1 = "1000001";
    const PUBLIC_ID_2 = "1000002";

    const contract1Id: Id<"contracts"> = await ctx.db.insert("contracts", {
      agencyId: agencyPaulistaId,
      publicId: PUBLIC_ID_1,
      status: "ativo",
      nextRenewalDate: "2027-08-15",
      availableGuaranteeCents: 9_000_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 320_000,
        condoCents: 45_000,
        otherFeesCents: 0,
        totalRentCents: 365_000,
        feeCents: 512_000,
        oneTimeActivationFeeCents: 20_000,
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
        cpf: "00000000000",
        birthDate: "1990-05-12",
        email: "maria.exemplo@example.com",
        phone: "11900000000",
        termApprovedAt: "2026-04-22T17:36:00-03:00",
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: agencyAtlanticaId,
      publicId: PUBLIC_ID_2,
      status: "pendente",
      nextRenewalDate: "2027-12-01",
      availableGuaranteeCents: 12_000_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 580_000,
        condoCents: 95_000,
        otherFeesCents: 12_000,
        totalRentCents: 687_000,
        feeCents: 928_000,
        oneTimeActivationFeeCents: 30_000,
        setupInstallments: 2,
        exitCostMultiplier: "8x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "22250-040",
        streetAndNumber: "Rua Visconde de Pirajá, 414",
        neighborhood: "Ipanema",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: {
        complement: "Sala 808",
        tag: "comercial-premium",
        description: "Sala comercial em prédio histórico.",
      },
      documents: [
        { key: "rentalContract", status: "enviado" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: "João Pereira Almeida",
        cpf: "00000000001",
        birthDate: "1985-11-30",
        email: "joao.exemplo@example.com",
        phone: "21900000000",
        termApprovedAt: null,
      },
    });

    await ctx.db.insert("contractHistory", {
      agencyId: agencyPaulistaId,
      contractPublicId: PUBLIC_ID_1,
      at: "2026-04-22T10:32:00-03:00",
      username: "usuario.exemplo",
      message:
        "Criada Solicitação #1000001 do tipo residencial, no produto Flex (Custo de saída: 6,00x; Cobertura: 40x; Comissão: 2,00%), com setup de R$ 200,00 e valor de aluguel R$ 3.200,00, valor do condomínio R$ 450,00, valor das taxas R$ 0,00, totalizando R$ 3.650,00. O imóvel está situado no endereço Av. Paulista, 1500, Bela Vista, São Paulo/SP.",
    });

    await ctx.db.insert("contractHistory", {
      agencyId: agencyPaulistaId,
      contractPublicId: PUBLIC_ID_1,
      at: "2026-04-22T17:03:00-03:00",
      username: "usuario.exemplo",
      message:
        "Atualizado status do contrato: 1000001. | Para: Aprovado. | Por usuário: usuario.exemplo",
    });

    await ctx.db.insert("payments", {
      agencyId: agencyPaulistaId,
      publicId: "PAY-2026-04-PAU",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: 532_000,
      status: "paid",
      lineItems: [
        {
          contractId: contract1Id,
          contractPublicId: PUBLIC_ID_1,
          kind: "recurring",
          amountCents: 512_000,
          description: "Mensalidade contrato 1000001",
        },
        {
          contractId: contract1Id,
          contractPublicId: PUBLIC_ID_1,
          kind: "activation",
          amountCents: 20_000,
          description: "Taxa de ativação contrato 1000001",
        },
      ],
      barcode: null,
      paidAt: "2026-04-08T14:21:00-03:00",
    });

    await ctx.db.insert("payments", {
      agencyId: agencyAtlanticaId,
      publicId: "PAY-2026-04-ATL",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: 0,
      status: "pending",
      lineItems: [],
      barcode: null,
      paidAt: null,
    });

    return { agencies: [agencyPaulistaId, agencyAtlanticaId], contracts: [contract1Id] };
  },
});

/** Bulk wipe — admin only. */
export const clearAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of ["payments", "contractHistory", "contracts", "agencies"] as const) {
      let rows = await ctx.db.query(table).take(200);
      while (rows.length > 0) {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
        rows = await ctx.db.query(table).take(200);
      }
    }
    return null;
  },
});
