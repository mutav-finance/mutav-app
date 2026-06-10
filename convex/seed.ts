import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { PAYMENT_LINE_ITEM_KIND, PaymentMethods, PaymentStates } from "./payments/domain";
import { generatePaymentMuxedId } from "./payments/lib/muxedId";
import type { AgencyId } from "./agencies/domain";
import {
  DEFAULT_EXIT_COST_MULTIPLIER,
  DEFAULT_PAYER,
  DEFAULT_RENT_MULTIPLIER,
  type ContractId,
} from "./contracts/domain";
import {
  ativoInsuredCentsPlatform,
  contractsByStatus,
  contractsByStatusPlatform,
} from "./contracts/aggregate";
import { insertContractAggregates } from "./contracts/aggregateWrites";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Zero-padded public contract ID, e.g. "1000007" */
const pid = (n: number) => String(1_000_000 + n);

/** ISO date string */
const d = (s: string) => s;

/**
 * Demo tables wiped by `clearAll` and `seedPreview`. Order matters —
 * tables with foreign-key-like references come first so we don't leave
 * dangling pointers mid-wipe.
 */
const DEMO_TABLES = [
  "payments",
  "contractHistory",
  "contracts",
  "memberships",
  "users",
  "agencies",
] as const;

async function wipeDemoTables(ctx: MutationCtx) {
  for (const table of DEMO_TABLES) {
    let rows = await ctx.db.query(table).take(200);
    while (rows.length > 0) {
      for (const row of rows) await ctx.db.delete(row._id);
      rows = await ctx.db.query(table).take(200);
    }
  }
}

/**
 * Additive dev seed — inserts 3 agencies, 30 contracts, contract history,
 * and historical payments covering the last two months. Does NOT wipe
 * existing rows; call `clearAll` first if you need a clean slate, or use
 * `seedPreview` for the standard wipe-then-seed flow.
 *
 * Optional `adminEmail` provisions a user row with that email and grants
 * it owner/admin/member memberships across the three seeded agencies. On
 * the developer's first Auth0 login with that email, the existing row
 * gets its `subject` patched (see `getOrCreateByIdentity`) so the
 * developer inherits the seeded memberships without re-onboarding.
 *
 * Run with:
 *   bunx convex run seed:seedFictional
 *   bunx convex run seed:seedFictional '{"adminEmail":"you@example.com"}'
 *
 * Dev-only. Do NOT call from production.
 */
export const seedFictional = internalMutation({
  args: { adminEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // ── Agencies ──────────────────────────────────────────────────────────────

    const paulistaId: AgencyId = await ctx.db.insert("agencies", {
      name: "Imobiliária Paulista",
      cnpj: "00000000000100",
      createdAt: d("2024-03-01T00:00:00-03:00"),
    });

    const atlanticaId: AgencyId = await ctx.db.insert("agencies", {
      name: "Imobiliária Atlântica",
      cnpj: "00000000000200",
      createdAt: d("2024-06-15T00:00:00-03:00"),
    });

    const horizonteId: AgencyId = await ctx.db.insert("agencies", {
      name: "Horizonte Imóveis",
      cnpj: "00000000000300",
      createdAt: d("2025-01-10T00:00:00-03:00"),
    });

    // ── Users ──────────────────────────────────────────────────────────────────

    const adminUserId = args.adminEmail
      ? await ctx.db.insert("users", {
          publicId: `user-seed-${Date.now().toString(36)}`,
          name: "Seed Admin",
          email: args.adminEmail,
          createdAt: d("2024-01-01T00:00:00-03:00"),
        })
      : null;

    const paulistaOwnerId = await ctx.db.insert("users", {
      publicId: "admin-paulista",
      name: "Admin Paulista",
      email: "admin@paulista.example.com",
      createdAt: d("2024-03-01T00:00:00-03:00"),
    });

    const atlanticaOwnerId = await ctx.db.insert("users", {
      publicId: "admin-atlantica",
      name: "Admin Atlântica",
      email: "admin@atlantica.example.com",
      createdAt: d("2024-06-15T00:00:00-03:00"),
    });

    const horizonteOwnerId = await ctx.db.insert("users", {
      publicId: "admin-horizonte",
      name: "Admin Horizonte",
      email: "admin@horizonte.example.com",
      createdAt: d("2025-01-10T00:00:00-03:00"),
    });

    // ── Memberships ───────────────────────────────────────────────────────────

    if (adminUserId) {
      // Seed admin gets the full workspace-switcher experience: owner of
      // Paulista, admin of Atlântica, member of Horizonte.
      await ctx.db.insert("memberships", {
        userId: adminUserId,
        agencyId: paulistaId,
        role: "owner",
        joinedAt: d("2024-03-01T00:00:00-03:00"),
      });
      await ctx.db.insert("memberships", {
        userId: adminUserId,
        agencyId: atlanticaId,
        role: "admin",
        joinedAt: d("2024-06-15T00:00:00-03:00"),
      });
      await ctx.db.insert("memberships", {
        userId: adminUserId,
        agencyId: horizonteId,
        role: "member",
        joinedAt: d("2025-01-10T00:00:00-03:00"),
      });
    }

    // Each agency owner is owner of their own agency only
    await ctx.db.insert("memberships", {
      userId: paulistaOwnerId,
      agencyId: paulistaId,
      role: "owner",
      joinedAt: d("2024-03-01T00:00:00-03:00"),
    });
    await ctx.db.insert("memberships", {
      userId: atlanticaOwnerId,
      agencyId: atlanticaId,
      role: "owner",
      joinedAt: d("2024-06-15T00:00:00-03:00"),
    });
    await ctx.db.insert("memberships", {
      userId: horizonteOwnerId,
      agencyId: horizonteId,
      role: "owner",
      joinedAt: d("2025-01-10T00:00:00-03:00"),
    });

    // ── Contracts — Imobiliária Paulista (15) ─────────────────────────────────    // 12 ativo, 2 pendente, 1 encerrado

    const p1 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(1),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 750,
      },
    });

    const p2 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(2),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 780,
      },
    });

    const p3 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(3),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 650,
      },
    });

    const p4 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(4),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 720,
      },
    });

    const p5 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(5),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 800,
      },
    });

    const p6 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(6),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 670,
      },
    });

    const p7 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(7),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 760,
      },
    });

    const p8 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(8),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 720,
      },
    });

    const p9 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(9),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 690,
      },
    });

    const p10 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(10),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 580,
      },
    });

    const p11 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(11),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 750,
      },
    });

    const p12 = await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(12),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 710,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(13),
      status: "pendente",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 550,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(14),
      status: "pendente",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 490,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: paulistaId,
      publicId: pid(15),
      status: "encerrado",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 680,
      },
    });

    // ── Contracts — Imobiliária Atlântica (12) ────────────────────────────────
    // 8 ativo, 2 pendente, 1 encerrado, 1 cancelado

    const a1 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(16),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 760,
      },
    });

    const a2 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(17),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 710,
      },
    });

    const a3 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(18),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 730,
      },
    });

    const a4 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(19),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 790,
      },
    });

    const a5 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(20),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 640,
      },
    });

    const a6 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(21),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 710,
      },
    });

    const a7 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(22),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 750,
      },
    });

    const a8 = await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(23),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 800,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(24),
      status: "pendente",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 520,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(25),
      status: "pendente",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 480,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(26),
      status: "encerrado",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 700,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: atlanticaId,
      publicId: pid(27),
      status: "cancelado",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 420,
      },
    });

    // ── Contracts — Horizonte Imóveis (3) ─────────────────────────────────────
    // 2 ativo, 1 pendente

    const h1 = await ctx.db.insert("contracts", {
      agencyId: horizonteId,
      publicId: pid(28),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 760,
      },
    });

    const h2 = await ctx.db.insert("contracts", {
      agencyId: horizonteId,
      publicId: pid(29),
      status: "ativo",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 620,
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: horizonteId,
      publicId: pid(30),
      status: "pendente",
      activatedAt: null,
      deactivatedAt: null,
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
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
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
        score: 540,
      },
    });

    // Seeded contract dates spread across recent windows for transparency dashboard demo data
    const activationMap: Record<string, string> = {
      [pid(1)]: "2025-06-03",
      [pid(2)]: "2025-07-08",
      [pid(3)]: "2025-08-12",
      [pid(4)]: "2025-09-05",
      [pid(15)]: "2024-08-01",
      [pid(16)]: "2025-06-15",
      [pid(17)]: "2025-07-22",
      [pid(26)]: "2024-06-15",
      [pid(28)]: "2025-08-01",
      [pid(20)]: "2025-12-15",
      [pid(7)]: "2025-12-28",
      [pid(6)]: "2026-01-10",
      [pid(19)]: "2026-01-20",
      [pid(29)]: "2026-02-05",
      [pid(5)]: "2026-02-22",
      [pid(18)]: "2026-03-05",
      [pid(11)]: "2026-03-15",
      [pid(10)]: "2026-03-25",
      [pid(21)]: "2026-04-02",
      [pid(9)]: "2026-04-18",
      [pid(8)]: "2026-05-05",
      [pid(12)]: "2026-05-15",
      [pid(23)]: "2026-05-22",
      [pid(22)]: "2026-06-03",
    };
    for (const [publicId, activatedAt] of Object.entries(activationMap)) {
      const contract = await ctx.db
        .query("contracts")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique();
      if (contract) await ctx.db.patch(contract._id, { activatedAt });
    }

    // ── Assign historical deactivatedAt dates ────────────────────────────────
    // Only contracts that were once ativo and are now encerrado need this.
    // pid(27) is cancelado but was never activated → no deactivatedAt.
    const deactivationMap: Record<string, string> = {
      [pid(15)]: "2025-03-10", // Paulista encerrado — active ~7 months
      [pid(26)]: "2025-01-20", // Atlântica encerrado — active ~7 months
    };
    for (const [publicId, deactivatedAt] of Object.entries(deactivationMap)) {
      const contract = await ctx.db
        .query("contracts")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .unique();
      if (contract) await ctx.db.patch(contract._id, { deactivatedAt });
    }

    // ── Sync aggregates ───────────────────────────────────────────────────────
    // Wipe above deleted all rows, but the aggregate B-trees are separate and
    // may have stale entries from a prior run. Clear all three then re-insert
    // through the central helper so they stay in lockstep.
    for (const agencyId of [paulistaId, atlanticaId, horizonteId]) {
      await contractsByStatus.clear(ctx, { namespace: agencyId });
    }
    await contractsByStatusPlatform.clear(ctx);
    await ativoInsuredCentsPlatform.clear(ctx);
    {
      const allContracts = await ctx.db.query("contracts").collect();
      for (const doc of allContracts) {
        await insertContractAggregates(ctx, doc);
      }
    }

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

    // ── Historical payments (6 months: Nov 2025 – Apr 2026) ──────────────────
    // Paulista & Atlântica: all paid. Horizonte: paid Nov–Jan, overdue Feb–Apr.

    // Helper to build line items for Paulista (12 ativo contracts)
    const paulistaLineItems = (month: string) =>
      [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12].map((cid, i) => ({
        contractId: cid,
        contractPublicId: pid(i + 1),
        kind: "recurring" as const,
        amountCents: [
          512_000, 640_000, 880_000, 384_000, 1_120_000, 448_000, 288_000, 576_000, 240_000,
          768_000, 320_000, 416_000,
        ][i]!,
        description: `Mensalidade contrato ${pid(i + 1)} — ${month}`,
      }));

    // Helper to build line items for Atlântica (8 ativo contracts)
    const atlanticaLineItems = (month: string) =>
      [a1, a2, a3, a4, a5, a6, a7, a8].map((cid, i) => ({
        contractId: cid,
        contractPublicId: pid(i + 16),
        kind: "recurring" as const,
        amountCents: [928_000, 1_200_000, 704_000, 352_000, 1_056_000, 480_000, 368_000, 1_360_000][
          i
        ]!,
        description: `Mensalidade contrato ${pid(i + 16)} — ${month}`,
      }));

    // Helper to build line items for Horizonte (2 ativo contracts)
    const horizonteLineItems = (month: string) =>
      [h1, h2].map((cid, i) => ({
        contractId: cid,
        contractPublicId: pid(i + 28),
        kind: "recurring" as const,
        amountCents: [544_000, 800_000][i]!,
        description: `Mensalidade contrato ${pid(i + 28)} — ${month}`,
      }));

    // ── Nov 2025 ──────────────────────────────────────────────────────────────

    const p2025Nov = paulistaLineItems("2025-11");
    await ctx.db.insert("payments", {
      agencyId: paulistaId,
      publicId: "PAY-2025-11-0100",
      periodMonth: "2025-11",
      issuedAt: "2025-11-01",
      dueDate: "2025-11-10",
      totalCents: p2025Nov.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2025-11-07T10:00:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: p2025Nov,
    });

    const a2025Nov = atlanticaLineItems("2025-11");
    await ctx.db.insert("payments", {
      agencyId: atlanticaId,
      publicId: "PAY-2025-11-0200",
      periodMonth: "2025-11",
      issuedAt: "2025-11-01",
      dueDate: "2025-11-10",
      totalCents: a2025Nov.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2025-11-08T11:00:00-03:00")),
      method: PaymentMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202511081100abc001",
      ),
      muxedId: generatePaymentMuxedId(),
      lineItems: a2025Nov,
    });

    const h2025Nov = horizonteLineItems("2025-11");
    await ctx.db.insert("payments", {
      agencyId: horizonteId,
      publicId: "PAY-2025-11-0300",
      periodMonth: "2025-11",
      issuedAt: "2025-11-01",
      dueDate: "2025-11-10",
      totalCents: h2025Nov.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2025-11-09T09:30:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: h2025Nov,
    });

    // ── Dec 2025 ──────────────────────────────────────────────────────────────

    const p2025Dec = paulistaLineItems("2025-12");
    await ctx.db.insert("payments", {
      agencyId: paulistaId,
      publicId: "PAY-2025-12-0100",
      periodMonth: "2025-12",
      issuedAt: "2025-12-01",
      dueDate: "2025-12-10",
      totalCents: p2025Dec.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2025-12-05T14:00:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: p2025Dec,
    });

    const a2025Dec = atlanticaLineItems("2025-12");
    await ctx.db.insert("payments", {
      agencyId: atlanticaId,
      publicId: "PAY-2025-12-0200",
      periodMonth: "2025-12",
      issuedAt: "2025-12-01",
      dueDate: "2025-12-10",
      totalCents: a2025Dec.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2025-12-08T10:00:00-03:00")),
      method: PaymentMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202512081000abc002",
      ),
      muxedId: generatePaymentMuxedId(),
      lineItems: a2025Dec,
    });

    const h2025Dec = horizonteLineItems("2025-12");
    await ctx.db.insert("payments", {
      agencyId: horizonteId,
      publicId: "PAY-2025-12-0300",
      periodMonth: "2025-12",
      issuedAt: "2025-12-01",
      dueDate: "2025-12-10",
      totalCents: h2025Dec.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2025-12-09T09:00:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: h2025Dec,
    });

    // ── Jan 2026 ──────────────────────────────────────────────────────────────

    const p2026Jan = paulistaLineItems("2026-01");
    await ctx.db.insert("payments", {
      agencyId: paulistaId,
      publicId: "PAY-2026-01-0100",
      periodMonth: "2026-01",
      issuedAt: "2026-01-02",
      dueDate: "2026-01-12",
      totalCents: p2026Jan.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-01-10T11:00:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: p2026Jan,
    });

    const a2026Jan = atlanticaLineItems("2026-01");
    await ctx.db.insert("payments", {
      agencyId: atlanticaId,
      publicId: "PAY-2026-01-0200",
      periodMonth: "2026-01",
      issuedAt: "2026-01-02",
      dueDate: "2026-01-12",
      totalCents: a2026Jan.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-01-09T15:00:00-03:00")),
      method: PaymentMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202601091500abc003",
      ),
      muxedId: generatePaymentMuxedId(),
      lineItems: a2026Jan,
    });

    const h2026Jan = horizonteLineItems("2026-01");
    await ctx.db.insert("payments", {
      agencyId: horizonteId,
      publicId: "PAY-2026-01-0300",
      periodMonth: "2026-01",
      issuedAt: "2026-01-02",
      dueDate: "2026-01-12",
      totalCents: h2026Jan.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-01-11T10:00:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: h2026Jan,
    });

    // ── Feb 2026 ──────────────────────────────────────────────────────────────

    const p2026Feb = paulistaLineItems("2026-02");
    await ctx.db.insert("payments", {
      agencyId: paulistaId,
      publicId: "PAY-2026-02-0100",
      periodMonth: "2026-02",
      issuedAt: "2026-02-02",
      dueDate: "2026-02-10",
      totalCents: p2026Feb.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-02-07T09:00:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: p2026Feb,
    });

    const a2026Feb = atlanticaLineItems("2026-02");
    await ctx.db.insert("payments", {
      agencyId: atlanticaId,
      publicId: "PAY-2026-02-0200",
      periodMonth: "2026-02",
      issuedAt: "2026-02-02",
      dueDate: "2026-02-10",
      totalCents: a2026Feb.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-02-09T14:00:00-03:00")),
      method: PaymentMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202602091400abc004",
      ),
      muxedId: generatePaymentMuxedId(),
      lineItems: a2026Feb,
    });

    const h2026Feb = horizonteLineItems("2026-02");
    await ctx.db.insert("payments", {
      agencyId: horizonteId,
      publicId: "PAY-2026-02-0300",
      periodMonth: "2026-02",
      issuedAt: "2026-02-02",
      dueDate: "2026-02-10",
      totalCents: h2026Feb.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.overdue(),
      method: null,
      muxedId: generatePaymentMuxedId(),
      lineItems: h2026Feb,
    });

    // ── Mar 2026 ──────────────────────────────────────────────────────────────

    const p2026Mar = paulistaLineItems("2026-03");
    await ctx.db.insert("payments", {
      agencyId: paulistaId,
      publicId: "PAY-2026-03-0100",
      periodMonth: "2026-03",
      issuedAt: "2026-03-02",
      dueDate: "2026-03-10",
      totalCents: p2026Mar.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-03-08T10:30:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: p2026Mar,
    });

    const a2026Mar = atlanticaLineItems("2026-03");
    await ctx.db.insert("payments", {
      agencyId: atlanticaId,
      publicId: "PAY-2026-03-0200",
      periodMonth: "2026-03",
      issuedAt: "2026-03-02",
      dueDate: "2026-03-10",
      totalCents: a2026Mar.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-03-09T11:00:00-03:00")),
      method: PaymentMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202603091100abc005",
      ),
      muxedId: generatePaymentMuxedId(),
      lineItems: a2026Mar,
    });

    const h2026Mar = horizonteLineItems("2026-03");
    await ctx.db.insert("payments", {
      agencyId: horizonteId,
      publicId: "PAY-2026-03-0300",
      periodMonth: "2026-03",
      issuedAt: "2026-03-02",
      dueDate: "2026-03-10",
      totalCents: h2026Mar.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.overdue(),
      method: null,
      muxedId: generatePaymentMuxedId(),
      lineItems: h2026Mar,
    });

    // ── Apr 2026 ──────────────────────────────────────────────────────────────
    // ── Apr 2026 ──────────────────────────────────────────────────────────────

    const paulistaAprLineItems = paulistaLineItems("2026-04");
    await ctx.db.insert("payments", {
      agencyId: paulistaId,
      publicId: "PAY-2026-04-0100",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: paulistaAprLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.paid(d("2026-04-08T14:21:00-03:00")),
      method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      muxedId: generatePaymentMuxedId(),
      lineItems: paulistaAprLineItems,
    });

    const atlanticaAprLineItems = atlanticaLineItems("2026-04");
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
      muxedId: generatePaymentMuxedId(),
      lineItems: atlanticaAprLineItems,
    });

    const horizonteAprLineItems = horizonteLineItems("2026-04");
    await ctx.db.insert("payments", {
      agencyId: horizonteId,
      publicId: "PAY-2026-04-0300",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: horizonteAprLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.overdue(),
      method: null,
      muxedId: generatePaymentMuxedId(),
      lineItems: horizonteAprLineItems,
    });

    const paulistaMayLineItems = paulistaLineItems("2026-05");
    await ctx.db.insert("payments", {
      agencyId: paulistaId,
      publicId: "PAY-2026-05-0100",
      periodMonth: "2026-05",
      issuedAt: "2026-05-01",
      dueDate: "2026-05-10",
      totalCents: paulistaMayLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.pending(),
      method: null,
      muxedId: generatePaymentMuxedId(),
      lineItems: paulistaMayLineItems,
    });

    const atlanticaMayLineItems = atlanticaLineItems("2026-05");
    await ctx.db.insert("payments", {
      agencyId: atlanticaId,
      publicId: "PAY-2026-05-0200",
      periodMonth: "2026-05",
      issuedAt: "2026-05-01",
      dueDate: "2026-05-10",
      totalCents: atlanticaMayLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.pending(),
      method: null,
      muxedId: generatePaymentMuxedId(),
      lineItems: atlanticaMayLineItems,
    });

    const horizonteMayLineItems = horizonteLineItems("2026-05");
    await ctx.db.insert("payments", {
      agencyId: horizonteId,
      publicId: "PAY-2026-05-0300",
      periodMonth: "2026-05",
      issuedAt: "2026-05-01",
      dueDate: "2026-05-10",
      totalCents: horizonteMayLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: PaymentStates.pending(),
      method: null,
      muxedId: generatePaymentMuxedId(),
      lineItems: horizonteMayLineItems,
    });

    // ── Testnet-sized invoices ────────────────────────────────────────────────
    // Tiny amounts so a friendbot-funded sender (10k XLM) can complete a
    // real on-chain test against the Mutav treasury. One per agency.

    // Testnet-sized invoices in the testanchor USDC deposit range
    // (1 ≤ USDC ≤ 10 at 5.0 BRL/USDC ⇒ R$5 to R$50). All three agencies
    // get a spread of amounts so any agency can be selected and any
    // anchor method (Pix sep-6 / AnchorTest sep-24) will pass validation.
    const testAgencies: ReadonlyArray<{
      agencyId: AgencyId;
      contractId: ContractId;
      contractPublicId: string;
    }> = [
      { agencyId: paulistaId, contractId: p1, contractPublicId: pid(1) },
      { agencyId: atlanticaId, contractId: a1, contractPublicId: pid(16) },
      { agencyId: horizonteId, contractId: h1, contractPublicId: pid(28) },
    ];

    // 12 amounts in the safe band (R$5–R$50), four per agency.
    const testAmountsCents = [500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 4750, 5000];

    const testInvoices = testAmountsCents.map((amountCents, idx) => {
      const agency = testAgencies[idx % testAgencies.length];
      const n = String(idx + 1).padStart(3, "0");
      return {
        publicId: `PAY-TEST-${n}`,
        agencyId: agency.agencyId,
        contractId: agency.contractId,
        contractPublicId: agency.contractPublicId,
        amountCents,
      };
    });

    for (const t of testInvoices) {
      await ctx.db.insert("payments", {
        agencyId: t.agencyId,
        publicId: t.publicId,
        periodMonth: "2026-05",
        issuedAt: "2026-05-13",
        dueDate: "2026-05-20",
        totalCents: t.amountCents,
        state: PaymentStates.pending(),
        method: null,
        muxedId: generatePaymentMuxedId(),
        lineItems: [
          {
            contractId: t.contractId,
            contractPublicId: t.contractPublicId,
            kind: PAYMENT_LINE_ITEM_KIND.RECURRING,
            amountCents: t.amountCents,
            description: `Testnet invoice — ${t.publicId}`,
          },
        ],
      });
    }

    return {
      agencies: { paulistaId, atlanticaId, horizonteId },
      contractCounts: { paulista: 15, atlantica: 12, horizonte: 3 },
    };
  },
});

/**
 * Test personas — see `docs/test-personas.md`. Source of truth for the
 * Auth0 subject ↔ Convex user binding so seeds attach state to the
 * exact same identity the JWT will resolve to (no email-link dance).
 */
type PersonaKey = "systemadmin" | "agencyowner" | "pendinguser" | "newuser";

const PERSONAS: Record<
  PersonaKey,
  {
    email: string;
    subject: string;
    name: string;
    isStaff?: boolean;
    agency: { name: string; cnpj: string; state: "active" | "under_review" } | null;
  }
> = {
  systemadmin: {
    email: "systemadmin@mutav.finance",
    subject: "auth0|6a150df6a100fbf318f393c0",
    name: "Mutav Team",
    isStaff: true,
    agency: null,
  },
  agencyowner: {
    email: "agencyowner@mutav.finance",
    subject: "auth0|6a150df7def07da7a5297480",
    name: "Agency Owner",
    agency: { name: "Imobiliária Aprovada", cnpj: "00000000000500", state: "active" },
  },
  pendinguser: {
    email: "pendinguser@mutav.finance",
    subject: "auth0|6a150df8d2051b0ac866a3b6",
    name: "Pending User",
    agency: { name: "Imobiliária Pendente", cnpj: "00000000000400", state: "under_review" },
  },
  newuser: {
    email: "newuser@mutav.finance",
    subject: "auth0|6a150df9a100fbf318f393c3",
    name: "New User",
    agency: null,
  },
};

/**
 * Idempotent persona seed: looks up the user by Auth0 subject (the
 * source of truth post-Auth0), then by email as a fallback, creates if
 * missing, and attaches the seeded agency if the persona declares one.
 * Skips agency creation when a membership already exists for this user
 * in an agency of the same intended state — keeps re-runs no-op.
 */
async function seedPersona(ctx: import("./_generated/server").MutationCtx, key: PersonaKey) {
  const persona = PERSONAS[key];
  const now = new Date().toISOString();

  const bySubject = await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", persona.subject))
    .unique();
  const byEmail =
    bySubject ??
    (await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", persona.email))
      .unique());

  let userId;
  if (byEmail) {
    userId = byEmail._id;
    const patch: { subject?: string; isStaff?: boolean } = {};
    if (!byEmail.subject) patch.subject = persona.subject;
    if (persona.isStaff && !byEmail.isStaff) patch.isStaff = true;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(userId, patch);
    }
  } else {
    userId = await ctx.db.insert("users", {
      publicId: `user-persona-${key}`,
      subject: persona.subject,
      name: persona.name,
      email: persona.email,
      createdAt: now,
      isStaff: persona.isStaff,
    });
  }

  if (!persona.agency) {
    return { persona: key, userId, agencyId: null };
  }

  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const m of memberships) {
    const agency = await ctx.db.get(m.agencyId);
    if (agency?.onboardingState === persona.agency.state) {
      return { persona: key, userId, agencyId: m.agencyId, skipped: true };
    }
  }

  const agencyId = await ctx.db.insert("agencies", {
    name: persona.agency.name,
    cnpj: persona.agency.cnpj,
    agencyType: "empresa",
    onboardingState: persona.agency.state,
    onboardingSubmittedAt: now,
    email: persona.email,
    phone: "11999999999",
    creci: "CRECI-J 99999",
    createdAt: now,
  });
  await ctx.db.insert("memberships", {
    userId,
    agencyId,
    role: "owner",
    joinedAt: now,
  });
  return { persona: key, userId, agencyId };
}

export const seedTestPersonas = internalMutation({
  args: {},
  handler: async (ctx) => {
    const results = [];
    for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
      results.push(await seedPersona(ctx, key));
    }
    return results;
  },
});

/** Bulk wipe — admin only. */
export const clearAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    await wipeDemoTables(ctx);
    return null;
  },
});

type SeedFictionalResult = {
  agencies: { paulistaId: AgencyId; atlanticaId: AgencyId; horizonteId: AgencyId };
  contractCounts: { paulista: number; atlantica: number; horizonte: number };
};

type SeedPersonasResult = Array<{
  persona: PersonaKey;
  userId: import("./_generated/dataModel").Id<"users">;
  agencyId: AgencyId | null;
  skipped?: boolean;
}>;

/**
 * Populate the `agencyowner` persona's agency ("Imobiliária Aprovada")
 * with a believable dashboard: 4 ativo + 1 pendente + 1 encerrado
 * contracts, two months of paid history, one month due. Distinct
 * `publicId` range (1000031–1000036) so it doesn't collide with the
 * fictional Paulista/Atlântica/Horizonte ids.
 *
 * Idempotent — if a contract in the seeded range already exists for
 * this agency, the function is a no-op. Lets `seedPreview` (post-wipe)
 * and the standalone `seedAprovadaContracts` mutation (against
 * existing prod data) both call it safely.
 */
async function populateAprovadaBook(ctx: MutationCtx, agencyId: AgencyId) {
  const FIRST_PID = 31;
  const FEE_MULTIPLIER = 1.6;

  // Idempotency must be GLOBAL, not per-agency. publicId carries no
  // DB-level uniqueness constraint; this range (1000031–1000036) is the
  // single canonical Aprovada starter book — if any contract already
  // claims it, abort regardless of which agency owns it. Earlier the
  // check filtered by agencyId, which let `seedAprovadaContracts`
  // populate two agencies at the same publicIds and broke
  // `getByPublicId` (`.unique()` threw on duplicates).
  const existingAtFirstPid = await ctx.db
    .query("contracts")
    .withIndex("by_publicId", (q) => q.eq("publicId", pid(FIRST_PID)))
    .first();
  if (existingAtFirstPid) {
    return { contractsInserted: 0, ativoCount: 0, skipped: true as const };
  }

  type ContractSpec = {
    n: number;
    status: "ativo" | "pendente" | "encerrado";
    activatedAt: string | null;
    deactivatedAt: string | null;
    nextRenewalDate: string;
    rentCents: number;
    condoCents: number;
    property: { cep: string; streetAndNumber: string; neighborhood: string; cityUF: string };
    complement: string;
    tenant: {
      fullName: string;
      cpf: string;
      birthDate: string;
      phoneSuffix: string;
      emailLocal: string;
      score: number;
    };
  };

  const specs: ContractSpec[] = [
    {
      n: 0,
      status: "ativo",
      activatedAt: d("2025-09-15T10:00:00-03:00"),
      deactivatedAt: null,
      nextRenewalDate: "2027-09-15",
      rentCents: 285_000,
      condoCents: 42_000,
      property: {
        cep: "04543-011",
        streetAndNumber: "Rua Joaquim Floriano, 533",
        neighborhood: "Itaim Bibi",
        cityUF: "São Paulo/SP",
      },
      complement: "Apto 82",
      tenant: {
        fullName: "Beatriz Almeida Carvalho",
        cpf: "232.323.232-32",
        birthDate: "1992-08-23",
        phoneSuffix: "31",
        emailLocal: "beatriz.almeida",
        score: 780,
      },
    },
    {
      n: 1,
      status: "ativo",
      activatedAt: d("2025-11-01T10:00:00-03:00"),
      deactivatedAt: null,
      nextRenewalDate: "2027-11-01",
      rentCents: 420_000,
      condoCents: 65_000,
      property: {
        cep: "01451-000",
        streetAndNumber: "Rua Oscar Freire, 1200",
        neighborhood: "Jardins",
        cityUF: "São Paulo/SP",
      },
      complement: "Apto 1502",
      tenant: {
        fullName: "Rafael Monteiro Lima",
        cpf: "323.232.323-23",
        birthDate: "1985-04-17",
        phoneSuffix: "32",
        emailLocal: "rafael.monteiro",
        score: 820,
      },
    },
    {
      n: 2,
      status: "ativo",
      activatedAt: d("2026-01-20T10:00:00-03:00"),
      deactivatedAt: null,
      nextRenewalDate: "2028-01-20",
      rentCents: 195_000,
      condoCents: 28_000,
      property: {
        cep: "05402-000",
        streetAndNumber: "Rua Cardeal Arcoverde, 1820",
        neighborhood: "Pinheiros",
        cityUF: "São Paulo/SP",
      },
      complement: "Apto 41",
      tenant: {
        fullName: "Letícia Andrade Pires",
        cpf: "424.242.424-24",
        birthDate: "1994-11-30",
        phoneSuffix: "33",
        emailLocal: "leticia.andrade",
        score: 695,
      },
    },
    {
      n: 3,
      status: "ativo",
      activatedAt: d("2026-03-10T10:00:00-03:00"),
      deactivatedAt: null,
      nextRenewalDate: "2028-03-10",
      rentCents: 650_000,
      condoCents: 98_000,
      property: {
        cep: "01310-100",
        streetAndNumber: "Av. Paulista, 2100",
        neighborhood: "Bela Vista",
        cityUF: "São Paulo/SP",
      },
      complement: "Cobertura 18",
      tenant: {
        fullName: "Fernanda Lopes Cavalcanti",
        cpf: "525.252.525-25",
        birthDate: "1980-07-08",
        phoneSuffix: "34",
        emailLocal: "fernanda.lopes",
        score: 855,
      },
    },
    {
      n: 4,
      status: "pendente",
      activatedAt: null,
      deactivatedAt: null,
      nextRenewalDate: "2028-06-01",
      rentCents: 340_000,
      condoCents: 52_000,
      property: {
        cep: "04094-050",
        streetAndNumber: "Rua Vergueiro, 3800",
        neighborhood: "Vila Mariana",
        cityUF: "São Paulo/SP",
      },
      complement: "Apto 73",
      tenant: {
        fullName: "Gustavo Ribeiro Tavares",
        cpf: "626.262.626-26",
        birthDate: "1989-02-14",
        phoneSuffix: "35",
        emailLocal: "gustavo.ribeiro",
        score: 610,
      },
    },
    {
      n: 5,
      status: "encerrado",
      activatedAt: d("2024-04-15T10:00:00-03:00"),
      deactivatedAt: d("2026-03-31T18:00:00-03:00"),
      nextRenewalDate: "2026-04-15",
      rentCents: 225_000,
      condoCents: 38_000,
      property: {
        cep: "02011-000",
        streetAndNumber: "Rua Voluntários da Pátria, 990",
        neighborhood: "Santana",
        cityUF: "São Paulo/SP",
      },
      complement: "Apto 22",
      tenant: {
        fullName: "Bruno Tavares Macedo",
        cpf: "727.272.727-27",
        birthDate: "1986-09-19",
        phoneSuffix: "36",
        emailLocal: "bruno.tavares",
        score: 705,
      },
    },
  ];

  const inserted: { spec: ContractSpec; id: ContractId; publicId: string; feeCents: number }[] = [];

  for (const spec of specs) {
    const publicId = pid(FIRST_PID + spec.n);
    const feeCents = Math.round(spec.rentCents * FEE_MULTIPLIER);
    const isApproved = spec.status !== "pendente";

    const id = await ctx.db.insert("contracts", {
      agencyId,
      publicId,
      tenantCpf: spec.tenant.cpf.replace(/\D/g, ""),
      status: spec.status,
      activatedAt: spec.activatedAt,
      deactivatedAt: spec.deactivatedAt,
      nextRenewalDate: spec.nextRenewalDate,
      availableGuaranteeCents: spec.status === "encerrado" ? 0 : spec.rentCents * 40,
      rental: {
        propertyKind: "residencial",
        rentCents: spec.rentCents,
        condoCents: spec.condoCents,
        otherFeesCents: 0,
        totalRentCents: spec.rentCents + spec.condoCents,
        feeCents,
        oneTimeActivationFeeCents: 20_000,
        setupInstallments: 1,
        exitCostMultiplier: DEFAULT_EXIT_COST_MULTIPLIER,
        rentMultiplier: DEFAULT_RENT_MULTIPLIER,
        payer: DEFAULT_PAYER,
        pviMigrationSchedule: null,
      },
      property: spec.property,
      optional: { complement: spec.complement, tag: "", description: "" },
      documents: isApproved
        ? [
            { key: "rentalContract", status: "aprovado" },
            { key: "inspection", status: "aprovado" },
            { key: "policy", status: "aprovado" },
          ]
        : [
            { key: "rentalContract", status: "enviado" },
            { key: "inspection", status: "pendente" },
            { key: "policy", status: "pendente" },
          ],
      tenant: {
        approvalStatus: isApproved ? "aprovado" : "pendente",
        fullName: spec.tenant.fullName,
        cpf: spec.tenant.cpf,
        birthDate: spec.tenant.birthDate,
        email: `${spec.tenant.emailLocal}@example.com`,
        phone: `119000000${spec.tenant.phoneSuffix}`,
        termApprovedAt: isApproved ? (spec.activatedAt ?? d("2025-09-15T09:00:00-03:00")) : null,
        score: spec.tenant.score,
      },
    });
    inserted.push({ spec, id, publicId, feeCents });
  }

  for (const row of inserted) {
    const doc = await ctx.db.get(row.id);
    if (doc) await insertContractAggregates(ctx, doc);
  }

  const ativoRows = inserted.filter((r) => r.spec.status === "ativo");

  const monthlyLineItems = (month: string) =>
    ativoRows.map((r) => ({
      contractId: r.id,
      contractPublicId: r.publicId,
      kind: PAYMENT_LINE_ITEM_KIND.RECURRING,
      amountCents: r.feeCents,
      description: `Mensalidade contrato ${r.publicId} — ${month}`,
    }));

  const march = monthlyLineItems("2026-03");
  await ctx.db.insert("payments", {
    agencyId,
    publicId: "PAY-2026-03-0500",
    periodMonth: "2026-03",
    issuedAt: "2026-03-01",
    dueDate: "2026-03-10",
    totalCents: march.reduce((s, x) => s + x.amountCents, 0),
    state: PaymentStates.paid(d("2026-03-08T10:00:00-03:00")),
    method: PaymentMethods.pix(
      "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b500",
      "E00038166202603081000aprov01",
    ),
    muxedId: generatePaymentMuxedId(),
    lineItems: march,
  });

  const april = monthlyLineItems("2026-04");
  await ctx.db.insert("payments", {
    agencyId,
    publicId: "PAY-2026-04-0500",
    periodMonth: "2026-04",
    issuedAt: "2026-04-01",
    dueDate: "2026-04-10",
    totalCents: april.reduce((s, x) => s + x.amountCents, 0),
    state: PaymentStates.paid(d("2026-04-07T11:30:00-03:00")),
    method: PaymentMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000005920"),
    muxedId: generatePaymentMuxedId(),
    lineItems: april,
  });

  const may = monthlyLineItems("2026-05");
  await ctx.db.insert("payments", {
    agencyId,
    publicId: "PAY-2026-05-0500",
    periodMonth: "2026-05",
    issuedAt: "2026-05-01",
    dueDate: "2026-05-10",
    totalCents: may.reduce((s, x) => s + x.amountCents, 0),
    state: PaymentStates.pending(),
    method: null,
    muxedId: generatePaymentMuxedId(),
    lineItems: may,
  });

  for (const r of ativoRows) {
    await ctx.db.insert("contractHistory", {
      agencyId,
      contractPublicId: r.publicId,
      at: r.spec.activatedAt ?? d("2025-09-15T09:00:00-03:00"),
      username: "agency.owner",
      message: `Criada Solicitação #${r.publicId} — ${r.spec.tenant.fullName}, aluguel R$ ${(r.spec.rentCents / 100).toLocaleString("pt-BR")}.`,
    });
  }

  return { contractsInserted: inserted.length, ativoCount: ativoRows.length };
}

/**
 * Standalone wrapper for {@link populateAprovadaBook} — lets you seed the
 * Aprovada starter book against any existing agency id without running
 * the full `seedPreview` (which wipes the DB). Idempotent: re-runs
 * against the same agency are a no-op.
 *
 * Run with:
 *   bunx convex run seed:seedAprovadaContracts '{"agencyId":"<id>"}'
 */
export const seedAprovadaContracts = internalMutation({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => populateAprovadaBook(ctx, args.agencyId),
});

/**
 * One-shot preview reset: wipes the demo tables, re-seeds the fictional
 * dataset, attaches the four Auth0 test personas, and tops the
 * `agencyowner` persona's agency ("Imobiliária Aprovada") with a small
 * believable contract set so logging in as that persona lands on a
 * populated dashboard. This is what the Vercel preview hook
 * (`scripts/seed-preview.sh`) and a developer's "give me a clean dev
 * DB" workflow call.
 *
 * The two nested `runMutation` calls are same-file, so per the Convex
 * guidelines the local return types are annotated to break TypeScript
 * circularity.
 */
export const seedPreview = internalMutation({
  args: { adminEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await wipeDemoTables(ctx);
    const fictional: SeedFictionalResult = await ctx.runMutation(internal.seed.seedFictional, args);
    const personas: SeedPersonasResult = await ctx.runMutation(internal.seed.seedTestPersonas, {});

    const aprovadaAgencyId = personas.find((p) => p.persona === "agencyowner")?.agencyId;
    const aprovada = aprovadaAgencyId ? await populateAprovadaBook(ctx, aprovadaAgencyId) : null;

    return { fictional, personas, aprovada };
  },
});
