import { internalMutation } from "./_generated/server";
import { PaymentMethods, PaymentStates } from "./payments/domain";
import type { Id } from "./_generated/dataModel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Zero-padded public contract ID, e.g. "1000007" */
const pid = (n: number) => String(1_000_000 + n);

/** ISO date string */
const d = (s: string) => s;

/**
 * Idempotent dev seed — 3 agencies, 30 contracts, contract history, and
 * historical payments covering the last two months.
 *
 * Run with:
 *   bunx convex run seed:fictionalContracts
 *
 * Dev-only. Do NOT call from production.
 */
export const fictionalContracts = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Wipe in dependency order.
    for (const table of ["payments", "contractHistory", "contracts", "agencies"] as const) {
      let rows = await ctx.db.query(table).take(200);
      while (rows.length > 0) {
        for (const row of rows) await ctx.db.delete(row._id);
        rows = await ctx.db.query(table).take(200);
      }
    }

    // ── Agencies ──────────────────────────────────────────────────────────────

    const paulistaId: Id<"agencies"> = await ctx.db.insert("agencies", {
      name: "Imobiliária Paulista",
      cnpj: "00000000000100",
      createdAt: d("2024-03-01T00:00:00-03:00"),
    });

    const atlanticaId: Id<"agencies"> = await ctx.db.insert("agencies", {
      name: "Imobiliária Atlântica",
      cnpj: "00000000000200",
      createdAt: d("2024-06-15T00:00:00-03:00"),
    });

    const horizonteId: Id<"agencies"> = await ctx.db.insert("agencies", {
      name: "Horizonte Imóveis",
      cnpj: "00000000000300",
      createdAt: d("2025-01-10T00:00:00-03:00"),
    });

    // ── Contracts — Imobiliária Paulista (15) ─────────────────────────────────
    // 12 ativo, 2 pendente, 1 encerrado

    const p1 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(1),
      status: "ativo",
      nextRenewalDate: "2027-03-01",
      availableGuaranteeCents: 12_800_000,
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
      optional: { complement: "Apto 204", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Maria Silva Santos",
        cpf: "111.111.111-11",
        birthDate: "1990-05-12",
        email: "maria.silva@example.com",
        phone: "11900000001",
        termApprovedAt: d("2025-03-01T10:00:00-03:00"),
      },
    });

    const p2 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(2),
      status: "ativo",
      nextRenewalDate: "2027-04-01",
      availableGuaranteeCents: 16_000_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 400_000,
        condoCents: 60_000,
        otherFeesCents: 5_000,
        totalRentCents: 465_000,
        feeCents: 640_000,
        oneTimeActivationFeeCents: 25_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01402-000",
        streetAndNumber: "Rua Augusta, 800",
        neighborhood: "Consolação",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 101", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Carlos Eduardo Ferreira",
        cpf: "222.222.222-22",
        birthDate: "1985-08-20",
        email: "carlos.ferreira@example.com",
        phone: "11900000002",
        termApprovedAt: d("2025-04-01T09:30:00-03:00"),
      },
    });

    const p3 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(3),
      status: "ativo",
      nextRenewalDate: "2027-05-15",
      availableGuaranteeCents: 22_000_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 550_000,
        condoCents: 90_000,
        otherFeesCents: 15_000,
        totalRentCents: 655_000,
        feeCents: 880_000,
        oneTimeActivationFeeCents: 35_000,
        setupInstallments: 2,
        exitCostMultiplier: "8x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01310-200",
        streetAndNumber: "Av. Paulista, 900",
        neighborhood: "Bela Vista",
        cityUF: "São Paulo/SP",
      },
      optional: {
        complement: "Sala 305",
        tag: "comercial",
        description: "Escritório para startups.",
      },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Tech Solutions Ltda",
        cpf: "33.333.333/0001-33",
        birthDate: "2010-01-01",
        email: "contato@techsolutions.example.com",
        phone: "11900000003",
        termApprovedAt: d("2025-05-15T14:00:00-03:00"),
      },
    });

    const p4 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(4),
      status: "ativo",
      nextRenewalDate: "2026-11-01",
      availableGuaranteeCents: 9_600_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 240_000,
        condoCents: 30_000,
        otherFeesCents: 0,
        totalRentCents: 270_000,
        feeCents: 384_000,
        oneTimeActivationFeeCents: 15_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "04571-010",
        streetAndNumber: "Av. das Nações Unidas, 12000",
        neighborhood: "Brooklin",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 802", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Ana Paula Rodrigues",
        cpf: "444.444.444-44",
        birthDate: "1993-02-28",
        email: "ana.rodrigues@example.com",
        phone: "11900000004",
        termApprovedAt: d("2024-11-01T11:00:00-03:00"),
      },
    });

    const p5 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(5),
      status: "ativo",
      nextRenewalDate: "2027-01-20",
      availableGuaranteeCents: 28_000_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 700_000,
        condoCents: 120_000,
        otherFeesCents: 20_000,
        totalRentCents: 840_000,
        feeCents: 1_120_000,
        oneTimeActivationFeeCents: 50_000,
        setupInstallments: 3,
        exitCostMultiplier: "10x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "04538-133",
        streetAndNumber: "Rua Funchal, 418",
        neighborhood: "Vila Olímpia",
        cityUF: "São Paulo/SP",
      },
      optional: {
        complement: "Andar 8 completo",
        tag: "premium",
        description: "Laje corporativa.",
      },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Global Finance S.A.",
        cpf: "55.555.555/0001-55",
        birthDate: "1999-07-01",
        email: "financeiro@globalfinance.example.com",
        phone: "11900000005",
        termApprovedAt: d("2025-01-20T09:00:00-03:00"),
      },
    });

    const p6 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(6),
      status: "ativo",
      nextRenewalDate: "2027-02-10",
      availableGuaranteeCents: 11_200_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 280_000,
        condoCents: 40_000,
        otherFeesCents: 0,
        totalRentCents: 320_000,
        feeCents: 448_000,
        oneTimeActivationFeeCents: 18_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "05422-010",
        streetAndNumber: "Rua dos Pinheiros, 330",
        neighborhood: "Pinheiros",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 52", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Bruno Henrique Lima",
        cpf: "666.666.666-66",
        birthDate: "1988-11-15",
        email: "bruno.lima@example.com",
        phone: "11900000006",
        termApprovedAt: d("2025-02-10T15:00:00-03:00"),
      },
    });

    const p7 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(7),
      status: "ativo",
      nextRenewalDate: "2026-09-01",
      availableGuaranteeCents: 7_200_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 180_000,
        condoCents: 25_000,
        otherFeesCents: 0,
        totalRentCents: 205_000,
        feeCents: 288_000,
        oneTimeActivationFeeCents: 12_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "03301-000",
        streetAndNumber: "Av. Radial Leste, 1200",
        neighborhood: "Tatuapé",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 12", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "enviado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Fernanda Costa Oliveira",
        cpf: "777.777.777-77",
        birthDate: "1995-06-03",
        email: "fernanda.oliveira@example.com",
        phone: "11900000007",
        termApprovedAt: d("2024-09-01T10:30:00-03:00"),
      },
    });

    const p8 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(8),
      status: "ativo",
      nextRenewalDate: "2026-08-20",
      availableGuaranteeCents: 14_400_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 360_000,
        condoCents: 55_000,
        otherFeesCents: 8_000,
        totalRentCents: 423_000,
        feeCents: 576_000,
        oneTimeActivationFeeCents: 22_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01423-001",
        streetAndNumber: "Rua Oscar Freire, 500",
        neighborhood: "Jardim Paulista",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Cobertura 1", tag: "premium", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Ricardo Monteiro Braga",
        cpf: "888.888.888-88",
        birthDate: "1980-09-25",
        email: "ricardo.braga@example.com",
        phone: "11900000008",
        termApprovedAt: d("2024-08-20T08:00:00-03:00"),
      },
    });

    const p9 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(9),
      status: "ativo",
      nextRenewalDate: "2027-06-01",
      availableGuaranteeCents: 6_000_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 150_000,
        condoCents: 20_000,
        otherFeesCents: 0,
        totalRentCents: 170_000,
        feeCents: 240_000,
        oneTimeActivationFeeCents: 10_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "02040-000",
        streetAndNumber: "Av. Nova Cantareira, 600",
        neighborhood: "Mandaqui",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 31", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Juliana Nascimento Souza",
        cpf: "999.999.999-99",
        birthDate: "1997-12-08",
        email: "juliana.souza@example.com",
        phone: "11900000009",
        termApprovedAt: d("2025-06-01T16:00:00-03:00"),
      },
    });

    const p10 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(10),
      status: "ativo",
      nextRenewalDate: "2026-12-15",
      availableGuaranteeCents: 19_200_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 480_000,
        condoCents: 80_000,
        otherFeesCents: 10_000,
        totalRentCents: 570_000,
        feeCents: 768_000,
        oneTimeActivationFeeCents: 30_000,
        setupInstallments: 2,
        exitCostMultiplier: "8x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "04547-130",
        streetAndNumber: "Av. Brigadeiro Faria Lima, 3400",
        neighborhood: "Itaim Bibi",
        cityUF: "São Paulo/SP",
      },
      optional: {
        complement: "Sala 1201",
        tag: "comercial-premium",
        description: "Escritório em torre AAA.",
      },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Inovação Digital Ltda",
        cpf: "10.101.010/0001-10",
        birthDate: "2015-03-01",
        email: "admin@inovacaodigital.example.com",
        phone: "11900000010",
        termApprovedAt: d("2024-12-15T13:00:00-03:00"),
      },
    });

    const p11 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(11),
      status: "ativo",
      nextRenewalDate: "2027-07-01",
      availableGuaranteeCents: 8_000_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 200_000,
        condoCents: 28_000,
        otherFeesCents: 0,
        totalRentCents: 228_000,
        feeCents: 320_000,
        oneTimeActivationFeeCents: 14_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "05051-000",
        streetAndNumber: "Av. Queiroz Filho, 1200",
        neighborhood: "Vila Hamburguesa",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 73", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Lucas Andrade Pereira",
        cpf: "11.111.111-11",
        birthDate: "1992-04-17",
        email: "lucas.pereira@example.com",
        phone: "11900000011",
        termApprovedAt: d("2025-07-01T09:00:00-03:00"),
      },
    });

    const p12 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(12),
      status: "ativo",
      nextRenewalDate: "2026-10-01",
      availableGuaranteeCents: 10_400_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 260_000,
        condoCents: 35_000,
        otherFeesCents: 5_000,
        totalRentCents: 300_000,
        feeCents: 416_000,
        oneTimeActivationFeeCents: 16_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "04040-001",
        streetAndNumber: "Rua Domingos de Morais, 2000",
        neighborhood: "Vila Mariana",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 45", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Patrícia Gomes Tavares",
        cpf: "12.121.212-12",
        birthDate: "1991-07-30",
        email: "patricia.tavares@example.com",
        phone: "11900000012",
        termApprovedAt: d("2024-10-01T10:00:00-03:00"),
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(13),
      status: "pendente",
      nextRenewalDate: "2027-08-01",
      availableGuaranteeCents: 13_200_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 330_000,
        condoCents: 50_000,
        otherFeesCents: 0,
        totalRentCents: 380_000,
        feeCents: 528_000,
        oneTimeActivationFeeCents: 20_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01530-001",
        streetAndNumber: "Rua da Consolação, 1500",
        neighborhood: "Consolação",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 88", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "enviado" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: "Roberto Carvalho Neto",
        cpf: "13.131.313-13",
        birthDate: "1987-03-22",
        email: "roberto.neto@example.com",
        phone: "11900000013",
        termApprovedAt: null,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(14),
      status: "pendente",
      nextRenewalDate: "2027-09-01",
      availableGuaranteeCents: 15_600_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 390_000,
        condoCents: 65_000,
        otherFeesCents: 8_000,
        totalRentCents: 463_000,
        feeCents: 624_000,
        oneTimeActivationFeeCents: 28_000,
        setupInstallments: 2,
        exitCostMultiplier: "8x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "04578-000",
        streetAndNumber: "Rua Verbo Divino, 1488",
        neighborhood: "Chácara Santo Antônio",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Sala 402", tag: "comercial", description: "" },
      documents: [
        { key: "rentalContract", status: "pendente" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: "Soluções Web S.A.",
        cpf: "14.141.414/0001-14",
        birthDate: "2018-05-10",
        email: "contato@solucoesweb.example.com",
        phone: "11900000014",
        termApprovedAt: null,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(15),
      status: "encerrado",
      nextRenewalDate: "2025-02-01",
      availableGuaranteeCents: 0,
      rental: {
        propertyKind: "residencial",
        rentCents: 220_000,
        condoCents: 32_000,
        otherFeesCents: 0,
        totalRentCents: 252_000,
        feeCents: 352_000,
        oneTimeActivationFeeCents: 15_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01301-001",
        streetAndNumber: "Av. São João, 300",
        neighborhood: "República",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "Apto 3", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Silvia Menezes Rocha",
        cpf: "15.151.515-15",
        birthDate: "1983-10-05",
        email: "silvia.rocha@example.com",
        phone: "11900000015",
        termApprovedAt: d("2023-02-01T10:00:00-03:00"),
      },
    });

    // ── Contracts — Imobiliária Atlântica (12) ────────────────────────────────
    // 8 ativo, 2 pendente, 1 encerrado, 1 cancelado

    const a1 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(16),
      status: "ativo",
      nextRenewalDate: "2027-03-15",
      availableGuaranteeCents: 23_200_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 580_000,
        condoCents: 95_000,
        otherFeesCents: 12_000,
        totalRentCents: 687_000,
        feeCents: 928_000,
        oneTimeActivationFeeCents: 40_000,
        setupInstallments: 2,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "22250-040",
        streetAndNumber: "Rua Visconde de Pirajá, 414",
        neighborhood: "Ipanema",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Apto 701", tag: "premium", description: "Vista para o mar." },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Mariana Figueiredo Costa",
        cpf: "16.161.616-16",
        birthDate: "1989-01-14",
        email: "mariana.costa@example.com",
        phone: "21900000001",
        termApprovedAt: d("2025-03-15T11:00:00-03:00"),
      },
    });

    const a2 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(17),
      status: "ativo",
      nextRenewalDate: "2027-05-01",
      availableGuaranteeCents: 30_000_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 750_000,
        condoCents: 130_000,
        otherFeesCents: 20_000,
        totalRentCents: 900_000,
        feeCents: 1_200_000,
        oneTimeActivationFeeCents: 60_000,
        setupInstallments: 3,
        exitCostMultiplier: "10x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "20021-290",
        streetAndNumber: "Av. Rio Branco, 156",
        neighborhood: "Centro",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: {
        complement: "Andar 12",
        tag: "comercial-premium",
        description: "Torre corporativa Centro RJ.",
      },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Atlântico Negócios S.A.",
        cpf: "17.171.717/0001-17",
        birthDate: "2005-08-01",
        email: "financeiro@atlanticonegocios.example.com",
        phone: "21900000002",
        termApprovedAt: d("2025-05-01T09:00:00-03:00"),
      },
    });

    const a3 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(18),
      status: "ativo",
      nextRenewalDate: "2026-11-20",
      availableGuaranteeCents: 17_600_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 440_000,
        condoCents: 70_000,
        otherFeesCents: 8_000,
        totalRentCents: 518_000,
        feeCents: 704_000,
        oneTimeActivationFeeCents: 28_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "22411-011",
        streetAndNumber: "Rua Dias Ferreira, 417",
        neighborhood: "Leblon",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Apto 301", tag: "premium", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Eduardo Pinto Bastos",
        cpf: "18.181.818-18",
        birthDate: "1984-07-19",
        email: "eduardo.bastos@example.com",
        phone: "21900000003",
        termApprovedAt: d("2024-11-20T14:00:00-03:00"),
      },
    });

    const a4 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(19),
      status: "ativo",
      nextRenewalDate: "2027-01-10",
      availableGuaranteeCents: 8_800_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 220_000,
        condoCents: 30_000,
        otherFeesCents: 0,
        totalRentCents: 250_000,
        feeCents: 352_000,
        oneTimeActivationFeeCents: 15_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "20551-013",
        streetAndNumber: "Rua Visconde de Santa Isabel, 100",
        neighborhood: "Vila Isabel",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Apto 23", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Tatiana Alves Mendes",
        cpf: "19.191.919-19",
        birthDate: "1996-09-02",
        email: "tatiana.mendes@example.com",
        phone: "21900000004",
        termApprovedAt: d("2025-01-10T10:30:00-03:00"),
      },
    });

    const a5 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(20),
      status: "ativo",
      nextRenewalDate: "2026-08-01",
      availableGuaranteeCents: 26_400_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 660_000,
        condoCents: 110_000,
        otherFeesCents: 18_000,
        totalRentCents: 788_000,
        feeCents: 1_056_000,
        oneTimeActivationFeeCents: 45_000,
        setupInstallments: 3,
        exitCostMultiplier: "10x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "22640-101",
        streetAndNumber: "Av. das Américas, 3434",
        neighborhood: "Barra da Tijuca",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Sala 800", tag: "comercial", description: "Complexo Downtown." },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Construtora Barra S.A.",
        cpf: "20.202.020/0001-20",
        birthDate: "2000-02-01",
        email: "obras@construtorabarra.example.com",
        phone: "21900000005",
        termApprovedAt: d("2024-08-01T08:00:00-03:00"),
      },
    });

    const a6 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(21),
      status: "ativo",
      nextRenewalDate: "2027-04-20",
      availableGuaranteeCents: 12_000_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 300_000,
        condoCents: 42_000,
        otherFeesCents: 5_000,
        totalRentCents: 347_000,
        feeCents: 480_000,
        oneTimeActivationFeeCents: 19_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "20521-180",
        streetAndNumber: "Rua São Francisco Xavier, 524",
        neighborhood: "Maracanã",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Apto 1104", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Gustavo Ribeiro Leal",
        cpf: "21.212.121-21",
        birthDate: "1990-12-11",
        email: "gustavo.leal@example.com",
        phone: "21900000006",
        termApprovedAt: d("2025-04-20T09:30:00-03:00"),
      },
    });

    const a7 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(22),
      status: "ativo",
      nextRenewalDate: "2026-07-15",
      availableGuaranteeCents: 9_200_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 230_000,
        condoCents: 33_000,
        otherFeesCents: 0,
        totalRentCents: 263_000,
        feeCents: 368_000,
        oneTimeActivationFeeCents: 14_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "20240-000",
        streetAndNumber: "Rua Mem de Sá, 90",
        neighborhood: "Lapa",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Apto 2", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Camila Souza Barros",
        cpf: "22.222.222-22",
        birthDate: "1994-05-28",
        email: "camila.barros@example.com",
        phone: "21900000007",
        termApprovedAt: d("2024-07-15T11:00:00-03:00"),
      },
    });

    const a8 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(23),
      status: "ativo",
      nextRenewalDate: "2027-02-28",
      availableGuaranteeCents: 34_000_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 850_000,
        condoCents: 150_000,
        otherFeesCents: 25_000,
        totalRentCents: 1_025_000,
        feeCents: 1_360_000,
        oneTimeActivationFeeCents: 70_000,
        setupInstallments: 4,
        exitCostMultiplier: "12x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "22793-080",
        streetAndNumber: "Av. Ayrton Senna, 2600",
        neighborhood: "Barra da Tijuca",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: {
        complement: "Torre Sul, Andar 15",
        tag: "premium",
        description: "Sede corporativa.",
      },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Petro Energy Ltda",
        cpf: "23.232.323/0001-23",
        birthDate: "1998-11-01",
        email: "corp@petroenergy.example.com",
        phone: "21900000008",
        termApprovedAt: d("2025-02-28T08:00:00-03:00"),
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(24),
      status: "pendente",
      nextRenewalDate: "2027-09-01",
      availableGuaranteeCents: 14_000_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 350_000,
        condoCents: 52_000,
        otherFeesCents: 0,
        totalRentCents: 402_000,
        feeCents: 560_000,
        oneTimeActivationFeeCents: 22_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "22071-900",
        streetAndNumber: "Rua Siqueira Campos, 45",
        neighborhood: "Copacabana",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Apto 601", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "enviado" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: "Diego Mendonça Freitas",
        cpf: "24.242.424-24",
        birthDate: "1993-08-17",
        email: "diego.freitas@example.com",
        phone: "21900000009",
        termApprovedAt: null,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(25),
      status: "pendente",
      nextRenewalDate: "2027-10-01",
      availableGuaranteeCents: 18_000_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 450_000,
        condoCents: 75_000,
        otherFeesCents: 10_000,
        totalRentCents: 535_000,
        feeCents: 720_000,
        oneTimeActivationFeeCents: 32_000,
        setupInstallments: 2,
        exitCostMultiplier: "8x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "20040-020",
        streetAndNumber: "Av. Presidente Vargas, 500",
        neighborhood: "Centro",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Sala 204", tag: "comercial", description: "" },
      documents: [
        { key: "rentalContract", status: "pendente" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: "Logística Carioca Ltda",
        cpf: "25.252.525/0001-25",
        birthDate: "2012-04-01",
        email: "ops@logisticacarioca.example.com",
        phone: "21900000010",
        termApprovedAt: null,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(26),
      status: "encerrado",
      nextRenewalDate: "2024-12-01",
      availableGuaranteeCents: 0,
      rental: {
        propertyKind: "residencial",
        rentCents: 270_000,
        condoCents: 40_000,
        otherFeesCents: 0,
        totalRentCents: 310_000,
        feeCents: 432_000,
        oneTimeActivationFeeCents: 16_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "22421-030",
        streetAndNumber: "Rua Ataulfo de Paiva, 600",
        neighborhood: "Leblon",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Apto 11", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Isabela Torres Viana",
        cpf: "26.262.626-26",
        birthDate: "1986-02-14",
        email: "isabela.viana@example.com",
        phone: "21900000011",
        termApprovedAt: d("2022-12-01T10:00:00-03:00"),
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(27),
      status: "cancelado",
      nextRenewalDate: "2026-06-01",
      availableGuaranteeCents: 0,
      rental: {
        propertyKind: "residencial",
        rentCents: 310_000,
        condoCents: 45_000,
        otherFeesCents: 0,
        totalRentCents: 355_000,
        feeCents: 496_000,
        oneTimeActivationFeeCents: 18_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "20560-120",
        streetAndNumber: "Rua Conde de Bonfim, 300",
        neighborhood: "Tijuca",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: { complement: "Apto 55", tag: "", description: "Cancelado antes da assinatura." },
      documents: [
        { key: "rentalContract", status: "pendente" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "reprovado",
        fullName: "Marcos Vinícius Santos",
        cpf: "27.272.727-27",
        birthDate: "1990-06-20",
        email: "marcos.santos@example.com",
        phone: "21900000012",
        termApprovedAt: null,
      },
    });

    // ── Contracts — Horizonte Imóveis (3) ─────────────────────────────────────
    // 2 ativo, 1 pendente

    const h1 = await ctx.db.insert("contracts", {
      agencyId: horizonteId,
      publicId: pid(28),
      status: "ativo",
      nextRenewalDate: "2027-04-01",
      availableGuaranteeCents: 13_600_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 340_000,
        condoCents: 48_000,
        otherFeesCents: 6_000,
        totalRentCents: 394_000,
        feeCents: 544_000,
        oneTimeActivationFeeCents: 21_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "30112-010",
        streetAndNumber: "Av. Afonso Pena, 2000",
        neighborhood: "Centro",
        cityUF: "Belo Horizonte/MG",
      },
      optional: { complement: "Apto 901", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Renata Campos Drumond",
        cpf: "28.282.828-28",
        birthDate: "1991-03-05",
        email: "renata.drumond@example.com",
        phone: "31900000001",
        termApprovedAt: d("2025-04-01T10:00:00-03:00"),
      },
    });

    const h2 = await ctx.db.insert("contracts", {
      agencyId: horizonteId,
      publicId: pid(29),
      status: "ativo",
      nextRenewalDate: "2026-10-15",
      availableGuaranteeCents: 20_000_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 500_000,
        condoCents: 85_000,
        otherFeesCents: 12_000,
        totalRentCents: 597_000,
        feeCents: 800_000,
        oneTimeActivationFeeCents: 38_000,
        setupInstallments: 2,
        exitCostMultiplier: "8x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "30140-110",
        streetAndNumber: "Rua da Bahia, 1148",
        neighborhood: "Funcionários",
        cityUF: "Belo Horizonte/MG",
      },
      optional: {
        complement: "Sala 601",
        tag: "comercial",
        description: "Escritório em edifício A+",
      },
      documents: [
        { key: "rentalContract", status: "aprovado" },
        { key: "inspection", status: "aprovado" },
        { key: "policy", status: "aprovado" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Mineira Distribuidora Ltda",
        cpf: "29.292.929/0001-29",
        birthDate: "2008-07-20",
        email: "financeiro@mineiradist.example.com",
        phone: "31900000002",
        termApprovedAt: d("2024-10-15T09:00:00-03:00"),
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: horizonteId,
      publicId: pid(30),
      status: "pendente",
      nextRenewalDate: "2027-08-10",
      availableGuaranteeCents: 10_800_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 270_000,
        condoCents: 38_000,
        otherFeesCents: 0,
        totalRentCents: 308_000,
        feeCents: 432_000,
        oneTimeActivationFeeCents: 17_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "30510-010",
        streetAndNumber: "Av. Raja Gabaglia, 3200",
        neighborhood: "Estoril",
        cityUF: "Belo Horizonte/MG",
      },
      optional: { complement: "Apto 62", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "enviado" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: "Felipe Augusto Corrêa",
        cpf: "30.303.030-30",
        birthDate: "1998-01-25",
        email: "felipe.correa@example.com",
        phone: "31900000003",
        termApprovedAt: null,
      },
    });

    // ── Contract history ──────────────────────────────────────────────────────

    await ctx.db.insert("contractHistory", {
      agencyId: paulistaId,
      contractPublicId: pid(1),
      at: d("2025-03-01T09:00:00-03:00"),
      username: "admin.paulista",
      message:
        "Criada Solicitação #1000001 — residencial Bela Vista, inquilino Maria Silva Santos, aluguel R$ 3.200,00.",
    });
    await ctx.db.insert("contractHistory", {
      agencyId: paulistaId,
      contractPublicId: pid(1),
      at: d("2025-03-01T17:00:00-03:00"),
      username: "admin.paulista",
      message: "Contrato 1000001 aprovado e ativado.",
    });

    await ctx.db.insert("contractHistory", {
      agencyId: paulistaId,
      contractPublicId: pid(5),
      at: d("2025-01-20T10:00:00-03:00"),
      username: "admin.paulista",
      message:
        "Criada Solicitação #1000005 — comercial Vila Olímpia, inquilino Global Finance S.A.",
    });
    await ctx.db.insert("contractHistory", {
      agencyId: paulistaId,
      contractPublicId: pid(5),
      at: d("2025-01-21T14:30:00-03:00"),
      username: "admin.paulista",
      message: "Contrato 1000005 aprovado e ativado.",
    });

    await ctx.db.insert("contractHistory", {
      agencyId: atlanticaId,
      contractPublicId: pid(16),
      at: d("2025-03-15T09:00:00-03:00"),
      username: "admin.atlantica",
      message:
        "Criada Solicitação #1000016 — residencial Ipanema, inquilina Mariana Figueiredo Costa.",
    });
    await ctx.db.insert("contractHistory", {
      agencyId: atlanticaId,
      contractPublicId: pid(16),
      at: d("2025-03-16T11:00:00-03:00"),
      username: "admin.atlantica",
      message: "Contrato 1000016 aprovado e ativado.",
    });

    await ctx.db.insert("contractHistory", {
      agencyId: atlanticaId,
      contractPublicId: pid(27),
      at: d("2026-05-01T09:00:00-03:00"),
      username: "admin.atlantica",
      message: "Contrato 1000027 cancelado — inquilino reprovado na análise de crédito.",
    });

    await ctx.db.insert("contractHistory", {
      agencyId: horizonteId,
      contractPublicId: pid(28),
      at: d("2025-04-01T10:00:00-03:00"),
      username: "admin.horizonte",
      message:
        "Criada Solicitação #1000028 — residencial Centro BH, inquilina Renata Campos Drumond.",
    });
    await ctx.db.insert("contractHistory", {
      agencyId: horizonteId,
      contractPublicId: pid(28),
      at: d("2025-04-02T15:00:00-03:00"),
      username: "admin.horizonte",
      message: "Contrato 1000028 aprovado e ativado.",
    });

    // ── Historical payments (last 2 months, Apr + Mar 2026) ───────────────────
    // Paulista: 12 ativo in Apr → paid; Atlântica: 8 ativo → paid; Horizonte: 2 ativo → overdue

    const paulistaActiveApr = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12];
    const paulistaAprLineItems = paulistaActiveApr.map((cid, i) => ({
      contractId: cid,
      contractPublicId: pid(i + 1),
      kind: "recurring" as const,
      amountCents: [
        512_000, 640_000, 880_000, 384_000, 1_120_000, 448_000, 288_000, 576_000, 240_000, 768_000,
        320_000, 416_000,
      ][i]!,
      description: `Mensalidade contrato ${pid(i + 1)}`,
    }));

    await ctx.db.insert("payments", {
      agencyId: paulistaId,
      publicId: "PAY-2026-04-0100",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: paulistaAprLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-04-08T14:21:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: paulistaAprLineItems,
    });

    const atlanticaActiveApr = [a1, a2, a3, a4, a5, a6, a7, a8];
    const atlanticaAprLineItems = atlanticaActiveApr.map((cid, i) => ({
      contractId: cid,
      contractPublicId: pid(i + 16),
      kind: "recurring" as const,
      amountCents: [928_000, 1_200_000, 704_000, 352_000, 1_056_000, 480_000, 368_000, 1_360_000][
        i
      ]!,
      description: `Mensalidade contrato ${pid(i + 16)}`,
    }));

    await ctx.db.insert("payments", {
      agencyId: atlanticaId,
      publicId: "PAY-2026-04-0200",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: atlanticaAprLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-04-09T10:00:00-03:00")),
      method: PaymentMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202404091000abc123",
      ),
      lineItems: atlanticaAprLineItems,
    });

    const horizonteAprLineItems = [h1, h2].map((cid, i) => ({
      contractId: cid,
      contractPublicId: pid(i + 28),
      kind: "recurring" as const,
      amountCents: [544_000, 800_000][i]!,
      description: `Mensalidade contrato ${pid(i + 28)}`,
    }));

    await ctx.db.insert("payments", {
      agencyId: horizonteId,
      publicId: "PAY-2026-04-0300",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: horizonteAprLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.overdue(),
      method: null,
      lineItems: horizonteAprLineItems,
    });

    return {
      agencies: { paulistaId, atlanticaId, horizonteId },
      contractCounts: { paulista: 15, atlantica: 12, horizonte: 3 },
    };
  },
});

/** Bulk wipe — admin only. */
export const clearAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of ["payments", "contractHistory", "contracts", "agencies"] as const) {
      let rows = await ctx.db.query(table).take(200);
      while (rows.length > 0) {
        for (const row of rows) await ctx.db.delete(row._id);
        rows = await ctx.db.query(table).take(200);
      }
    }
    return null;
  },
});
