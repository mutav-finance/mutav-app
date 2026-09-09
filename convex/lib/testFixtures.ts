import type { convexTest, TestConvex } from "convex-test";
import type schema from "../schema";
import type { AgencyId } from "../agencies/domain";
import {
  CLOSE_REASON,
  DEFAULT_GUARANTEE_PLAN,
  DOCUMENT_KEY,
  DOCUMENT_STATUS,
  GUARANTEE_STATE,
  SCORE_TIER,
  TENANT_APPROVAL_STATUS,
  tierForScore,
  type CloseReason,
  type GuaranteeId,
  type GuaranteePlan,
  type GuaranteeState,
  type PriceableTier,
} from "../guarantees/domain";
import { DEFAULT_PRICING_TABLE, priceGuarantee } from "../guarantees/pricing";
import { insertGuaranteeAggregates } from "../guarantees/aggregateWrites";
import { DEFAULT_PAYER, PROPERTY_KIND, type LeaseId } from "../leases/domain";
import { DEFAULT_PRODUCT_SLUG, type ProductId } from "../products/domain";
import type { TenantId } from "../tenants/domain";
import { hashPii } from "./pii";
import aggregateComponentSchema from "../../node_modules/@convex-dev/aggregate/src/component/schema";
import migrationsComponentSchema from "../../node_modules/@convex-dev/migrations/src/component/schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

export const TEST_USER_SUBJECT = "auth0|test-user";

/**
 * Register the three guarantee aggregate components used by production code
 * paths. Mirrors the `app.use(aggregate, { name })` calls in
 * `convex.config.ts`. Tests that exercise mutations writing to aggregates
 * MUST call this on their `convexTest` instance before invoking the code.
 */
export function registerContractAggregateComponents(t: ReturnType<typeof convexTest>): void {
  const componentGlob = import.meta.glob(
    "../../node_modules/@convex-dev/aggregate/src/component/**/*.ts",
  );
  for (const name of [
    "contractsByStatus",
    "contractsByStatusPlatform",
    "ativoInsuredCentsPlatform",
  ]) {
    t.registerComponent(name, aggregateComponentSchema, componentGlob);
  }
}

/**
 * Register the `@convex-dev/migrations` component used by the deploy-time
 * migration runner. Mirrors `app.use(migrations)` in `convex.config.ts`. Tests
 * that run a `migrations.define`-based migration MUST call this on their
 * `convexTest` instance before invoking it.
 */
export function registerMigrationsComponent(t: ReturnType<typeof convexTest>): void {
  const componentGlob = import.meta.glob(
    "../../node_modules/@convex-dev/migrations/src/component/**/*.ts",
  );
  t.registerComponent("migrations", migrationsComponentSchema, componentGlob);
}

type SeedUserOptions = {
  subject?: string;
  email?: string;
  name?: string;
};

export async function seedAuthenticatedUser(
  t: ReturnType<typeof convexTest>,
  options: SeedUserOptions = {},
) {
  const subject = options.subject ?? TEST_USER_SUBJECT;
  return t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: `user-${subject.replace(/[^a-zA-Z0-9-]/g, "-")}`,
      subject,
      name: options.name ?? "Test User",
      email: options.email ?? "test@mutav.test",
      createdAt: new Date().toISOString(),
    }),
  );
}

export async function setupAuthenticatedUser(
  t: ReturnType<typeof convexTest>,
  options: SeedUserOptions = {},
) {
  const userId = await seedAuthenticatedUser(t, options);
  const subject = options.subject ?? TEST_USER_SUBJECT;
  const asUser = t.withIdentity({ subject });
  return { asUser, userId, subject };
}

export type SeededUserId = Awaited<ReturnType<typeof seedAuthenticatedUser>>;

export async function seedAgencyWithMembership(
  t: ReturnType<typeof convexTest>,
  userId: SeededUserId,
) {
  return t.run(async (ctx) => {
    const agencyId = await ctx.db.insert("agencies", {
      name: "Mutav Test Agency",
      cnpj: "00000000000100",
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    });
    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: "owner",
      joinedAt: new Date().toISOString(),
    });
    return agencyId;
  });
}

export async function seedForeignAgency(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name: "Foreign Agency",
      cnpj: "00000000000200",
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    }),
  );
}

/**
 * Record a fresh, successful credit assessment for a tenant document.
 *
 * `guarantees.create` re-reads the score from this row rather than trusting the
 * caller, so any test that creates a guarantee has to establish the assessment
 * the agency would really have pulled first.
 */
export async function seedFreshCreditAssessment(
  t: ReturnType<typeof convexTest>,
  args: { agencyId: AgencyId; document: string; score: number },
) {
  const subjectHash = await hashPii(args.document.replace(/\D/g, ""));
  return t.run((ctx) =>
    ctx.db.insert("creditAnalysisAssessments", {
      agencyId: args.agencyId,
      subjectType: "tenant",
      subjectHash,
      policyVersion: "test",
      signalIds: [],
      status: "ok",
      score: args.score,
      tier: tierForScore(args.score),
      assessedAt: Date.now(),
    }),
  );
}

/**
 * The one default product the seed ships (`mutav-fianca`, today's pricing
 * constants). Idempotent: returns the existing row's id when it is already
 * there, so a test may call it before every guarantee it seeds.
 */
export async function seedDefaultProduct(t: TestConvex<typeof schema>): Promise<ProductId> {
  return t.run(async (ctx) => {
    const existing = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_PRODUCT_SLUG))
      .unique();
    if (existing) return existing._id;
    return ctx.db.insert("products", {
      slug: DEFAULT_PRODUCT_SLUG,
      name: "Mutav Fiança",
      enabled: true,
      isDefault: true,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      terms: DEFAULT_PRICING_TABLE,
      eligibility: { agencyIds: null, regionUFs: null, minTier: null, propertyKinds: null },
    });
  });
}

export type SeedGuaranteeSpec = {
  agencyId: AgencyId;
  status: GuaranteeState;
  rentCents?: number;
  plan?: GuaranteePlan;
  tier?: PriceableTier;
  /** Overrides the priced `capacity.availableCents` (draws already taken). */
  availableCents?: number;
  activatedAt?: string | null;
  closedAt?: string;
  closeReason?: CloseReason;
  nextRenewalDate?: string;
  tenantTaxId?: string;
  /** `false` leaves the row out of the aggregates (backfill / dual-write tests). */
  indexInAggregates?: boolean;
};

export type SeededGuarantee = {
  guaranteeId: GuaranteeId;
  leaseId: LeaseId;
  tenantId: TenantId;
  productId: ProductId;
};

/**
 * Insert a tenant, a lease and one guarantee priced through the default
 * product, then register the guarantee in every aggregate. Mirrors the write
 * path of `guarantees.create` closely enough for read-side and aggregate
 * tests; use the real mutation when the test is about `create` itself.
 */
export async function seedGuaranteeWithLease(
  t: TestConvex<typeof schema>,
  spec: SeedGuaranteeSpec,
  publicId: string,
): Promise<SeededGuarantee> {
  const productId = await seedDefaultProduct(t);
  return t.run(async (ctx) => {
    const product = await ctx.db.get(productId);
    if (!product) throw new Error("default product seed lost");
    const rentCents = spec.rentCents ?? 100_000;
    const tier = spec.tier ?? SCORE_TIER.BOM;
    const tenantId = await ctx.db.insert("tenants", {
      entityType: "pf",
      taxId: spec.tenantTaxId ?? "11144477735",
      fullName: "Test Tenant",
      birthDate: "1990-01-01",
      email: "tenant@test.br",
      phone: "11999999999",
    });
    const leaseId = await ctx.db.insert("leases", {
      agencyId: spec.agencyId,
      publicId: `LSE-${publicId}`,
      tenantId,
      propertyKind: PROPERTY_KIND.RESIDENTIAL,
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo/SP",
        complement: "",
      },
      tag: "",
      description: "",
      rent: { rentCents, condoCents: 0, otherFeesCents: 0, totalRentCents: rentCents },
      payer: DEFAULT_PAYER,
      openGuaranteeId: null,
    });
    const priced = priceGuarantee(
      {
        rentCents,
        tier,
        plan: spec.plan ?? DEFAULT_GUARANTEE_PLAN,
        productSlug: product.slug,
        appliedAt: "2026-01-01T00:00:00.000Z",
      },
      product.terms,
    );
    const availableCents = spec.availableCents ?? priced.capacity.availableCents;
    const closure =
      spec.status === GUARANTEE_STATE.CLOSED
        ? {
            reason: spec.closeReason ?? CLOSE_REASON.END_OF_LEASE,
            closedAt: spec.closedAt ?? "2026-06-01T00:00:00.000Z",
          }
        : undefined;
    const guaranteeId = await ctx.db.insert("guarantees", {
      agencyId: spec.agencyId,
      leaseId,
      publicId,
      productId,
      status: spec.status,
      ...(closure ? { closure } : {}),
      activatedAt: spec.activatedAt ?? null,
      nextRenewalDate: spec.nextRenewalDate ?? "2026-12-31",
      underwriting: { score: 750, tier },
      tenantApproval: { status: TENANT_APPROVAL_STATUS.PENDENTE, termApprovedAt: null },
      terms: priced.terms,
      capacity: {
        ceilingCents: priced.capacity.ceilingCents,
        availableCents,
        reservedCents: priced.capacity.ceilingCents - availableCents,
      },
      documents: [
        { key: DOCUMENT_KEY.RENTAL_CONTRACT, status: DOCUMENT_STATUS.PENDENTE },
        { key: DOCUMENT_KEY.INSPECTION, status: DOCUMENT_STATUS.PENDENTE },
        { key: DOCUMENT_KEY.POLICY, status: DOCUMENT_STATUS.PENDENTE },
      ],
    });
    if (spec.status !== GUARANTEE_STATE.CLOSED) {
      await ctx.db.patch(leaseId, { openGuaranteeId: guaranteeId });
    }
    if (spec.indexInAggregates ?? true) {
      const doc = await ctx.db.get(guaranteeId);
      if (!doc) throw new Error("guarantee seed lost");
      await insertGuaranteeAggregates(ctx, doc);
    }
    return { guaranteeId, leaseId, tenantId, productId };
  });
}
