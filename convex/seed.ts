import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  accessTokenExpiryFrom,
  INVOICE_LINE_ITEM_KIND,
  InvoiceStates,
  settledAccessTokenExpiry,
} from "./invoices/domain";
import { generateInvoiceMuxedId } from "./invoices/lib/muxedId";
import { generateInvoiceAccessToken } from "./lib/randomId";
import { SettlementMethods, type SettlementMethod } from "./payments/domain";
import type { AgencyId } from "./agencies/domain";
import {
  DELINQUENCY_STATUS,
  NOTICE_EVIDENCE_SOURCE,
  NOTICE_RESOLUTION_KIND,
} from "./delinquencies/domain";
import {
  assertClose,
  assertTransition,
  CLOSE_REASON,
  DEFAULT_GUARANTEE_PLAN,
  DOCUMENT_STATUS,
  GUARANTEE_STATE,
  isInsured,
  SCORE_TIER,
  TENANT_APPROVAL_STATUS,
  tierForScore,
  type CloseReason,
  type Guarantee,
  type GuaranteeId,
  type GuaranteePlan,
  type GuaranteeState,
  type GuaranteeTerms,
  type TenantApprovalStatus,
} from "./guarantees/domain";
import type { UserId } from "./users/domain";
import { DEFAULT_PRICING_TABLE, priceGuarantee } from "./guarantees/pricing";
import {
  ativoInsuredCentsPlatform,
  contractsByStatus,
  contractsByStatusPlatform,
} from "./guarantees/aggregate";
import { insertGuaranteeAggregates } from "./guarantees/aggregateWrites";
import {
  buildLeaseRent,
  DEFAULT_PAYER,
  PROPERTY_KIND,
  type LeaseId,
  type LeaseProperty,
  type LeaseRentInput,
  type PropertyKind,
} from "./leases/domain";
import { DEFAULT_PRODUCT_SLUG, type Product } from "./products/domain";
import { findDefaultProduct } from "./products/useCases";
import { normalizeEmbeddedTenant, type EmbeddedTenantSnapshot } from "./tenants/domain";
import { getOrCreateTenant } from "./tenants/useCases";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Zero-padded public guarantee ID, e.g. "1000007" */
const pid = (n: number) => String(1_000_000 + n);

/** Seed lease reference derived from its guarantee's public id (`LSE-1000007`). */
const leasePid = (guaranteePublicId: string) => `LSE-${guaranteePublicId}`;

/**
 * Seed timestamp, normalized to UTC `Z` form. Production stamps every history,
 * notice and audit row with `toISOString()`, and both the state timeline and
 * the activity series compare those strings LEXICALLY against `Z`-form period
 * boundaries — so an offset-form seed row (`…T22:00:00-03:00`) sorts and
 * buckets as the day before the instant it denotes, and orders backwards
 * against a production row written on the same day. One format everywhere is
 * the only way the two corpora are comparable.
 */
const d = (s: string) => new Date(s).toISOString();

/**
 * Demo tables wiped by `seedReset`. Order matters —
 * tables with foreign-key-like references come first so we don't leave
 * dangling pointers mid-wipe.
 *
 * DELIBERATELY EXCLUDED — real/operational data the seed must never destroy:
 *   - `waitlist`            marketing leads (synced to Resend audiences)
 *   - `mutavAuditLog` / `mutavAuditAnchors`  hash-chained audit trail
 *   - `mutavStaff`          Mutav staff role grants
 *   - `reserveSnapshots`    coverage/transparency history
 *   - `creditAnalysis*`     bureau signals + assessments
 *   - `contractApplications` the art. 15 declarations those signals cite
 *   - anchor/stellar index state, webhook events
 * Do NOT add any of these here. `seed.test.ts` guards `waitlist` survival and
 * the signal → application attribution.
 *
 * `contractApplications` is retained for the same reason as the signals it
 * authorises: a `creditAnalysisSignals` row names the declaration that made
 * its bureau pull lawful, and the signals are never wiped, so wiping the
 * declarations would leave the retained record citing nothing. Its own
 * `agencyId` / `openedBy` go stale on a reseed exactly as the signals' do —
 * and because Convex never reuses an id, a stale row can never match a live
 * agency, so it cannot authorise a later pull.
 */
const DEMO_TABLES = [
  // providerOrders FK-references invoices; wipe attempts before invoices even
  // though the seed doesn't insert orders today — keeps the wipe FK-safe if
  // a manual checkout run left orders behind.
  "providerOrders",
  // payments FK-references invoices; wipe before invoices to avoid dangling
  // pointers mid-wipe.
  "payments",
  "invoices",
  // Notices FK-reference guarantees + users. Wipe before guarantees so we
  // don't leave dangling guaranteeId pointers mid-wipe.
  "guaranteeDelinquencyNotices",
  "guaranteeHistory",
  // guarantees ↔ leases point at each other (`leaseId` / `openGuaranteeId`);
  // guarantees go first so no lease pointer outlives its target, and the
  // product a guarantee priced against goes after every guarantee.
  "guarantees",
  "leases",
  "products",
  // tenants after leases — leases FK-reference tenants via tenantId.
  "tenants",
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
 * The one guarantee product the demo dataset sells. Its `terms` are today's
 * pricing constants verbatim, so every seeded guarantee prices exactly as the
 * pre-catalog code did. Idempotent by slug.
 */
async function seedDefaultProduct(ctx: MutationCtx): Promise<Product> {
  const existing = await ctx.db
    .query("products")
    .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_PRODUCT_SLUG))
    .unique();
  if (existing) return existing;
  const productId = await ctx.db.insert("products", {
    slug: DEFAULT_PRODUCT_SLUG,
    name: "Mutav Fiança",
    enabled: true,
    isDefault: true,
    // Predates the earliest seeded pricing (2024-04) so every `terms`
    // snapshot cites a product that was in effect at its `appliedAt`.
    effectiveFrom: d("2022-01-01T00:00:00.000Z"),
    terms: DEFAULT_PRICING_TABLE,
    eligibility: {
      agencyIds: null,
      regionUFs: null,
      minTier: null,
      propertyKinds: null,
    },
  });
  const product = await ctx.db.get(productId);
  if (!product) throw new Error("Default product insert failed");
  return product;
}

async function requireDefaultProduct(ctx: MutationCtx): Promise<Product> {
  const product = await findDefaultProduct(ctx);
  if (!product) throw new Error("Seed requires the default product; run seedDefaultProduct first");
  return product;
}

/**
 * Seed-local tenant block: the wizard-era embedded shape plus the
 * guarantee-level approval/score fields, kept so the seed data reads like
 * one self-contained record per lease.
 */
type SeedTenantBlock = EmbeddedTenantSnapshot & {
  approvalStatus: TenantApprovalStatus;
  termApprovedAt: string | null;
  score: number;
};

type SeedLeaseSpec = {
  agencyId: AgencyId;
  /** Guarantee public id; the lease derives its own via `leasePid`. */
  publicId: string;
  lease: {
    propertyKind: PropertyKind;
    property: LeaseProperty;
    tag: string;
    description: string;
    rent: LeaseRentInput;
  };
  guarantee: {
    state: GuaranteeState;
    closure?: { reason: CloseReason; closedAt: string; note?: string };
    activatedAt: string | null;
    nextRenewalDate: string;
    plan?: GuaranteePlan;
    /** Capacity reserved against committed cover; `available = ceiling - reserved`. */
    reservedCents?: number;
    documents: Guarantee["documents"];
  };
  tenant: SeedTenantBlock;
};

type SeededLeaseAndGuarantee = {
  guaranteeId: GuaranteeId;
  leaseId: LeaseId;
  publicId: string;
  terms: GuaranteeTerms;
};

// Drafts were never activated or approved, so nothing on the record dates
// their pricing; the demo book was priced on this day.
const SEED_DRAFT_PRICED_AT = d("2026-05-01T09:00:00-03:00");

/**
 * Registry-only lease + guarantee insert: resolves (or creates) the `tenants`
 * row through `getOrCreateTenant` — same dedup / last-write-wins / conflict
 * audit-logging semantics as `guarantees.create` — inserts the lease, prices
 * the guarantee through the default product with `priceGuarantee` (so fee,
 * ceiling and exit cap reconcile with the product, never hand-typed), writes
 * the guarantee with its `terms` snapshot + `capacity`, points the lease at
 * it when it is not closed, and registers it in every aggregate. Seed data
 * must be checksum-valid and priceable, so a non-normalizable tenant or a
 * denied score throws instead of silently skipping.
 */
async function insertSeedLeaseAndGuarantee(
  ctx: MutationCtx,
  { product, spec }: { product: Product; spec: SeedLeaseSpec },
): Promise<SeededLeaseAndGuarantee> {
  const { tenant, lease, guarantee } = spec;
  const input = normalizeEmbeddedTenant(tenant);
  if (!input) {
    throw new Error(`Seed tenant for guarantee ${spec.publicId} failed tax-id normalization`);
  }
  const result = await getOrCreateTenant(ctx, {
    input,
    actor: { kind: "system", source: "seed" },
  });
  if (!result.success) {
    throw new Error(`Seed tenant for guarantee ${spec.publicId}: ${result.message}`);
  }

  const tier = tierForScore(tenant.score);
  if (tier === SCORE_TIER.NEGADO) {
    throw new Error(`Seed tenant for guarantee ${spec.publicId} has a denied score`);
  }

  const leaseId = await ctx.db.insert("leases", {
    agencyId: spec.agencyId,
    publicId: leasePid(spec.publicId),
    tenantId: result.data.tenantId,
    propertyKind: lease.propertyKind,
    property: lease.property,
    tag: lease.tag,
    description: lease.description,
    rent: buildLeaseRent(lease.rent),
    payer: DEFAULT_PAYER,
    openGuaranteeId: null,
  });

  const priced = priceGuarantee(
    {
      rentCents: lease.rent.rentCents,
      tier,
      plan: guarantee.plan ?? DEFAULT_GUARANTEE_PLAN,
      productSlug: product.slug,
      // The terms snapshot is taken at activation; only drafts have nothing to date it.
      appliedAt: guarantee.activatedAt ?? SEED_DRAFT_PRICED_AT,
    },
    product.terms,
  );
  const reservedCents = guarantee.reservedCents ?? 0;
  if (reservedCents > priced.capacity.ceilingCents) {
    throw new Error(`Seed guarantee ${spec.publicId} reserves more than its coverage ceiling`);
  }

  const guaranteeId = await ctx.db.insert("guarantees", {
    agencyId: spec.agencyId,
    leaseId,
    publicId: spec.publicId,
    productId: product._id,
    status: guarantee.state,
    ...(guarantee.closure ? { closure: guarantee.closure } : {}),
    activatedAt: guarantee.activatedAt,
    nextRenewalDate: guarantee.nextRenewalDate,
    underwriting: { score: tenant.score, tier },
    tenantApproval: {
      status: tenant.approvalStatus,
      termApprovedAt: tenant.termApprovedAt,
    },
    terms: priced.terms,
    capacity: {
      ceilingCents: priced.capacity.ceilingCents,
      availableCents: priced.capacity.ceilingCents - reservedCents,
      reservedCents,
    },
    documents: guarantee.documents,
  });

  if (guarantee.state !== GUARANTEE_STATE.CLOSED) {
    await ctx.db.patch(leaseId, { openGuaranteeId: guaranteeId });
  }

  const doc = await ctx.db.get(guaranteeId);
  if (!doc) throw new Error(`Seed guarantee ${spec.publicId} insert failed`);
  await insertGuaranteeAggregates(ctx, doc);

  return { guaranteeId, leaseId, publicId: spec.publicId, terms: priced.terms };
}
/**
 * Insert a paid invoice plus its mirroring `payments` settlement row in
 * one call. The settlement reuses the invoice's own `paidAt`, total, and
 * method shape so seeded history matches what the dual-write path
 * (`recordSettlement`) produces in production.
 */
async function seedPaidInvoice(
  ctx: MutationCtx,
  invoice: {
    agencyId: AgencyId;
    publicId: string;
    periodMonth: string;
    issuedAt: string;
    dueDate: string;
    totalCents: number;
    paidAt: string;
    method: SettlementMethod;
    lineItems: Array<{
      guaranteeId: GuaranteeId;
      guaranteePublicId: string;
      kind: "recurring" | "activation";
      amountCents: number;
      description: string;
    }>;
  },
) {
  const invoiceId = await ctx.db.insert("invoices", {
    agencyId: invoice.agencyId,
    publicId: invoice.publicId,
    periodMonth: invoice.periodMonth,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    totalCents: invoice.totalCents,
    state: InvoiceStates.paid(invoice.paidAt),
    accessToken: generateInvoiceAccessToken(),
    // Seeded expiry runs from the reseed, not from the fixture's historical
    // `issuedAt` — a demo dataset whose links are born expired is a dataset
    // nobody can walk through.
    accessTokenExpiresAt: settledAccessTokenExpiry(accessTokenExpiryFrom(Date.now()), Date.now()),
    muxedId: generateInvoiceMuxedId(),
    lineItems: invoice.lineItems,
  });

  await ctx.db.insert("payments", {
    agencyId: invoice.agencyId,
    invoiceId,
    status: "succeeded",
    amountCents: invoice.totalCents,
    paidAt: invoice.paidAt,
    externalRef: externalRefForSettlement(invoice.method),
    method: invoice.method,
  });

  return invoiceId;
}

/**
 * Pick the on-chain/anchor reference that the dual-write path records as
 * `externalRef` (tx hash for Stellar, anchor txId for Pix; boleto has
 * none).
 */
function externalRefForSettlement(method: SettlementMethod): string | undefined {
  switch (method.kind) {
    case "boleto":
      return undefined;
    case "stellar":
      return method.txHash ?? undefined;
    case "pix":
      return method.txId ?? undefined;
  }
}

type SeedFictionalResult = {
  agencies: { paulistaId: AgencyId; atlanticaId: AgencyId; horizonteId: AgencyId };
  guaranteeCounts: { paulista: number; atlantica: number; horizonte: number };
};

/**
 * Additive dev seed — inserts 3 agencies, 30 leases each carrying one
 * guarantee priced through the default product, guarantee history, and
 * historical payments covering the last two months. Does NOT wipe
 * existing rows and does NOT seed the `agencyowner` persona's own agency
 * ("Imobiliária Aprovada"). It is deliberately a private helper, not a
 * runnable entrypoint: running it by hand leaves `agencyowner` staring at
 * an empty dashboard (see `docs/test-personas.md` — the partial-seed
 * trap). Only `seedReset` calls it, chained with the persona + Aprovada
 * steps that complete the picture.
 *
 * Optional `adminEmail` provisions a user row with that email and grants
 * it owner/admin/member memberships across the three seeded agencies. On
 * the developer's first Auth0 login with that email, the existing row
 * gets its `subject` patched (see `getOrCreateByIdentity`) so the
 * developer inherits the seeded memberships without re-onboarding.
 *
 * `staffUserId` signs the staff-only notice dispositions (verification,
 * cover) in the dataset, the way `mutationWithMutavRole` would in production.
 *
 * Dev-only. Do NOT call from production.
 */
async function seedFictional(
  ctx: MutationCtx,
  args: { adminEmail?: string; staffUserId: UserId },
): Promise<SeedFictionalResult> {
  {
    const product = await requireDefaultProduct(ctx);
    const insertLeaseAndGuarantee = (spec: SeedLeaseSpec) =>
      insertSeedLeaseAndGuarantee(ctx, { product, spec });

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

    // ── Leases + guarantees — Imobiliária Paulista (15) ───────────────────────
    // 12 active, 2 drafted, 1 closed (end_of_lease)

    const p1 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(1),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "01310-100",
          streetAndNumber: "Av. Paulista, 1500",
          neighborhood: "Bela Vista",
          cityUF: "São Paulo/SP",
          complement: "Apto 204",
        },
        tag: "",
        description: "",
        rent: { rentCents: 320_000, condoCents: 45_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-06-03T10:00:00-03:00"),
        nextRenewalDate: "2027-03-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Maria Silva Santos",
        cpf: "11111111200",
        birthDate: "1990-05-12",
        email: "maria.silva@example.com",
        phone: "11900000001",
        termApprovedAt: d("2025-03-01T10:00:00-03:00"),
        score: 750,
      },
    });

    const p2 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(2),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "01402-000",
          streetAndNumber: "Rua Augusta, 800",
          neighborhood: "Consolação",
          cityUF: "São Paulo/SP",
          complement: "Apto 101",
        },
        tag: "",
        description: "",
        rent: { rentCents: 400_000, condoCents: 60_000, otherFeesCents: 5_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-07-08T10:00:00-03:00"),
        nextRenewalDate: "2027-04-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Carlos Eduardo Ferreira",
        cpf: "22222222303",
        birthDate: "1985-08-20",
        email: "carlos.ferreira@example.com",
        phone: "11900000002",
        termApprovedAt: d("2025-04-01T09:30:00-03:00"),
        score: 780,
      },
    });

    const p3 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(3),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "01310-200",
          streetAndNumber: "Av. Paulista, 900",
          neighborhood: "Bela Vista",
          cityUF: "São Paulo/SP",
          complement: "Sala 305",
        },
        tag: "comercial",
        description: "Escritório para startups.",
        rent: { rentCents: 550_000, condoCents: 90_000, otherFeesCents: 15_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-08-12T10:00:00-03:00"),
        nextRenewalDate: "2027-05-15",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Tech Solutions Ltda",
        entityType: "pj",
        cpf: "33333333000191",
        birthDate: "2010-01-01",
        email: "contato@techsolutions.example.com",
        phone: "11900000003",
        termApprovedAt: d("2025-05-15T14:00:00-03:00"),
        score: 650,
      },
    });

    const p4 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(4),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "04571-010",
          streetAndNumber: "Av. das Nações Unidas, 12000",
          neighborhood: "Brooklin",
          cityUF: "São Paulo/SP",
          complement: "Apto 802",
        },
        tag: "",
        description: "",
        rent: { rentCents: 240_000, condoCents: 30_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-09-05T10:00:00-03:00"),
        nextRenewalDate: "2026-11-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Ana Paula Rodrigues",
        cpf: "44444444525",
        birthDate: "1993-02-28",
        email: "ana.rodrigues@example.com",
        phone: "11900000004",
        termApprovedAt: d("2024-11-01T11:00:00-03:00"),
        score: 720,
      },
    });

    const p5 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(5),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "04538-133",
          streetAndNumber: "Rua Funchal, 418",
          neighborhood: "Vila Olímpia",
          cityUF: "São Paulo/SP",
          complement: "Andar 8 completo",
        },
        tag: "premium",
        description: "Laje corporativa.",
        rent: { rentCents: 700_000, condoCents: 120_000, otherFeesCents: 20_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-02-22T10:00:00-03:00"),
        nextRenewalDate: "2027-01-20",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Global Finance S.A.",
        entityType: "pj",
        cpf: "55555555000191",
        birthDate: "1999-07-01",
        email: "financeiro@globalfinance.example.com",
        phone: "11900000005",
        termApprovedAt: d("2025-01-20T09:00:00-03:00"),
        score: 800,
      },
    });

    const p6 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(6),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "05422-010",
          streetAndNumber: "Rua dos Pinheiros, 330",
          neighborhood: "Pinheiros",
          cityUF: "São Paulo/SP",
          complement: "Apto 52",
        },
        tag: "",
        description: "",
        rent: { rentCents: 280_000, condoCents: 40_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-01-10T10:00:00-03:00"),
        nextRenewalDate: "2027-02-10",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Bruno Henrique Lima",
        cpf: "66666666747",
        birthDate: "1988-11-15",
        email: "bruno.lima@example.com",
        phone: "11900000006",
        termApprovedAt: d("2025-02-10T15:00:00-03:00"),
        score: 670,
      },
    });

    const p7 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(7),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "03301-000",
          streetAndNumber: "Av. Radial Leste, 1200",
          neighborhood: "Tatuapé",
          cityUF: "São Paulo/SP",
          complement: "Apto 12",
        },
        tag: "",
        description: "",
        rent: { rentCents: 180_000, condoCents: 25_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-12-28T10:00:00-03:00"),
        nextRenewalDate: "2026-09-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.ENVIADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Fernanda Costa Oliveira",
        cpf: "77777777858",
        birthDate: "1995-06-03",
        email: "fernanda.oliveira@example.com",
        phone: "11900000007",
        termApprovedAt: d("2024-09-01T10:30:00-03:00"),
        score: 760,
      },
    });

    const p8 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(8),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "01423-001",
          streetAndNumber: "Rua Oscar Freire, 500",
          neighborhood: "Jardim Paulista",
          cityUF: "São Paulo/SP",
          complement: "Cobertura 1",
        },
        tag: "premium",
        description: "",
        rent: { rentCents: 360_000, condoCents: 55_000, otherFeesCents: 8_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-05-05T10:00:00-03:00"),
        nextRenewalDate: "2026-08-20",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Ricardo Monteiro Braga",
        cpf: "88888888969",
        birthDate: "1980-09-25",
        email: "ricardo.braga@example.com",
        phone: "11900000008",
        termApprovedAt: d("2024-08-20T08:00:00-03:00"),
        score: 720,
      },
    });

    const p9 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(9),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "02040-000",
          streetAndNumber: "Av. Nova Cantareira, 600",
          neighborhood: "Mandaqui",
          cityUF: "São Paulo/SP",
          complement: "Apto 31",
        },
        tag: "",
        description: "",
        rent: { rentCents: 150_000, condoCents: 20_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-04-18T10:00:00-03:00"),
        nextRenewalDate: "2027-06-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.PENDENTE },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Juliana Nascimento Souza",
        cpf: "00000000191",
        birthDate: "1997-12-08",
        email: "juliana.souza@example.com",
        phone: "11900000009",
        termApprovedAt: d("2025-06-01T16:00:00-03:00"),
        score: 690,
      },
    });

    const p10 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(10),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "04547-130",
          streetAndNumber: "Av. Brigadeiro Faria Lima, 3400",
          neighborhood: "Itaim Bibi",
          cityUF: "São Paulo/SP",
          complement: "Sala 1201",
        },
        tag: "comercial-premium",
        description: "Escritório em torre AAA.",
        rent: { rentCents: 480_000, condoCents: 80_000, otherFeesCents: 10_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-03-25T10:00:00-03:00"),
        nextRenewalDate: "2026-12-15",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Inovação Digital Ltda",
        entityType: "pj",
        cpf: "10101010000177",
        birthDate: "2015-03-01",
        email: "admin@inovacaodigital.example.com",
        phone: "11900000010",
        termApprovedAt: d("2024-12-15T13:00:00-03:00"),
        score: 580,
      },
    });

    const p11 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(11),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "05051-000",
          streetAndNumber: "Av. Queiroz Filho, 1200",
          neighborhood: "Vila Hamburguesa",
          cityUF: "São Paulo/SP",
          complement: "Apto 73",
        },
        tag: "",
        description: "",
        rent: { rentCents: 200_000, condoCents: 28_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-03-15T10:00:00-03:00"),
        nextRenewalDate: "2027-07-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Lucas Andrade Pereira",
        cpf: "11111111383",
        birthDate: "1992-04-17",
        email: "lucas.pereira@example.com",
        phone: "11900000011",
        termApprovedAt: d("2025-07-01T09:00:00-03:00"),
        score: 750,
      },
    });

    const p12 = await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(12),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "04040-001",
          streetAndNumber: "Rua Domingos de Morais, 2000",
          neighborhood: "Vila Mariana",
          cityUF: "São Paulo/SP",
          complement: "Apto 45",
        },
        tag: "",
        description: "",
        rent: { rentCents: 260_000, condoCents: 35_000, otherFeesCents: 5_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-05-15T10:00:00-03:00"),
        nextRenewalDate: "2026-10-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Patrícia Gomes Tavares",
        cpf: "12121212108",
        birthDate: "1991-07-30",
        email: "patricia.tavares@example.com",
        phone: "11900000012",
        termApprovedAt: d("2024-10-01T10:00:00-03:00"),
        score: 710,
      },
    });

    await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(13),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "01530-001",
          streetAndNumber: "Rua da Consolação, 1500",
          neighborhood: "Consolação",
          cityUF: "São Paulo/SP",
          complement: "Apto 88",
        },
        tag: "",
        description: "",
        rent: { rentCents: 330_000, condoCents: 50_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.DRAFTED,
        activatedAt: null,
        nextRenewalDate: "2027-08-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.ENVIADO },
          { key: "inspection", status: DOCUMENT_STATUS.PENDENTE },
          { key: "policy", status: DOCUMENT_STATUS.PENDENTE },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.PENDENTE,
        fullName: "Roberto Carvalho Neto",
        cpf: "13131313188",
        birthDate: "1987-03-22",
        email: "roberto.neto@example.com",
        phone: "11900000013",
        termApprovedAt: null,
        score: 550,
      },
    });

    await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(14),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "04578-000",
          streetAndNumber: "Rua Verbo Divino, 1488",
          neighborhood: "Chácara Santo Antônio",
          cityUF: "São Paulo/SP",
          complement: "Sala 402",
        },
        tag: "comercial",
        description: "",
        rent: { rentCents: 390_000, condoCents: 65_000, otherFeesCents: 8_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.DRAFTED,
        activatedAt: null,
        nextRenewalDate: "2027-09-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.PENDENTE },
          { key: "inspection", status: DOCUMENT_STATUS.PENDENTE },
          { key: "policy", status: DOCUMENT_STATUS.PENDENTE },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.PENDENTE,
        fullName: "Soluções Web S.A.",
        entityType: "pj",
        cpf: "14141414000145",
        birthDate: "2018-05-10",
        email: "contato@solucoesweb.example.com",
        phone: "11900000014",
        termApprovedAt: null,
        score: 490,
      },
    });

    await insertLeaseAndGuarantee({
      agencyId: paulistaId,
      publicId: pid(15),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "01301-001",
          streetAndNumber: "Av. São João, 300",
          neighborhood: "República",
          cityUF: "São Paulo/SP",
          complement: "Apto 3",
        },
        tag: "",
        description: "",
        rent: { rentCents: 220_000, condoCents: 32_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.CLOSED,
        closure: { reason: CLOSE_REASON.END_OF_LEASE, closedAt: d("2025-03-10T18:00:00-03:00") },
        activatedAt: d("2024-08-01T10:00:00-03:00"),
        nextRenewalDate: "2025-02-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Silvia Menezes Rocha",
        cpf: "15151515144",
        birthDate: "1983-10-05",
        email: "silvia.rocha@example.com",
        phone: "11900000015",
        termApprovedAt: d("2023-02-01T10:00:00-03:00"),
        score: 680,
      },
    });

    // ── Leases + guarantees — Imobiliária Atlântica (12) ──────────────────────
    // 8 active, 2 drafted, 1 closed (end_of_lease), 1 closed (canceled_pre_activation)

    const a1 = await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(16),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "22250-040",
          streetAndNumber: "Rua Visconde de Pirajá, 414",
          neighborhood: "Ipanema",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Apto 701",
        },
        tag: "premium",
        description: "Vista para o mar.",
        rent: { rentCents: 580_000, condoCents: 95_000, otherFeesCents: 12_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-06-15T10:00:00-03:00"),
        nextRenewalDate: "2027-03-15",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Mariana Figueiredo Costa",
        cpf: "16161616122",
        birthDate: "1989-01-14",
        email: "mariana.costa@example.com",
        phone: "21900000001",
        termApprovedAt: d("2025-03-15T11:00:00-03:00"),
        score: 760,
      },
    });

    const a2 = await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(17),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "20021-290",
          streetAndNumber: "Av. Rio Branco, 156",
          neighborhood: "Centro",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Andar 12",
        },
        tag: "comercial-premium",
        description: "Torre corporativa Centro RJ.",
        rent: { rentCents: 750_000, condoCents: 130_000, otherFeesCents: 20_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-07-22T10:00:00-03:00"),
        nextRenewalDate: "2027-05-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Atlântico Negócios S.A.",
        entityType: "pj",
        cpf: "17171717000107",
        birthDate: "2005-08-01",
        email: "financeiro@atlanticonegocios.example.com",
        phone: "21900000002",
        termApprovedAt: d("2025-05-01T09:00:00-03:00"),
        score: 710,
      },
    });

    const a3 = await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(18),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "22411-011",
          streetAndNumber: "Rua Dias Ferreira, 417",
          neighborhood: "Leblon",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Apto 301",
        },
        tag: "premium",
        description: "",
        rent: { rentCents: 440_000, condoCents: 70_000, otherFeesCents: 8_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-03-05T10:00:00-03:00"),
        nextRenewalDate: "2026-11-20",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Eduardo Pinto Bastos",
        cpf: "18181818199",
        birthDate: "1984-07-19",
        email: "eduardo.bastos@example.com",
        phone: "21900000003",
        termApprovedAt: d("2024-11-20T14:00:00-03:00"),
        score: 730,
      },
    });

    const a4 = await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(19),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "20551-013",
          streetAndNumber: "Rua Visconde de Santa Isabel, 100",
          neighborhood: "Vila Isabel",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Apto 23",
        },
        tag: "",
        description: "",
        rent: { rentCents: 220_000, condoCents: 30_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-01-20T10:00:00-03:00"),
        nextRenewalDate: "2027-01-10",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Tatiana Alves Mendes",
        cpf: "19191919177",
        birthDate: "1996-09-02",
        email: "tatiana.mendes@example.com",
        phone: "21900000004",
        termApprovedAt: d("2025-01-10T10:30:00-03:00"),
        score: 790,
      },
    });

    const a5 = await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(20),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "22640-101",
          streetAndNumber: "Av. das Américas, 3434",
          neighborhood: "Barra da Tijuca",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Sala 800",
        },
        tag: "comercial",
        description: "Complexo Downtown.",
        rent: { rentCents: 660_000, condoCents: 110_000, otherFeesCents: 18_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-12-15T10:00:00-03:00"),
        nextRenewalDate: "2026-08-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Construtora Barra S.A.",
        entityType: "pj",
        cpf: "20202020000152",
        birthDate: "2000-02-01",
        email: "obras@construtorabarra.example.com",
        phone: "21900000005",
        termApprovedAt: d("2024-08-01T08:00:00-03:00"),
        score: 640,
      },
    });

    const a6 = await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(21),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "20521-180",
          streetAndNumber: "Rua São Francisco Xavier, 524",
          neighborhood: "Maracanã",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Apto 1104",
        },
        tag: "",
        description: "",
        rent: { rentCents: 300_000, condoCents: 42_000, otherFeesCents: 5_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-04-02T10:00:00-03:00"),
        nextRenewalDate: "2027-04-20",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Gustavo Ribeiro Leal",
        cpf: "21212121244",
        birthDate: "1990-12-11",
        email: "gustavo.leal@example.com",
        phone: "21900000006",
        termApprovedAt: d("2025-04-20T09:30:00-03:00"),
        score: 710,
      },
    });

    const a7 = await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(22),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "20240-000",
          streetAndNumber: "Rua Mem de Sá, 90",
          neighborhood: "Lapa",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Apto 2",
        },
        tag: "",
        description: "",
        rent: { rentCents: 230_000, condoCents: 33_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-06-03T10:00:00-03:00"),
        nextRenewalDate: "2026-07-15",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Camila Souza Barros",
        cpf: "22222222494",
        birthDate: "1994-05-28",
        email: "camila.barros@example.com",
        phone: "21900000007",
        termApprovedAt: d("2024-07-15T11:00:00-03:00"),
        score: 750,
      },
    });

    const a8 = await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(23),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "22793-080",
          streetAndNumber: "Av. Ayrton Senna, 2600",
          neighborhood: "Barra da Tijuca",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Torre Sul, Andar 15",
        },
        tag: "premium",
        description: "Sede corporativa.",
        rent: { rentCents: 850_000, condoCents: 150_000, otherFeesCents: 25_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2026-05-22T10:00:00-03:00"),
        nextRenewalDate: "2027-02-28",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Petro Energy Ltda",
        entityType: "pj",
        cpf: "23232323000106",
        birthDate: "1998-11-01",
        email: "corp@petroenergy.example.com",
        phone: "21900000008",
        termApprovedAt: d("2025-02-28T08:00:00-03:00"),
        score: 800,
      },
    });

    await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(24),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "22071-900",
          streetAndNumber: "Rua Siqueira Campos, 45",
          neighborhood: "Copacabana",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Apto 601",
        },
        tag: "",
        description: "",
        rent: { rentCents: 350_000, condoCents: 52_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.DRAFTED,
        activatedAt: null,
        nextRenewalDate: "2027-09-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.ENVIADO },
          { key: "inspection", status: DOCUMENT_STATUS.PENDENTE },
          { key: "policy", status: DOCUMENT_STATUS.PENDENTE },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.PENDENTE,
        fullName: "Diego Mendonça Freitas",
        cpf: "24242424299",
        birthDate: "1993-08-17",
        email: "diego.freitas@example.com",
        phone: "21900000009",
        termApprovedAt: null,
        score: 520,
      },
    });

    await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(25),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "20040-020",
          streetAndNumber: "Av. Presidente Vargas, 500",
          neighborhood: "Centro",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Sala 204",
        },
        tag: "comercial",
        description: "",
        rent: { rentCents: 450_000, condoCents: 75_000, otherFeesCents: 10_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.DRAFTED,
        activatedAt: null,
        nextRenewalDate: "2027-10-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.PENDENTE },
          { key: "inspection", status: DOCUMENT_STATUS.PENDENTE },
          { key: "policy", status: DOCUMENT_STATUS.PENDENTE },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.PENDENTE,
        fullName: "Logística Carioca Ltda",
        entityType: "pj",
        cpf: "25252525000145",
        birthDate: "2012-04-01",
        email: "ops@logisticacarioca.example.com",
        phone: "21900000010",
        termApprovedAt: null,
        score: 480,
      },
    });

    await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(26),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "22421-030",
          streetAndNumber: "Rua Ataulfo de Paiva, 600",
          neighborhood: "Leblon",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Apto 11",
        },
        tag: "",
        description: "",
        rent: { rentCents: 270_000, condoCents: 40_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.CLOSED,
        closure: { reason: CLOSE_REASON.END_OF_LEASE, closedAt: d("2025-01-20T18:00:00-03:00") },
        activatedAt: d("2024-06-15T10:00:00-03:00"),
        nextRenewalDate: "2024-12-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Isabela Torres Viana",
        cpf: "26262626255",
        birthDate: "1986-02-14",
        email: "isabela.viana@example.com",
        phone: "21900000011",
        termApprovedAt: d("2022-12-01T10:00:00-03:00"),
        score: 700,
      },
    });

    await insertLeaseAndGuarantee({
      agencyId: atlanticaId,
      publicId: pid(27),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "20560-120",
          streetAndNumber: "Rua Conde de Bonfim, 300",
          neighborhood: "Tijuca",
          cityUF: "Rio de Janeiro/RJ",
          complement: "Apto 55",
        },
        tag: "",
        description: "Cancelado antes da assinatura.",
        rent: { rentCents: 310_000, condoCents: 45_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.CLOSED,
        closure: {
          reason: CLOSE_REASON.CANCELED_PRE_ACTIVATION,
          closedAt: d("2026-05-01T09:00:00-03:00"),
        },
        activatedAt: null,
        nextRenewalDate: "2026-06-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.PENDENTE },
          { key: "inspection", status: DOCUMENT_STATUS.PENDENTE },
          { key: "policy", status: DOCUMENT_STATUS.PENDENTE },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.REPROVADO,
        fullName: "Marcos Vinícius Santos",
        cpf: "27272727233",
        birthDate: "1990-06-20",
        email: "marcos.santos@example.com",
        phone: "21900000012",
        termApprovedAt: null,
        score: 420,
      },
    });

    // ── Leases + guarantees — Horizonte Imóveis (3) ───────────────────────────
    // 1 active, 1 in eviction (cover committed, reserved on capacity), 1 drafted

    const h1 = await insertLeaseAndGuarantee({
      agencyId: horizonteId,
      publicId: pid(28),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "30112-010",
          streetAndNumber: "Av. Afonso Pena, 2000",
          neighborhood: "Centro",
          cityUF: "Belo Horizonte/MG",
          complement: "Apto 901",
        },
        tag: "",
        description: "",
        rent: { rentCents: 340_000, condoCents: 48_000, otherFeesCents: 6_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.ACTIVE,
        activatedAt: d("2025-08-01T10:00:00-03:00"),
        nextRenewalDate: "2027-04-01",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Renata Campos Drumond",
        cpf: "28282828211",
        birthDate: "1991-03-05",
        email: "renata.drumond@example.com",
        phone: "31900000001",
        termApprovedAt: d("2025-04-01T10:00:00-03:00"),
        score: 760,
      },
    });

    // Cover Mutav paid on the commercial lease before it went to eviction:
    // reserved on the guarantee's capacity and recorded on the resolved notice.
    const HORIZONTE_COVER_APPLIED_CENTS = 525_000;

    const h2 = await insertLeaseAndGuarantee({
      agencyId: horizonteId,
      publicId: pid(29),
      lease: {
        propertyKind: PROPERTY_KIND.COMMERCIAL,
        property: {
          cep: "30140-110",
          streetAndNumber: "Rua da Bahia, 1148",
          neighborhood: "Funcionários",
          cityUF: "Belo Horizonte/MG",
          complement: "Sala 601",
        },
        tag: "comercial",
        description: "Escritório em edifício A+",
        rent: { rentCents: 500_000, condoCents: 85_000, otherFeesCents: 12_000 },
      },
      guarantee: {
        state: GUARANTEE_STATE.IN_EVICTION,
        activatedAt: d("2026-02-05T10:00:00-03:00"),
        reservedCents: HORIZONTE_COVER_APPLIED_CENTS,
        nextRenewalDate: "2026-10-15",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
          { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
          { key: "policy", status: DOCUMENT_STATUS.APROVADO },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.APROVADO,
        fullName: "Mineira Distribuidora Ltda",
        entityType: "pj",
        cpf: "29292929000113",
        birthDate: "2008-07-20",
        email: "financeiro@mineiradist.example.com",
        phone: "31900000002",
        termApprovedAt: d("2024-10-15T09:00:00-03:00"),
        score: 620,
      },
    });

    await insertLeaseAndGuarantee({
      agencyId: horizonteId,
      publicId: pid(30),
      lease: {
        propertyKind: PROPERTY_KIND.RESIDENTIAL,
        property: {
          cep: "30510-010",
          streetAndNumber: "Av. Raja Gabaglia, 3200",
          neighborhood: "Estoril",
          cityUF: "Belo Horizonte/MG",
          complement: "Apto 62",
        },
        tag: "",
        description: "",
        rent: { rentCents: 270_000, condoCents: 38_000, otherFeesCents: 0 },
      },
      guarantee: {
        state: GUARANTEE_STATE.DRAFTED,
        activatedAt: null,
        nextRenewalDate: "2027-08-10",
        documents: [
          { key: "rentalContract", status: DOCUMENT_STATUS.ENVIADO },
          { key: "inspection", status: DOCUMENT_STATUS.PENDENTE },
          { key: "policy", status: DOCUMENT_STATUS.PENDENTE },
        ],
      },
      tenant: {
        approvalStatus: TENANT_APPROVAL_STATUS.PENDENTE,
        fullName: "Felipe Augusto Corrêa",
        cpf: "30303030399",
        birthDate: "1998-01-25",
        email: "felipe.correa@example.com",
        phone: "31900000003",
        termApprovedAt: null,
        score: 540,
      },
    });

    await ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId: `DN-${h2.publicId}-2026-04-15`,
      guaranteeId: h2.guaranteeId,
      agencyId: horizonteId,
      status: DELINQUENCY_STATUS.RESOLVED,
      rentDueDate: "2026-04-15",
      originalAmountCents: 500_000,
      updatedAmountCents: HORIZONTE_COVER_APPLIED_CENTS,
      evidenceSource: NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED,
      openedAt: d("2026-04-20T09:00:00-03:00"),
      openedByUserId: horizonteOwnerId,
      verification: {
        verifiedAt: d("2026-04-30T14:00:00-03:00"),
        verifiedByUserId: args.staffUserId,
      },
      resolution: {
        kind: NOTICE_RESOLUTION_KIND.COVER_COMMITTED,
        resolvedAt: d("2026-05-05T15:00:00-03:00"),
        resolvedByUserId: args.staffUserId,
        coverOperationPublicId: "COV-2026-05-0001",
        appliedCoverCents: HORIZONTE_COVER_APPLIED_CENTS,
        note: "Cobertura paga; ação de despejo ajuizada em 2026-05-20.",
      },
    });

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
      const allGuarantees = await ctx.db.query("guarantees").collect();
      for (const doc of allGuarantees) {
        await insertGuaranteeAggregates(ctx, doc);
      }
    }

    // ── Guarantee history ─────────────────────────────────────────────────────

    await ctx.db.insert("guaranteeHistory", {
      agencyId: paulistaId,
      guaranteePublicId: pid(1),
      at: d("2025-03-01T09:00:00-03:00"),
      username: "admin.paulista",
      message:
        "Criada Solicitação #1000001 — residencial Bela Vista, inquilino Maria Silva Santos, aluguel R$ 3.200,00.",
    });
    await ctx.db.insert("guaranteeHistory", {
      agencyId: paulistaId,
      guaranteePublicId: pid(1),
      at: d("2025-03-01T17:00:00-03:00"),
      username: "admin.paulista",
      message: "Contrato 1000001 aprovado e ativado.",
    });

    await ctx.db.insert("guaranteeHistory", {
      agencyId: paulistaId,
      guaranteePublicId: pid(5),
      at: d("2025-01-20T10:00:00-03:00"),
      username: "admin.paulista",
      message:
        "Criada Solicitação #1000005 — comercial Vila Olímpia, inquilino Global Finance S.A.",
    });
    await ctx.db.insert("guaranteeHistory", {
      agencyId: paulistaId,
      guaranteePublicId: pid(5),
      at: d("2025-01-21T14:30:00-03:00"),
      username: "admin.paulista",
      message: "Contrato 1000005 aprovado e ativado.",
    });

    await ctx.db.insert("guaranteeHistory", {
      agencyId: atlanticaId,
      guaranteePublicId: pid(16),
      at: d("2025-03-15T09:00:00-03:00"),
      username: "admin.atlantica",
      message:
        "Criada Solicitação #1000016 — residencial Ipanema, inquilina Mariana Figueiredo Costa.",
    });
    await ctx.db.insert("guaranteeHistory", {
      agencyId: atlanticaId,
      guaranteePublicId: pid(16),
      at: d("2025-03-16T11:00:00-03:00"),
      username: "admin.atlantica",
      message: "Contrato 1000016 aprovado e ativado.",
    });

    await ctx.db.insert("guaranteeHistory", {
      agencyId: atlanticaId,
      guaranteePublicId: pid(27),
      at: d("2026-04-28T10:00:00-03:00"),
      username: "admin.atlantica",
      message:
        "Criada Solicitação #1000027 — residencial Tijuca, inquilino Marcos Vinícius Santos.",
    });
    await ctx.db.insert("guaranteeHistory", {
      agencyId: atlanticaId,
      guaranteePublicId: pid(27),
      at: d("2026-05-01T09:00:00-03:00"),
      username: "admin.atlantica",
      message: "Contrato 1000027 cancelado — inquilino reprovado na análise de crédito.",
    });

    await ctx.db.insert("guaranteeHistory", {
      agencyId: horizonteId,
      guaranteePublicId: pid(28),
      at: d("2025-04-01T10:00:00-03:00"),
      username: "admin.horizonte",
      message:
        "Criada Solicitação #1000028 — residencial Centro BH, inquilina Renata Campos Drumond.",
    });
    await ctx.db.insert("guaranteeHistory", {
      agencyId: horizonteId,
      guaranteePublicId: pid(28),
      at: d("2025-04-02T15:00:00-03:00"),
      username: "admin.horizonte",
      message: "Contrato 1000028 aprovado e ativado.",
    });

    // ── Historical payments (6 months: Nov 2025 – Apr 2026) ──────────────────
    // Paulista & Atlântica: all paid. Horizonte: paid Nov–Jan, overdue Feb–Apr.

    // Recurring line items bill each active guarantee's own priced fee
    // (`terms.feeCents`), the figure `generateMonthlyInvoices` uses, so seeded
    // history reconciles with what production billing would produce.
    const recurringLineItems = (rows: SeededLeaseAndGuarantee[], month: string) =>
      rows.map((row) => ({
        guaranteeId: row.guaranteeId,
        guaranteePublicId: row.publicId,
        kind: "recurring" as const,
        amountCents: row.terms.feeCents,
        description: `Mensalidade contrato ${row.publicId} — ${month}`,
      }));

    const paulistaLineItems = (month: string) =>
      recurringLineItems([p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12], month);
    const atlanticaLineItems = (month: string) =>
      recurringLineItems([a1, a2, a3, a4, a5, a6, a7, a8], month);
    const horizonteLineItems = (month: string) => recurringLineItems([h1, h2], month);

    // ── Nov 2025 ──────────────────────────────────────────────────────────────

    const p2025Nov = paulistaLineItems("2025-11");
    await seedPaidInvoice(ctx, {
      agencyId: paulistaId,
      publicId: "INV-2025-11-0100",
      periodMonth: "2025-11",
      issuedAt: "2025-11-01",
      dueDate: "2025-11-10",
      totalCents: p2025Nov.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2025-11-07T10:00:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: p2025Nov,
    });

    const a2025Nov = atlanticaLineItems("2025-11");
    await seedPaidInvoice(ctx, {
      agencyId: atlanticaId,
      publicId: "INV-2025-11-0200",
      periodMonth: "2025-11",
      issuedAt: "2025-11-01",
      dueDate: "2025-11-10",
      totalCents: a2025Nov.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2025-11-08T11:00:00-03:00"),
      method: SettlementMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202511081100abc001",
      ),
      lineItems: a2025Nov,
    });

    const h2025Nov = horizonteLineItems("2025-11");
    await seedPaidInvoice(ctx, {
      agencyId: horizonteId,
      publicId: "INV-2025-11-0300",
      periodMonth: "2025-11",
      issuedAt: "2025-11-01",
      dueDate: "2025-11-10",
      totalCents: h2025Nov.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2025-11-09T09:30:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: h2025Nov,
    });

    // ── Dec 2025 ──────────────────────────────────────────────────────────────

    const p2025Dec = paulistaLineItems("2025-12");
    await seedPaidInvoice(ctx, {
      agencyId: paulistaId,
      publicId: "INV-2025-12-0100",
      periodMonth: "2025-12",
      issuedAt: "2025-12-01",
      dueDate: "2025-12-10",
      totalCents: p2025Dec.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2025-12-05T14:00:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: p2025Dec,
    });

    const a2025Dec = atlanticaLineItems("2025-12");
    await seedPaidInvoice(ctx, {
      agencyId: atlanticaId,
      publicId: "INV-2025-12-0200",
      periodMonth: "2025-12",
      issuedAt: "2025-12-01",
      dueDate: "2025-12-10",
      totalCents: a2025Dec.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2025-12-08T10:00:00-03:00"),
      method: SettlementMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202512081000abc002",
      ),
      lineItems: a2025Dec,
    });

    const h2025Dec = horizonteLineItems("2025-12");
    await seedPaidInvoice(ctx, {
      agencyId: horizonteId,
      publicId: "INV-2025-12-0300",
      periodMonth: "2025-12",
      issuedAt: "2025-12-01",
      dueDate: "2025-12-10",
      totalCents: h2025Dec.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2025-12-09T09:00:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: h2025Dec,
    });

    // ── Jan 2026 ──────────────────────────────────────────────────────────────

    const p2026Jan = paulistaLineItems("2026-01");
    await seedPaidInvoice(ctx, {
      agencyId: paulistaId,
      publicId: "INV-2026-01-0100",
      periodMonth: "2026-01",
      issuedAt: "2026-01-02",
      dueDate: "2026-01-12",
      totalCents: p2026Jan.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-01-10T11:00:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: p2026Jan,
    });

    const a2026Jan = atlanticaLineItems("2026-01");
    await seedPaidInvoice(ctx, {
      agencyId: atlanticaId,
      publicId: "INV-2026-01-0200",
      periodMonth: "2026-01",
      issuedAt: "2026-01-02",
      dueDate: "2026-01-12",
      totalCents: a2026Jan.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-01-09T15:00:00-03:00"),
      method: SettlementMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202601091500abc003",
      ),
      lineItems: a2026Jan,
    });

    const h2026Jan = horizonteLineItems("2026-01");
    await seedPaidInvoice(ctx, {
      agencyId: horizonteId,
      publicId: "INV-2026-01-0300",
      periodMonth: "2026-01",
      issuedAt: "2026-01-02",
      dueDate: "2026-01-12",
      totalCents: h2026Jan.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-01-11T10:00:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: h2026Jan,
    });

    // ── Feb 2026 ──────────────────────────────────────────────────────────────

    const p2026Feb = paulistaLineItems("2026-02");
    await seedPaidInvoice(ctx, {
      agencyId: paulistaId,
      publicId: "INV-2026-02-0100",
      periodMonth: "2026-02",
      issuedAt: "2026-02-02",
      dueDate: "2026-02-10",
      totalCents: p2026Feb.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-02-07T09:00:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: p2026Feb,
    });

    const a2026Feb = atlanticaLineItems("2026-02");
    await seedPaidInvoice(ctx, {
      agencyId: atlanticaId,
      publicId: "INV-2026-02-0200",
      periodMonth: "2026-02",
      issuedAt: "2026-02-02",
      dueDate: "2026-02-10",
      totalCents: a2026Feb.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-02-09T14:00:00-03:00"),
      method: SettlementMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202602091400abc004",
      ),
      lineItems: a2026Feb,
    });

    const h2026Feb = horizonteLineItems("2026-02");
    await ctx.db.insert("invoices", {
      agencyId: horizonteId,
      publicId: "INV-2026-02-0300",
      periodMonth: "2026-02",
      issuedAt: "2026-02-02",
      dueDate: "2026-02-10",
      totalCents: h2026Feb.reduce((s, x) => s + x.amountCents, 0),
      state: InvoiceStates.open(),
      accessToken: generateInvoiceAccessToken(),
      accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
      muxedId: generateInvoiceMuxedId(),
      lineItems: h2026Feb,
    });

    // ── Mar 2026 ──────────────────────────────────────────────────────────────

    const p2026Mar = paulistaLineItems("2026-03");
    await seedPaidInvoice(ctx, {
      agencyId: paulistaId,
      publicId: "INV-2026-03-0100",
      periodMonth: "2026-03",
      issuedAt: "2026-03-02",
      dueDate: "2026-03-10",
      totalCents: p2026Mar.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-03-08T10:30:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: p2026Mar,
    });

    const a2026Mar = atlanticaLineItems("2026-03");
    await seedPaidInvoice(ctx, {
      agencyId: atlanticaId,
      publicId: "INV-2026-03-0200",
      periodMonth: "2026-03",
      issuedAt: "2026-03-02",
      dueDate: "2026-03-10",
      totalCents: a2026Mar.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-03-09T11:00:00-03:00"),
      method: SettlementMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202603091100abc005",
      ),
      lineItems: a2026Mar,
    });

    const h2026Mar = horizonteLineItems("2026-03");
    await ctx.db.insert("invoices", {
      agencyId: horizonteId,
      publicId: "INV-2026-03-0300",
      periodMonth: "2026-03",
      issuedAt: "2026-03-02",
      dueDate: "2026-03-10",
      totalCents: h2026Mar.reduce((s, x) => s + x.amountCents, 0),
      state: InvoiceStates.open(),
      accessToken: generateInvoiceAccessToken(),
      accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
      muxedId: generateInvoiceMuxedId(),
      lineItems: h2026Mar,
    });

    // ── Apr 2026 ──────────────────────────────────────────────────────────────
    // ── Apr 2026 ──────────────────────────────────────────────────────────────

    const paulistaAprLineItems = paulistaLineItems("2026-04");
    await seedPaidInvoice(ctx, {
      agencyId: paulistaId,
      publicId: "INV-2026-04-0100",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: paulistaAprLineItems.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-04-08T14:21:00-03:00"),
      method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000592000"),
      lineItems: paulistaAprLineItems,
    });

    const atlanticaAprLineItems = atlanticaLineItems("2026-04");
    await seedPaidInvoice(ctx, {
      agencyId: atlanticaId,
      publicId: "INV-2026-04-0200",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: atlanticaAprLineItems.reduce((s, x) => s + x.amountCents, 0),
      paidAt: d("2026-04-09T10:00:00-03:00"),
      method: SettlementMethods.pix(
        "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b5a8",
        "E00038166202404091000abc123",
      ),
      lineItems: atlanticaAprLineItems,
    });

    const horizonteAprLineItems = horizonteLineItems("2026-04");
    await ctx.db.insert("invoices", {
      agencyId: horizonteId,
      publicId: "INV-2026-04-0300",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: horizonteAprLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: InvoiceStates.open(),
      accessToken: generateInvoiceAccessToken(),
      accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
      muxedId: generateInvoiceMuxedId(),
      lineItems: horizonteAprLineItems,
    });

    const paulistaMayLineItems = paulistaLineItems("2026-05");
    await ctx.db.insert("invoices", {
      agencyId: paulistaId,
      publicId: "INV-2026-05-0100",
      periodMonth: "2026-05",
      issuedAt: "2026-05-01",
      dueDate: "2026-05-10",
      totalCents: paulistaMayLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: InvoiceStates.open(),
      accessToken: generateInvoiceAccessToken(),
      accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
      muxedId: generateInvoiceMuxedId(),
      lineItems: paulistaMayLineItems,
    });

    const atlanticaMayLineItems = atlanticaLineItems("2026-05");
    await ctx.db.insert("invoices", {
      agencyId: atlanticaId,
      publicId: "INV-2026-05-0200",
      periodMonth: "2026-05",
      issuedAt: "2026-05-01",
      dueDate: "2026-05-10",
      totalCents: atlanticaMayLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: InvoiceStates.open(),
      accessToken: generateInvoiceAccessToken(),
      accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
      muxedId: generateInvoiceMuxedId(),
      lineItems: atlanticaMayLineItems,
    });

    const horizonteMayLineItems = horizonteLineItems("2026-05");
    await ctx.db.insert("invoices", {
      agencyId: horizonteId,
      publicId: "INV-2026-05-0300",
      periodMonth: "2026-05",
      issuedAt: "2026-05-01",
      dueDate: "2026-05-10",
      totalCents: horizonteMayLineItems.reduce((s, x) => s + x.amountCents, 0),
      state: InvoiceStates.open(),
      accessToken: generateInvoiceAccessToken(),
      accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
      muxedId: generateInvoiceMuxedId(),
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
      guaranteeId: GuaranteeId;
      guaranteePublicId: string;
    }> = [
      { agencyId: paulistaId, guaranteeId: p1.guaranteeId, guaranteePublicId: pid(1) },
      { agencyId: atlanticaId, guaranteeId: a1.guaranteeId, guaranteePublicId: pid(16) },
      { agencyId: horizonteId, guaranteeId: h1.guaranteeId, guaranteePublicId: pid(28) },
    ];

    // 12 amounts in the safe band (R$5–R$50), four per agency.
    const testAmountsCents = [500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 4750, 5000];

    const testInvoices = testAmountsCents.map((amountCents, idx) => {
      const agency = testAgencies[idx % testAgencies.length];
      const n = String(idx + 1).padStart(3, "0");
      return {
        publicId: `INV-TEST-${n}`,
        agencyId: agency.agencyId,
        guaranteeId: agency.guaranteeId,
        guaranteePublicId: agency.guaranteePublicId,
        amountCents,
      };
    });

    for (const t of testInvoices) {
      await ctx.db.insert("invoices", {
        agencyId: t.agencyId,
        publicId: t.publicId,
        periodMonth: "2026-05",
        issuedAt: "2026-05-13",
        dueDate: "2026-05-20",
        totalCents: t.amountCents,
        state: InvoiceStates.open(),
        accessToken: generateInvoiceAccessToken(),
        accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
        muxedId: generateInvoiceMuxedId(),
        lineItems: [
          {
            guaranteeId: t.guaranteeId,
            guaranteePublicId: t.guaranteePublicId,
            kind: INVOICE_LINE_ITEM_KIND.RECURRING,
            amountCents: t.amountCents,
            description: `Testnet invoice — ${t.publicId}`,
          },
        ],
      });
    }

    return {
      agencies: { paulistaId, atlanticaId, horizonteId },
      guaranteeCounts: { paulista: 15, atlantica: 12, horizonte: 3 },
    };
  }
}

/**
 * Test personas — see `docs/test-personas.md`. Source of truth for the
 * Auth0 subject ↔ Convex user binding so seeds attach state to the
 * exact same identity the JWT will resolve to (no email-link dance).
 */
const PERSONA_KEYS = ["systemadmin", "agencyowner", "pendinguser", "newuser"] as const;
type PersonaKey = (typeof PERSONA_KEYS)[number];

const PERSONAS: Record<
  PersonaKey,
  {
    email: string;
    subject: string;
    name: string;
    staffRoles?: Array<"admin" | "compliance" | "support" | "treasury">;
    agency: { name: string; cnpj: string; state: "active" | "under_review" } | null;
  }
> = {
  systemadmin: {
    email: "systemadmin@mutav.finance",
    subject: "auth0|6a150df6a100fbf318f393c0",
    name: "Mutav Team",
    staffRoles: ["admin"],
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
    const patch: { subject?: string } = {};
    if (!byEmail.subject) patch.subject = persona.subject;
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
    });
  }

  // Idempotently grant declared Mutav-staff roles (one row per role).
  for (const role of persona.staffRoles ?? []) {
    const existing = await ctx.db
      .query("mutavStaff")
      .withIndex("by_user_role", (q) => q.eq("userId", userId).eq("role", role))
      .unique();
    if (!existing) {
      await ctx.db.insert("mutavStaff", { userId, role, createdAt: now });
    }
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

async function seedAllPersonas(ctx: MutationCtx): Promise<SeedPersonasResult> {
  const results: SeedPersonasResult = [];
  for (const key of PERSONA_KEYS) {
    results.push(await seedPersona(ctx, key));
  }
  return results;
}

/**
 * Idempotent persona-binding refresh — attaches the four Auth0 test
 * personas (and their agency state) to the current deployment WITHOUT
 * wiping anything. Safe to re-run; personas whose state already matches
 * are skipped. Use this after rotating the dev tenant's subjects, or to
 * repair persona bindings on a deployment that already holds data. For a
 * full reset use `seedReset`.
 *
 *   bunx convex run seed:seedTestPersonas
 */
export const seedTestPersonas = internalMutation({
  args: {},
  handler: async (ctx): Promise<SeedPersonasResult> => seedAllPersonas(ctx),
});

type SeedPersonasResult = Array<{
  persona: PersonaKey;
  userId: import("./_generated/dataModel").Id<"users">;
  agencyId: AgencyId | null;
  skipped?: boolean;
}>;

/**
 * Populate the `agencyowner` persona's agency ("Imobiliária Aprovada")
 * with a believable dashboard: one guarantee in each of `active`,
 * `in_arrears`, `default_verified` and `cover_committed` (each with the
 * notice that put it there), plus 1 drafted + 1 closed, every one on its
 * own lease; two months of paid history, one month due. Distinct
 * `publicId` range (1000031–1000036) so it doesn't collide with the
 * fictional Paulista/Atlântica/Horizonte ids.
 *
 * Idempotent — if a guarantee in the seeded range already exists, the
 * function is a no-op. Called only by `seedReset` (post-wipe) as the step
 * that gives the `agencyowner` persona a populated dashboard.
 */
async function populateAprovadaBook(
  ctx: MutationCtx,
  { agencyId, staffUserId }: { agencyId: AgencyId; staffUserId: UserId },
) {
  const FIRST_PID = 31;

  // Idempotency must be GLOBAL, not per-agency. publicId carries no
  // DB-level uniqueness constraint; this range (1000031–1000036) is the
  // single canonical Aprovada starter book — if any guarantee already
  // claims it, abort regardless of which agency owns it. Earlier the
  // check filtered by agencyId, which let `seedAprovadaContracts`
  // populate two agencies at the same publicIds and broke
  // `getByPublicId` (`.unique()` threw on duplicates).
  const existingAtFirstPid = await ctx.db
    .query("guarantees")
    .withIndex("by_publicId", (q) => q.eq("publicId", pid(FIRST_PID)))
    .first();
  if (existingAtFirstPid) {
    return { guaranteesInserted: 0, insuredCount: 0, skipped: true as const };
  }

  const product = await requireDefaultProduct(ctx);

  // Cover Mutav committed on the `cover_committed` row: reserved on the
  // guarantee's capacity and recorded on its resolved notice.
  const APROVADA_COVER_APPLIED_CENTS = 682_500;

  type AprovadaSpec = {
    n: number;
    state: Exclude<GuaranteeState, typeof GUARANTEE_STATE.CLOSED>;
    activatedAt: string | null;
    reservedCents?: number;
    nextRenewalDate: string;
    rentCents: number;
    condoCents: number;
    property: LeaseProperty;
    tenant: {
      fullName: string;
      cpf: string;
      birthDate: string;
      phoneSuffix: string;
      emailLocal: string;
      score: number;
    };
  };

  type AprovadaClosedSpec = Omit<AprovadaSpec, "state" | "activatedAt"> & {
    state: typeof GUARANTEE_STATE.CLOSED;
    activatedAt: string;
    closedAt: string;
  };

  const specs: Array<AprovadaSpec | AprovadaClosedSpec> = [
    {
      n: 0,
      state: GUARANTEE_STATE.ACTIVE,
      activatedAt: d("2025-09-15T10:00:00-03:00"),
      nextRenewalDate: "2027-09-15",
      rentCents: 285_000,
      condoCents: 42_000,
      property: {
        cep: "04543-011",
        streetAndNumber: "Rua Joaquim Floriano, 533",
        neighborhood: "Itaim Bibi",
        cityUF: "São Paulo/SP",
        complement: "Apto 82",
      },
      tenant: {
        fullName: "Beatriz Almeida Carvalho",
        cpf: "23232323200",
        birthDate: "1992-08-23",
        phoneSuffix: "31",
        emailLocal: "beatriz.almeida",
        score: 780,
      },
    },
    {
      n: 1,
      state: GUARANTEE_STATE.IN_ARREARS,
      activatedAt: d("2025-11-01T10:00:00-03:00"),
      nextRenewalDate: "2027-11-01",
      rentCents: 420_000,
      condoCents: 65_000,
      property: {
        cep: "01451-000",
        streetAndNumber: "Rua Oscar Freire, 1200",
        neighborhood: "Jardins",
        cityUF: "São Paulo/SP",
        complement: "Apto 1502",
      },
      tenant: {
        fullName: "Rafael Monteiro Lima",
        cpf: "32323232355",
        birthDate: "1985-04-17",
        phoneSuffix: "32",
        emailLocal: "rafael.monteiro",
        score: 820,
      },
    },
    {
      n: 2,
      state: GUARANTEE_STATE.DEFAULT_VERIFIED,
      activatedAt: d("2026-01-20T10:00:00-03:00"),
      nextRenewalDate: "2028-01-20",
      rentCents: 195_000,
      condoCents: 28_000,
      property: {
        cep: "05402-000",
        streetAndNumber: "Rua Cardeal Arcoverde, 1820",
        neighborhood: "Pinheiros",
        cityUF: "São Paulo/SP",
        complement: "Apto 41",
      },
      tenant: {
        fullName: "Letícia Andrade Pires",
        cpf: "42424242488",
        birthDate: "1994-11-30",
        phoneSuffix: "33",
        emailLocal: "leticia.andrade",
        score: 695,
      },
    },
    {
      n: 3,
      state: GUARANTEE_STATE.COVER_COMMITTED,
      reservedCents: APROVADA_COVER_APPLIED_CENTS,
      activatedAt: d("2026-03-10T10:00:00-03:00"),
      nextRenewalDate: "2028-03-10",
      rentCents: 650_000,
      condoCents: 98_000,
      property: {
        cep: "01310-100",
        streetAndNumber: "Av. Paulista, 2100",
        neighborhood: "Bela Vista",
        cityUF: "São Paulo/SP",
        complement: "Cobertura 18",
      },
      tenant: {
        fullName: "Fernanda Lopes Cavalcanti",
        cpf: "52525252500",
        birthDate: "1980-07-08",
        phoneSuffix: "34",
        emailLocal: "fernanda.lopes",
        score: 855,
      },
    },
    {
      n: 4,
      state: GUARANTEE_STATE.DRAFTED,
      activatedAt: null,
      nextRenewalDate: "2028-06-01",
      rentCents: 340_000,
      condoCents: 52_000,
      property: {
        cep: "04094-050",
        streetAndNumber: "Rua Vergueiro, 3800",
        neighborhood: "Vila Mariana",
        cityUF: "São Paulo/SP",
        complement: "Apto 73",
      },
      tenant: {
        fullName: "Gustavo Ribeiro Tavares",
        cpf: "62626262633",
        birthDate: "1989-02-14",
        phoneSuffix: "35",
        emailLocal: "gustavo.ribeiro",
        score: 610,
      },
    },
    {
      n: 5,
      state: GUARANTEE_STATE.CLOSED,
      activatedAt: d("2024-04-15T10:00:00-03:00"),
      closedAt: d("2026-03-31T18:00:00-03:00"),
      nextRenewalDate: "2026-04-15",
      rentCents: 225_000,
      condoCents: 38_000,
      property: {
        cep: "02011-000",
        streetAndNumber: "Rua Voluntários da Pátria, 990",
        neighborhood: "Santana",
        cityUF: "São Paulo/SP",
        complement: "Apto 22",
      },
      tenant: {
        fullName: "Bruno Tavares Macedo",
        cpf: "72727272766",
        birthDate: "1986-09-19",
        phoneSuffix: "36",
        emailLocal: "bruno.tavares",
        score: 705,
      },
    },
  ];

  const inserted: Array<{ spec: AprovadaSpec | AprovadaClosedSpec } & SeededLeaseAndGuarantee> = [];

  for (const spec of specs) {
    const publicId = pid(FIRST_PID + spec.n);
    const isApproved = spec.state !== GUARANTEE_STATE.DRAFTED;

    const row = await insertSeedLeaseAndGuarantee(ctx, {
      product,
      spec: {
        agencyId,
        publicId,
        lease: {
          propertyKind: PROPERTY_KIND.RESIDENTIAL,
          property: spec.property,
          tag: "",
          description: "",
          rent: {
            rentCents: spec.rentCents,
            condoCents: spec.condoCents,
            otherFeesCents: 0,
          },
        },
        guarantee: {
          state: spec.state,
          ...(spec.state === GUARANTEE_STATE.CLOSED
            ? {
                closure: {
                  reason: CLOSE_REASON.END_OF_LEASE,
                  closedAt: spec.closedAt,
                },
              }
            : {}),
          activatedAt: spec.activatedAt,
          nextRenewalDate: spec.nextRenewalDate,
          ...(spec.reservedCents === undefined ? {} : { reservedCents: spec.reservedCents }),
          documents: isApproved
            ? [
                { key: "rentalContract", status: DOCUMENT_STATUS.APROVADO },
                { key: "inspection", status: DOCUMENT_STATUS.APROVADO },
                { key: "policy", status: DOCUMENT_STATUS.APROVADO },
              ]
            : [
                { key: "rentalContract", status: DOCUMENT_STATUS.ENVIADO },
                { key: "inspection", status: DOCUMENT_STATUS.PENDENTE },
                { key: "policy", status: DOCUMENT_STATUS.PENDENTE },
              ],
        },
        tenant: {
          approvalStatus: isApproved
            ? TENANT_APPROVAL_STATUS.APROVADO
            : TENANT_APPROVAL_STATUS.PENDENTE,
          fullName: spec.tenant.fullName,
          cpf: spec.tenant.cpf,
          birthDate: spec.tenant.birthDate,
          email: `${spec.tenant.emailLocal}@example.com`,
          phone: `119000000${spec.tenant.phoneSuffix}`,
          termApprovedAt: isApproved ? (spec.activatedAt ?? d("2025-09-15T09:00:00-03:00")) : null,
          score: spec.tenant.score,
        },
      },
    });
    inserted.push({ spec, ...row });
  }

  // Every in-force guarantee bills its fee, arrears or not.
  const insuredRows = inserted.filter((r) => isInsured({ status: r.spec.state }));

  const monthlyLineItems = (month: string) =>
    insuredRows.map((r) => ({
      guaranteeId: r.guaranteeId,
      guaranteePublicId: r.publicId,
      kind: INVOICE_LINE_ITEM_KIND.RECURRING,
      amountCents: r.terms.feeCents,
      description: `Mensalidade contrato ${r.publicId} — ${month}`,
    }));

  const march = monthlyLineItems("2026-03");
  await seedPaidInvoice(ctx, {
    agencyId,
    publicId: "INV-2026-03-0500",
    periodMonth: "2026-03",
    issuedAt: "2026-03-01",
    dueDate: "2026-03-10",
    totalCents: march.reduce((s, x) => s + x.amountCents, 0),
    paidAt: d("2026-03-08T10:00:00-03:00"),
    method: SettlementMethods.pix(
      "00020126580014br.gov.bcb.pix0136a629532e-7693-4846-852d-1bbff817b500",
      "E00038166202603081000aprov01",
    ),
    lineItems: march,
  });

  const april = monthlyLineItems("2026-04");
  await seedPaidInvoice(ctx, {
    agencyId,
    publicId: "INV-2026-04-0500",
    periodMonth: "2026-04",
    issuedAt: "2026-04-01",
    dueDate: "2026-04-10",
    totalCents: april.reduce((s, x) => s + x.amountCents, 0),
    paidAt: d("2026-04-07T11:30:00-03:00"),
    method: SettlementMethods.boleto("34191.09008 63521.570001 61038.150000 8 97370000005920"),
    lineItems: april,
  });

  const may = monthlyLineItems("2026-05");
  await ctx.db.insert("invoices", {
    agencyId,
    publicId: "INV-2026-05-0500",
    periodMonth: "2026-05",
    issuedAt: "2026-05-01",
    dueDate: "2026-05-10",
    totalCents: may.reduce((s, x) => s + x.amountCents, 0),
    state: InvoiceStates.open(),
    accessToken: generateInvoiceAccessToken(),
    accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
    muxedId: generateInvoiceMuxedId(),
    lineItems: may,
  });

  for (const r of insuredRows) {
    await ctx.db.insert("guaranteeHistory", {
      agencyId,
      guaranteePublicId: r.publicId,
      at: r.spec.activatedAt ?? d("2025-09-15T09:00:00-03:00"),
      username: "agency.owner",
      message: `Criada Solicitação #${r.publicId} — ${r.spec.tenant.fullName}, aluguel R$ ${(r.spec.rentCents / 100).toLocaleString("pt-BR")}.`,
    });
  }

  // The notice book behind the Aprovada agency's in-force states — each
  // guarantee carries the notice that put it where it is, so the
  // delinquencies page renders every notice status out of the box.
  const ownerMembership = await ctx.db
    .query("memberships")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .filter((q) => q.eq(q.field("role"), "owner"))
    .first();
  const openedByUserId = ownerMembership?.userId;
  let noticesInserted = 0;
  if (openedByUserId && insuredRows.length >= 4) {
    const [cured, inArrears, defaultVerified, covered] = insuredRows;
    // publicIds mirror the openNotice mutation shape: DN-<guarantee>-<yyyy-mm-dd>
    // (day granularity, matching the by_guarantee_dueDate collision domain).
    await ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId: `DN-${cured.publicId}-2026-04-05`,
      guaranteeId: cured.guaranteeId,
      agencyId,
      status: DELINQUENCY_STATUS.RESOLVED,
      rentDueDate: "2026-04-05",
      originalAmountCents: cured.spec.rentCents,
      updatedAmountCents: Math.round(cured.spec.rentCents * 1.05),
      evidenceSource: NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED,
      openedAt: d("2026-04-08T10:00:00-03:00"),
      openedByUserId,
      resolution: {
        kind: NOTICE_RESOLUTION_KIND.TENANT_CURED,
        resolvedAt: d("2026-04-15T14:30:00-03:00"),
        resolvedByUserId: openedByUserId,
        note: "Inquilino quitou aluguel + encargos diretamente com o proprietário.",
      },
    });
    await ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId: `DN-${inArrears.publicId}-2026-06-05`,
      guaranteeId: inArrears.guaranteeId,
      agencyId,
      status: DELINQUENCY_STATUS.OPEN,
      rentDueDate: "2026-06-05",
      originalAmountCents: inArrears.spec.rentCents,
      updatedAmountCents: Math.round(inArrears.spec.rentCents * 1.02),
      evidenceSource: NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED,
      openedAt: d("2026-06-10T09:19:00-03:00"),
      openedByUserId,
    });
    await ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId: `DN-${defaultVerified.publicId}-2026-05-05`,
      guaranteeId: defaultVerified.guaranteeId,
      agencyId,
      status: DELINQUENCY_STATUS.VERIFIED,
      rentDueDate: "2026-05-05",
      originalAmountCents: defaultVerified.spec.rentCents,
      updatedAmountCents: Math.round(defaultVerified.spec.rentCents * 1.035),
      evidenceSource: NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED,
      openedAt: d("2026-05-14T18:14:00-03:00"),
      openedByUserId,
      verification: {
        verifiedAt: d("2026-05-28T11:05:00-03:00"),
        verifiedByUserId: staffUserId,
        note: "Inadimplência confirmada junto ao proprietário; sem acordo de quitação.",
      },
    });
    await ctx.db.insert("guaranteeDelinquencyNotices", {
      publicId: `DN-${covered.publicId}-2026-03-10`,
      guaranteeId: covered.guaranteeId,
      agencyId,
      status: DELINQUENCY_STATUS.RESOLVED,
      rentDueDate: "2026-03-10",
      originalAmountCents: covered.spec.rentCents,
      updatedAmountCents: APROVADA_COVER_APPLIED_CENTS,
      evidenceSource: NOTICE_EVIDENCE_SOURCE.AGENCY_REPORTED,
      openedAt: d("2026-03-16T09:40:00-03:00"),
      openedByUserId,
      verification: {
        verifiedAt: d("2026-03-27T16:20:00-03:00"),
        verifiedByUserId: staffUserId,
      },
      resolution: {
        kind: NOTICE_RESOLUTION_KIND.COVER_COMMITTED,
        resolvedAt: d("2026-04-02T10:15:00-03:00"),
        resolvedByUserId: staffUserId,
        coverOperationPublicId: "COV-2026-04-0001",
        appliedCoverCents: APROVADA_COVER_APPLIED_CENTS,
        note: "Cobertura paga ao proprietário; regresso contra o inquilino em andamento.",
      },
    });
    noticesInserted = 4;
  }

  return {
    guaranteesInserted: inserted.length,
    insuredCount: insuredRows.length,
    noticesInserted,
  };
}

/**
 * Give every seeded guarantee the tenant identity its own agency submitted,
 * the shape `guarantees.create` writes in production.
 *
 * Without it a seeded guarantee has no per-agency submission to resolve, and
 * the read paths would need a fallback to the shared `tenants` registry row —
 * which is the cross-agency disclosure this domain exists to prevent, not to
 * reproduce in the dev dataset. The seed gives each lease its own tenant, so
 * submission and registry agree here; what matters is that the *shape*
 * matches production so the read paths can fail closed.
 */
async function attachTenantSnapshots(ctx: MutationCtx): Promise<void> {
  for (const guarantee of await ctx.db.query("guarantees").collect()) {
    const lease = await ctx.db.get(guarantee.leaseId);
    if (!lease) continue;
    const tenant = await ctx.db.get(lease.tenantId);
    if (!tenant) continue;

    const snapshot =
      tenant.entityType === "pf"
        ? {
            entityType: "pf" as const,
            taxId: tenant.taxId,
            fullName: tenant.fullName,
            email: tenant.email,
            phone: tenant.phone,
            birthDate: tenant.birthDate,
          }
        : {
            entityType: "pj" as const,
            taxId: tenant.taxId,
            fullName: tenant.fullName,
            email: tenant.email,
            phone: tenant.phone,
            ...(tenant.contactCpf === undefined ? {} : { contactCpf: tenant.contactCpf }),
          };

    // Earliest row is the creation event for seeded data, which is written
    // here in one pass. Readers must NOT select this way — they find the row
    // that carries a snapshot, because a later row can sort earlier.
    const creation = await ctx.db
      .query("guaranteeHistory")
      .withIndex("by_agency_guarantee", (q) =>
        q.eq("agencyId", guarantee.agencyId).eq("guaranteePublicId", guarantee.publicId),
      )
      .first();

    if (creation) {
      await ctx.db.patch(creation._id, { tenantSnapshot: snapshot });
      continue;
    }

    // Pricing dates the record for every state (drafts included), so the
    // synthesized creation event never lands after an activation or closure.
    await ctx.db.insert("guaranteeHistory", {
      agencyId: guarantee.agencyId,
      guaranteePublicId: guarantee.publicId,
      at: guarantee.terms.appliedAt,
      username: "seed",
      message: `Criada Solicitação #${guarantee.publicId}.`,
      tenantSnapshot: snapshot,
    });
  }
}

/**
 * Days between a committed cover and the eviction filing in the demo book.
 *
 * Nothing in the schema dates an eviction: neither `guarantees` nor the notice
 * table carries the filing, and the structured `guaranteeHistory.transition`
 * row written here is the only place it can live. So the seed derives it from
 * the cover it follows rather than inventing a free-floating date — 15 days is
 * the interval the Horizonte book's own resolution note already describes.
 */
const EVICTION_FILED_AFTER_COVER_DAYS = 15;

/**
 * Add whole days to a seed timestamp, keeping its clock time. Inputs come from
 * `d()` and are therefore already UTC `Z` strings, so the rebuilt value stays
 * in the one format the timeline compares lexically.
 */
function seedDaysAfter(at: string, days: number): string {
  const [datePart, timePart] = at.split("T");
  if (!datePart || !timePart) throw new Error(`Seed timestamp "${at}" is not a full ISO timestamp`);
  const shifted = new Date(`${datePart}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return `${shifted.toISOString().slice(0, 10)}T${timePart}`;
}

type SeedNotice = Doc<"guaranteeDelinquencyNotices">;

type NoticeEvent = {
  at: string;
  /** `settled` is either disposition that ends a notice: resolution or cancellation. */
  kind: "opened" | "verified" | "settled";
  noticePublicId: string;
  /** Guarantee state this event moves to, or null when it moves nothing. */
  to: GuaranteeState | null;
  message: string;
};

type PlannedTransition = {
  at: string;
  from: GuaranteeState;
  to: GuaranteeState;
  closeReason?: CloseReason;
  message: string;
};

/** Flatten one notice into the timestamped events that moved its guarantee. */
function noticeEventsFor(notice: SeedNotice): NoticeEvent[] {
  const events: NoticeEvent[] = [
    {
      at: notice.openedAt,
      kind: "opened",
      noticePublicId: notice.publicId,
      to: GUARANTEE_STATE.IN_ARREARS,
      message: `Aviso de inadimplência ${notice.publicId} aberto pela imobiliária.`,
    },
  ];
  if (notice.verification) {
    events.push({
      at: notice.verification.verifiedAt,
      kind: "verified",
      noticePublicId: notice.publicId,
      to: GUARANTEE_STATE.DEFAULT_VERIFIED,
      message: `Inadimplência do aviso ${notice.publicId} verificada pela Mutav.`,
    });
  }
  if (notice.resolution) {
    const isCover = notice.resolution.kind === NOTICE_RESOLUTION_KIND.COVER_COMMITTED;
    const isCured = notice.resolution.kind === NOTICE_RESOLUTION_KIND.TENANT_CURED;
    events.push({
      at: notice.resolution.resolvedAt,
      kind: "settled",
      noticePublicId: notice.publicId,
      // A stale or disputed notice ends without curing the guarantee — the same
      // asymmetry the delinquency mutations enforce.
      to: isCover ? GUARANTEE_STATE.COVER_COMMITTED : isCured ? GUARANTEE_STATE.ACTIVE : null,
      message: isCover
        ? `Cobertura comprometida para o aviso ${notice.publicId}.`
        : `Aviso ${notice.publicId} resolvido (${notice.resolution.kind}).`,
    });
  }
  if (notice.cancellation) {
    events.push({
      at: notice.cancellation.canceledAt,
      kind: "settled",
      noticePublicId: notice.publicId,
      to: GUARANTEE_STATE.ACTIVE,
      message: `Aviso ${notice.publicId} cancelado (${notice.cancellation.reason}).`,
    });
  }
  return events;
}

/**
 * Replay a seeded guarantee's own record into the transition path that produced
 * it: activation from `activatedAt`, the arrears / verification / cover hops
 * from its notices, the eviction filing, and the closure.
 *
 * Notice-driven hops the machine refuses are skipped rather than forced — that
 * is what the production mutations do (a notice opened on a guarantee already
 * in arrears is still recorded; the guarantee does not move). Hops read off the
 * guarantee row itself (activation, eviction, closure) are never skipped: an
 * illegal one means the seed data is wrong, so it throws.
 */
function planGuaranteeTransitions(
  guarantee: Guarantee,
  notices: readonly SeedNotice[],
): PlannedTransition[] {
  const planned: PlannedTransition[] = [];

  // The path itself carries the running state — a separate mutable variable
  // would be narrowed to its initializer by every read after a closure writes it.
  const currentState = (): GuaranteeState => {
    if (planned.length === 0) return GUARANTEE_STATE.DRAFTED;
    return planned[planned.length - 1].to;
  };

  const push = (
    at: string,
    to: GuaranteeState,
    message: string,
    closeReason?: CloseReason,
  ): void => {
    planned.push({
      at,
      from: currentState(),
      to,
      message,
      ...(closeReason === undefined ? {} : { closeReason }),
    });
  };

  const pushStructural = (
    at: string,
    to: GuaranteeState,
    message: string,
    closeReason?: CloseReason,
  ): void => {
    const allowed = assertTransition(currentState(), to);
    if (!allowed.success) {
      throw new Error(`Seed guarantee ${guarantee.publicId}: ${allowed.message}`);
    }
    push(at, to, message, closeReason);
  };

  if (guarantee.activatedAt) {
    pushStructural(
      guarantee.activatedAt,
      GUARANTEE_STATE.ACTIVE,
      `Garantia ${guarantee.publicId} ativada.`,
    );
  }

  const events = notices
    .flatMap(noticeEventsFor)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const outstanding = new Set<string>();
  for (const event of events) {
    if (event.kind === "opened") outstanding.add(event.noticePublicId);
    if (event.kind === "settled") outstanding.delete(event.noticePublicId);
    if (event.to === null) continue;
    // `openNotice` moves the guarantee only from `active`; one filed while it
    // is already past that records the notice and leaves the state alone. The
    // machine would accept `cover_committed → in_arrears`, so without this the
    // seed could lay down a path production has no way to write.
    if (event.kind === "opened" && currentState() !== GUARANTEE_STATE.ACTIVE) continue;
    // A guarantee leaves arrears only once nothing else is still outstanding —
    // the rule the delinquency mutations apply before returning it to active.
    if (event.to === GUARANTEE_STATE.ACTIVE && outstanding.size > 0) continue;
    if (event.to === currentState()) continue;
    if (!assertTransition(currentState(), event.to).success) continue;
    push(event.at, event.to, event.message);
  }

  if (
    guarantee.status === GUARANTEE_STATE.IN_EVICTION &&
    currentState() !== GUARANTEE_STATE.IN_EVICTION
  ) {
    const last = planned[planned.length - 1];
    if (!last) {
      throw new Error(
        `Seed guarantee ${guarantee.publicId} is in eviction but was never activated`,
      );
    }
    pushStructural(
      seedDaysAfter(last.at, EVICTION_FILED_AFTER_COVER_DAYS),
      GUARANTEE_STATE.IN_EVICTION,
      `Ação de despejo ajuizada para a garantia ${guarantee.publicId}.`,
    );
  }

  if (guarantee.closure) {
    const closing = assertClose(currentState(), guarantee.closure.reason);
    if (!closing.success) {
      throw new Error(`Seed guarantee ${guarantee.publicId}: ${closing.message}`);
    }
    pushStructural(
      guarantee.closure.closedAt,
      GUARANTEE_STATE.CLOSED,
      `Garantia ${guarantee.publicId} encerrada (${guarantee.closure.reason}).`,
      guarantee.closure.reason,
    );
  }

  const replayedState = currentState();
  if (replayedState !== guarantee.status) {
    throw new Error(
      `Seed guarantee ${guarantee.publicId}: replayed path ends in "${replayedState}" but the row is "${guarantee.status}"`,
    );
  }
  for (let i = 1; i < planned.length; i++) {
    const previous = planned[i - 1];
    const current = planned[i];
    if (current.at < previous.at) {
      throw new Error(
        `Seed guarantee ${guarantee.publicId}: the transition to "${current.to}" is dated before the one it follows`,
      );
    }
  }
  return planned;
}

/**
 * Give every seeded guarantee the structured transition history the lifecycle
 * writes in production, so the state timeline has a real path instead of one
 * flat step at today's status.
 *
 * Runs last in `seedReset`, after `attachTenantSnapshots`: that pass claims the
 * EARLIEST history row as the creation event and must find the free-text
 * creation row (or synthesize one), never a transition.
 */
async function attachGuaranteeTransitionHistory(ctx: MutationCtx): Promise<number> {
  let inserted = 0;
  for (const guarantee of await ctx.db.query("guarantees").collect()) {
    const notices = await ctx.db
      .query("guaranteeDelinquencyNotices")
      .withIndex("by_guarantee_dueDate", (q) => q.eq("guaranteeId", guarantee._id))
      .collect();

    for (const transition of planGuaranteeTransitions(guarantee, notices)) {
      await ctx.db.insert("guaranteeHistory", {
        agencyId: guarantee.agencyId,
        guaranteePublicId: guarantee.publicId,
        at: transition.at,
        username: "seed",
        message: transition.message,
        transition: {
          from: transition.from,
          to: transition.to,
          ...(transition.closeReason === undefined ? {} : { closeReason: transition.closeReason }),
        },
      });
      inserted++;
    }
  }
  return inserted;
}

/**
 * One-shot full reset — the universal "give me a clean, fully-populated
 * dev DB" command. Wipes the demo tables, seeds the default product,
 * attaches the four Auth0 test personas (the `systemadmin` one signs the
 * staff-side notice dispositions in the dataset), re-seeds the fictional
 * dataset, and tops the `agencyowner` persona's agency ("Imobiliária Aprovada")
 * with a small believable guarantee book so logging in as that persona
 * lands on a populated dashboard. This is what the Vercel preview hook
 * (`scripts/seed-preview.sh`) and a developer's local reset both call.
 *
 * Every step runs as a plain in-process call inside this single mutation,
 * so the whole reset is one atomic Convex transaction — the same
 * footprint the earlier `ctx.runMutation` chaining produced, minus the
 * partial-seed footgun of exposing the intermediate steps as their own
 * runnable entrypoints.
 *
 * Dev-only. Do NOT call from production.
 */
export const seedReset = internalMutation({
  args: { adminEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await wipeDemoTables(ctx);
    const product = await seedDefaultProduct(ctx);
    const personas = await seedAllPersonas(ctx);
    const staffUserId = personas.find((p) => p.persona === "systemadmin")?.userId;
    if (!staffUserId) throw new Error("seedReset requires the systemadmin persona");
    const fictional = await seedFictional(ctx, { ...args, staffUserId });

    const aprovadaAgencyId = personas.find((p) => p.persona === "agencyowner")?.agencyId;
    const aprovada = aprovadaAgencyId
      ? await populateAprovadaBook(ctx, { agencyId: aprovadaAgencyId, staffUserId })
      : null;

    await attachTenantSnapshots(ctx);
    const transitionRows = await attachGuaranteeTransitionHistory(ctx);

    return { product: product.slug, fictional, personas, aprovada, transitionRows };
  },
});
