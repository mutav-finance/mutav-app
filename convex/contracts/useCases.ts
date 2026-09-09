// Temporary facade: keeps `api.contracts.useCases.*` — the names, args and
// return shapes the agency app was built against — alive over the new
// `guarantees` / `leases` domains until PR4 moves the UI. The seven guarantee
// states are projected back onto the four legacy contract statuses through
// `toLegacyStatus`. Deleted in PR4 — add nothing here.
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { api } from "../_generated/api";
import { query, type QueryCtx } from "../_generated/server";
import type { AgencyId } from "../agencies/domain";
import { assertAgencyAccess, mutationWithAgencyScope, queryWithAgencyScope } from "../lib/auth";
import type { Result } from "../lib/result";
import {
  expiringRenewalBounds,
  getUrgencyTier,
  GUARANTEE_ERROR_CODE,
  GUARANTEE_STATE,
  guaranteePlanValidator,
  urgencySortKey,
  type ContractApplicationId,
  type Guarantee,
  type GuaranteeHistory,
  type GuaranteeId,
} from "../guarantees/domain";
import {
  LEGACY_CONTRACT_STATUS,
  toLegacyStatus,
  type LegacyContractStatus,
} from "../guarantees/legacyStatus";
import { agencySubmittedTenant } from "../guarantees/tenantIdentity";
import type { Lease } from "../leases/domain";
import { PRODUCT_ERROR_CODE } from "../products/domain";
import {
  TENANT_ERROR_CODE,
  tenantEntityTypeValidator,
  type Tenant,
  type TenantInput,
} from "../tenants/domain";
import {
  propertyKindValidator,
  toLeasePropertyKind,
  toLegacyPayer,
  toLegacyPropertyKind,
} from "./domain";

export {
  getActivityByPeriod,
  getCachedCreditScore,
  requestCreditScore,
} from "../guarantees/useCases";

function legacyStatusOf(doc: Pick<Guarantee, "status" | "closure">): LegacyContractStatus {
  return toLegacyStatus(doc.status, doc.closure?.reason);
}

const LEGACY_SETUP_INSTALLMENTS = 1;
const HISTORY_PAGE_CAP = 100;

function shapeContractTenant(doc: Guarantee, identity: Tenant | TenantInput) {
  const shared = {
    approvalStatus: doc.tenantApproval.status,
    termApprovedAt: doc.tenantApproval.termApprovedAt,
    taxId: identity.taxId,
    fullName: identity.fullName,
    email: identity.email,
    phone: identity.phone,
  };
  if (identity.entityType === "pj") {
    return { ...shared, entityType: "pj" as const, contactCpf: identity.contactCpf };
  }
  return { ...shared, entityType: "pf" as const, birthDate: identity.birthDate };
}

function shapeContract({
  guarantee,
  lease,
  identity,
  history,
}: {
  guarantee: Guarantee;
  lease: Lease;
  identity: Tenant | TenantInput;
  history: GuaranteeHistory[];
}) {
  const { complement, ...property } = lease.property;
  return {
    id: guarantee.publicId,
    agencyId: guarantee.agencyId,
    status: legacyStatusOf(guarantee),
    nextRenewalDate: guarantee.nextRenewalDate,
    availableGuaranteeCents: guarantee.capacity.availableCents,
    rental: {
      propertyKind: toLegacyPropertyKind(lease.propertyKind),
      plan: guarantee.terms.plan,
      rentCents: lease.rent.rentCents,
      condoCents: lease.rent.condoCents,
      otherFeesCents: lease.rent.otherFeesCents,
      totalRentCents: lease.rent.totalRentCents,
      feeCents: guarantee.terms.feeCents,
      oneTimeActivationFeeCents: guarantee.terms.oneTimeActivationFeeCents,
      setupInstallments: LEGACY_SETUP_INSTALLMENTS,
      exitCostMultiplier: `${guarantee.terms.exitCostMultiplier}x`,
      rentMultiplier: `${guarantee.terms.coverageCeilingMultiplier}x`,
      payer: toLegacyPayer(lease.payer),
      pviMigrationSchedule: null,
    },
    property,
    optional: { complement, tag: lease.tag, description: lease.description },
    documents: guarantee.documents,
    tenant: shapeContractTenant(guarantee, identity),
    history: history.map((h) => ({ at: h.at, username: h.username, message: h.message })),
  };
}

// Reads the row directly instead of `ctx.runQuery(api.guarantees…)`: a facade
// whose return type derives from `api` makes `api.d.ts` circular and every
// `api.*` type in the repo collapses to `any`.
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .collect();

    for (const guarantee of candidates) {
      try {
        await assertAgencyAccess(ctx, guarantee.agencyId);
      } catch {
        continue;
      }

      const lease = await ctx.db.get(guarantee.leaseId);
      if (!lease) {
        throw new Error(`Guarantee ${guarantee.publicId} references a missing leases row`);
      }
      const history = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_agency_guarantee", (q) =>
          q.eq("agencyId", guarantee.agencyId).eq("guaranteePublicId", args.publicId),
        )
        .order("desc")
        .take(HISTORY_PAGE_CAP);
      const submitted = await agencySubmittedTenant(ctx, guarantee);
      if (!submitted) {
        throw new Error(`Guarantee ${guarantee.publicId} has no tenant submission of its own`);
      }

      return shapeContract({ guarantee, lease, identity: submitted, history });
    }

    return null;
  },
});

async function tenantNamesByGuarantee(
  ctx: QueryCtx,
  docs: readonly Guarantee[],
): Promise<Map<GuaranteeId, string>> {
  const names = new Map<GuaranteeId, string>();
  await Promise.all(
    docs.map(async (doc) => {
      const submitted = await agencySubmittedTenant(ctx, doc);
      names.set(doc._id, submitted?.fullName ?? "");
    }),
  );
  return names;
}

const REFERENCE_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function resolveReferenceDate(input: string | undefined): string {
  return input && REFERENCE_DATE_PATTERN.test(input)
    ? input
    : new Date().toISOString().slice(0, 10);
}

const CONTRACT_TAB = {
  ALL: "all",
  EXPIRING: "expiring",
  ...LEGACY_CONTRACT_STATUS,
} as const;
type ContractTab = (typeof CONTRACT_TAB)[keyof typeof CONTRACT_TAB];
const contractTabValidator = v.union(
  v.literal(CONTRACT_TAB.ALL),
  v.literal(CONTRACT_TAB.EXPIRING),
  v.literal(CONTRACT_TAB.ATIVO),
  v.literal(CONTRACT_TAB.PENDENTE),
  v.literal(CONTRACT_TAB.ENCERRADO),
  v.literal(CONTRACT_TAB.CANCELADO),
);

// Legacy `ativo` spans five states and `encerrado` / `cancelado` split
// `closed` on the close reason, so neither is a single index range: the
// narrowest index range is fetched and the page is narrowed in memory.
function guaranteeStateForTab(tab: ContractTab) {
  switch (tab) {
    case CONTRACT_TAB.PENDENTE:
      return GUARANTEE_STATE.DRAFTED;
    case CONTRACT_TAB.ENCERRADO:
    case CONTRACT_TAB.CANCELADO:
      return GUARANTEE_STATE.CLOSED;
    default:
      return null;
  }
}

export const listByAgency = queryWithAgencyScope({
  args: {
    paginationOpts: paginationOptsValidator,
    tab: v.optional(contractTabValidator),
    referenceDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const referenceDate = resolveReferenceDate(args.referenceDate);
    const tab: ContractTab = args.tab ?? CONTRACT_TAB.ALL;
    const state = guaranteeStateForTab(tab);

    const result = await (tab === CONTRACT_TAB.EXPIRING
      ? (() => {
          const bounds = expiringRenewalBounds(referenceDate);
          return ctx.db
            .query("guarantees")
            .withIndex("by_agency_status_nextRenewalDate", (q) =>
              q
                .eq("agencyId", ctx.agencyId)
                .eq("status", GUARANTEE_STATE.ACTIVE)
                .gte("nextRenewalDate", bounds.gte)
                .lte("nextRenewalDate", bounds.lte),
            )
            .order("asc")
            .paginate(args.paginationOpts);
        })()
      : state === null
        ? ctx.db
            .query("guarantees")
            .withIndex("by_agency_status", (q) => q.eq("agencyId", ctx.agencyId))
            .order("desc")
            .paginate(args.paginationOpts)
        : ctx.db
            .query("guarantees")
            .withIndex("by_agency_status", (q) =>
              q.eq("agencyId", ctx.agencyId).eq("status", state),
            )
            .order("desc")
            .paginate(args.paginationOpts));

    const page =
      tab === CONTRACT_TAB.ALL || tab === CONTRACT_TAB.EXPIRING
        ? result.page
        : result.page.filter((doc) => legacyStatusOf(doc) === tab);
    const tenantNames = await tenantNamesByGuarantee(ctx, page);

    return {
      ...result,
      page: page.map((doc) => {
        const urgency = getUrgencyTier({
          status: doc.status,
          nextRenewalDate: doc.nextRenewalDate,
          referenceDate,
        });
        return {
          id: doc.publicId,
          agencyId: doc.agencyId,
          status: legacyStatusOf(doc),
          nextRenewalDate: doc.nextRenewalDate,
          availableGuaranteeCents:
            doc.status === GUARANTEE_STATE.CLOSED ? 0 : doc.capacity.availableCents,
          tenantName: tenantNames.get(doc._id) ?? "",
          creationTime: doc._creationTime,
          urgency,
          urgencySortKey: urgencySortKey(urgency),
        };
      }),
    };
  },
});

type LegacyStatusCounts = Record<LegacyContractStatus, number>;

// One bounded scan instead of the per-state aggregate: `encerrado` vs
// `cancelado` splits `closed` on `closure.reason`, which no aggregate keys.
async function legacyStatusCounts(ctx: QueryCtx, agencyId: AgencyId): Promise<LegacyStatusCounts> {
  const docs = await ctx.db
    .query("guarantees")
    .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId))
    .collect();
  const counts: LegacyStatusCounts = { ativo: 0, pendente: 0, encerrado: 0, cancelado: 0 };
  for (const doc of docs) counts[legacyStatusOf(doc)] += 1;
  return counts;
}

export const getStatusCounts = queryWithAgencyScope({
  args: {},
  handler: async (ctx): Promise<LegacyStatusCounts> => legacyStatusCounts(ctx, ctx.agencyId),
});

export const getContractTabCounts = queryWithAgencyScope({
  args: { referenceDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const referenceDate = resolveReferenceDate(args.referenceDate);
    const counts = await legacyStatusCounts(ctx, ctx.agencyId);
    const bounds = expiringRenewalBounds(referenceDate);
    const expiringRows = await ctx.db
      .query("guarantees")
      .withIndex("by_agency_status_nextRenewalDate", (q) =>
        q
          .eq("agencyId", ctx.agencyId)
          .eq("status", GUARANTEE_STATE.ACTIVE)
          .gte("nextRenewalDate", bounds.gte)
          .lte("nextRenewalDate", bounds.lte),
      )
      .collect();

    return {
      all: counts.ativo + counts.pendente + counts.encerrado + counts.cancelado,
      expiring: expiringRows.length,
      ...counts,
    };
  },
});

// Every handler below delegates through `api.guarantees.useCases.*` and
// therefore carries an explicit return type — see the note on `getByPublicId`.
type CommissionRow = {
  contractId: string;
  tenantName: string;
  rentCents: number;
  commissionCents: number;
  installment: string;
  activatedAt: string;
};

export const listForCommissionByMonth = queryWithAgencyScope({
  args: { periodMonth: v.string() },
  handler: async (ctx, { periodMonth }): Promise<CommissionRow[]> => {
    const rows = await ctx.runQuery(api.guarantees.useCases.listForCommissionByMonth, {
      agencyId: ctx.agencyId,
      periodMonth,
    });
    return rows.map(({ guaranteeId, ...row }) => ({ contractId: guaranteeId, ...row }));
  },
});

type OpenContractApplicationSuccessResult = { applicationId: ContractApplicationId };
type OpenContractApplicationErrorResult = { code: typeof GUARANTEE_ERROR_CODE.INVALID_TAX_ID };

export const openContractApplication = mutationWithAgencyScope({
  args: {
    document: v.string(),
    entityType: tenantEntityTypeValidator,
    propertyKind: propertyKindValidator,
    cep: v.string(),
    rentCents: v.number(),
  },
  handler: async (
    ctx,
    { propertyKind, ...args },
  ): Promise<Result<OpenContractApplicationSuccessResult, OpenContractApplicationErrorResult>> =>
    ctx.runMutation(api.guarantees.useCases.openContractApplication, {
      ...args,
      agencyId: ctx.agencyId,
      propertyKind: toLeasePropertyKind(propertyKind),
    }),
});

type CreateContractSuccessResult = { publicId: string };
type CreateContractErrorResult = {
  code:
    | typeof TENANT_ERROR_CODE.INVALID_TAX_ID
    | typeof GUARANTEE_ERROR_CODE.TENANT_DENIED
    | typeof GUARANTEE_ERROR_CODE.INVALID_RENT
    | typeof GUARANTEE_ERROR_CODE.CREDIT_ASSESSMENT_REQUIRED
    | typeof PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE;
};

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
    propertyKind: propertyKindValidator,
    plan: guaranteePlanValidator,
    rentCents: v.number(),
    condoCents: v.number(),
    otherFeesCents: v.number(),
    tenant: v.object({
      entityType: tenantEntityTypeValidator,
      fullName: v.string(),
      cpf: v.string(),
      cnpj: v.optional(v.string()),
      birthDate: v.string(),
      email: v.string(),
      phone: v.string(),
    }),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<CreateContractSuccessResult, CreateContractErrorResult>> => {
    const result = await ctx.runMutation(api.guarantees.useCases.create, {
      agencyId: ctx.agencyId,
      lease: {
        propertyKind: toLeasePropertyKind(args.propertyKind),
        property: { ...args.property, complement: args.optional.complement },
        tag: args.optional.tag,
        description: args.optional.description,
        rent: {
          rentCents: args.rentCents,
          condoCents: args.condoCents,
          otherFeesCents: args.otherFeesCents,
        },
      },
      plan: args.plan,
      tenant: args.tenant,
    });
    if (!result.success) return result;
    return { success: true, data: { publicId: result.data.publicId }, message: result.message };
  },
});

const LEGACY_CANCEL_ERROR_CODE = {
  NOT_FOUND: "NOT_FOUND",
  NOT_PENDING: "NOT_PENDING",
} as const satisfies Record<string, string>;

type CancelProposalSuccessResult = { canceled: true };
type CancelProposalErrorResult = {
  code: (typeof LEGACY_CANCEL_ERROR_CODE)[keyof typeof LEGACY_CANCEL_ERROR_CODE];
};

export const cancelProposal = mutationWithAgencyScope({
  args: { publicId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Result<CancelProposalSuccessResult, CancelProposalErrorResult>> => {
    const result = await ctx.runMutation(api.guarantees.useCases.cancelDraft, {
      agencyId: ctx.agencyId,
      publicId: args.publicId,
    });
    if (!result.success) {
      return {
        success: false,
        error: {
          code:
            result.error.code === GUARANTEE_ERROR_CODE.NOT_DRAFTED
              ? LEGACY_CANCEL_ERROR_CODE.NOT_PENDING
              : LEGACY_CANCEL_ERROR_CODE.NOT_FOUND,
        },
        message: result.message,
      };
    }
    return { success: true, data: { canceled: true }, message: result.message };
  },
});
