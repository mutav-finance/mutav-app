import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { GUARANTEE_STATE, type GuaranteeState } from "./machine";

export type Guarantee = Doc<"guarantees">;
export type GuaranteeId = Id<"guarantees">;
export type GuaranteeTerms = Guarantee["terms"];
export type GuaranteeCapacity = Guarantee["capacity"];
export type GuaranteeClosure = NonNullable<Guarantee["closure"]>;
export type GuaranteeUnderwriting = Guarantee["underwriting"];
export type GuaranteeHistory = Doc<"guaranteeHistory">;
export type GuaranteeHistoryId = Id<"guaranteeHistory">;
export type ContractApplication = Doc<"contractApplications">;
export type ContractApplicationId = Id<"contractApplications">;
export type GuaranteePlan = GuaranteeTerms["plan"];
export type DocumentKey = Guarantee["documents"][number]["key"];
export type DocumentStatus = Guarantee["documents"][number]["status"];
export type TenantApprovalStatus = Guarantee["tenantApproval"]["status"];

// The lifecycle machine is the source of truth for states, close reasons and
// the transition table; this module re-exports it so one import serves both
// the value objects and the guards.
export {
  GUARANTEE_STATE,
  GUARANTEE_STATES,
  TERMINAL_STATES,
  ALLOWED_TRANSITIONS,
  CLOSE_REASON,
  CLOSE_REASONS,
  CLOSE_REASON_ALLOWED_FROM,
  closeReasonValidator,
  isTerminal,
  assertTransition,
  assertClose,
} from "./machine";
export type {
  GuaranteeState,
  CloseReason,
  TransitionError,
  TransitionSuccess,
  CloseError,
  CloseSuccess,
} from "./machine";

export const guaranteeStateValidator = v.union(
  v.literal(GUARANTEE_STATE.DRAFTED),
  v.literal(GUARANTEE_STATE.ACTIVE),
  v.literal(GUARANTEE_STATE.IN_ARREARS),
  v.literal(GUARANTEE_STATE.DEFAULT_VERIFIED),
  v.literal(GUARANTEE_STATE.COVER_COMMITTED),
  v.literal(GUARANTEE_STATE.IN_EVICTION),
  v.literal(GUARANTEE_STATE.CLOSED),
);

/**
 * States in which Mutav is on risk for the lease. Everything that is neither
 * a draft nor closed. Not lexically contiguous (`active < closed <
 * cover_committed < …`), so aggregate reads must iterate this list rather
 * than take a single key range.
 */
export const INSURED_STATES: readonly GuaranteeState[] = [
  GUARANTEE_STATE.ACTIVE,
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
  GUARANTEE_STATE.IN_EVICTION,
] as const;

const INSURED_STATE_SET: ReadonlySet<GuaranteeState> = new Set(INSURED_STATES);

export function isInsured(guarantee: Pick<Guarantee, "status">): boolean {
  return INSURED_STATE_SET.has(guarantee.status);
}

/**
 * One bucket in the unified guarantee-activity time series. Shared between the
 * agency dashboard (`granularity: "month"`) and the platform health timeline
 * (`granularity: "week"`).
 *
 * `period` is the bucket start: `"YYYY-MM"` for month, `"YYYY-MM-DD"` (UTC
 * Monday) for week. `netActive` is the snapshot of guarantees in force at the
 * END of the period — the unified trend semantic on both charts.
 */
export type ActivityBucket = {
  period: string;
  activated: number;
  cancelled: number;
  expired: number;
  netActive: number;
};

export type ActivityGranularity = "month" | "week";

/**
 * One bucket in the guarantee **state timeline**: the composition of the book
 * at the END of the period, one count per lifecycle state.
 *
 * Distinct from `ActivityBucket`, which counts *events* (activations,
 * closures) in the period and cannot express `in_arrears` at all — arrears is
 * a state, not an event, and nothing on the guarantee row dates it. The
 * timeline is reconstructed from `guaranteeHistory.transition`, so every
 * state the machine can reach is visible.
 *
 * The counts sum to the number of guarantees in scope in every bucket: a
 * guarantee is always somewhere on the machine, so the series reads as a
 * true part-to-whole composition.
 */
export type StateTimelineBucket = {
  period: string;
  countByState: Record<GuaranteeState, number>;
};

// Transitional re-export: the entity-type family moved to the tenants
// registry domain (`convex/tenants/domain.ts`). Kept here so existing
// consumers compile until the narrow PR (#245) retargets their imports.
export {
  TENANT_ENTITY_TYPE,
  tenantEntityTypeValidator,
  DEFAULT_TENANT_ENTITY_TYPE,
} from "../tenants/domain";
export type { TenantEntityType } from "../tenants/domain";

export type ScoreTier = "bom" | "regular" | "ruim" | "negado";

export const SCORE_TIER = {
  BOM: "bom",
  REGULAR: "regular",
  RUIM: "ruim",
  NEGADO: "negado",
} as const satisfies Record<Uppercase<ScoreTier>, ScoreTier>;

export const scoreTierValidator = v.union(
  v.literal(SCORE_TIER.BOM),
  v.literal(SCORE_TIER.REGULAR),
  v.literal(SCORE_TIER.RUIM),
  v.literal(SCORE_TIER.NEGADO),
);

/**
 * Score tiers that can be priced. `negado` has no rate: a denied tenant is
 * rejected before pricing (see the `create` mutation), so it is excluded from
 * the rate table at the type level — pricing a denied tier is a compile error.
 */
export type PriceableTier = Exclude<ScoreTier, typeof SCORE_TIER.NEGADO>;

export const priceableTierValidator = v.union(
  v.literal(SCORE_TIER.BOM),
  v.literal(SCORE_TIER.REGULAR),
  v.literal(SCORE_TIER.RUIM),
);

export const SCORE_TIER_THRESHOLD = {
  high: 800,
  medium: 600,
  low: 400,
} as const;

/**
 * The guarantee plan chosen for a guarantee. `basic` = Mutav Fiança;
 * `plus` = Mutav Fiança + (adds credit-life insurance / seguro prestamista,
 * which raises the fee). Decoupled from the credit tier: the score sets the
 * fee rate, the plan is the broker's choice.
 */
export const GUARANTEE_PLAN = {
  BASIC: "basic",
  PLUS: "plus",
} as const satisfies Record<Uppercase<GuaranteePlan>, GuaranteePlan>;

export const guaranteePlanValidator = v.union(
  v.literal(GUARANTEE_PLAN.BASIC),
  v.literal(GUARANTEE_PLAN.PLUS),
);

export const DEFAULT_GUARANTEE_PLAN: GuaranteePlan = GUARANTEE_PLAN.BASIC;

export const DOCUMENT_KEY = {
  RENTAL_CONTRACT: "rentalContract",
  INSPECTION: "inspection",
  POLICY: "policy",
} as const satisfies Record<string, DocumentKey>;

export const DOCUMENT_STATUS = {
  PENDENTE: "pendente",
  ENVIADO: "enviado",
  APROVADO: "aprovado",
} as const satisfies Record<Uppercase<DocumentStatus>, DocumentStatus>;

export const TENANT_APPROVAL_STATUS = {
  APROVADO: "aprovado",
  PENDENTE: "pendente",
  REPROVADO: "reprovado",
} as const satisfies Record<Uppercase<TenantApprovalStatus>, TenantApprovalStatus>;

export function tierForScore(score: number): ScoreTier {
  if (score >= SCORE_TIER_THRESHOLD.high) return SCORE_TIER.BOM;
  if (score >= SCORE_TIER_THRESHOLD.medium) return SCORE_TIER.REGULAR;
  if (score >= SCORE_TIER_THRESHOLD.low) return SCORE_TIER.RUIM;
  return SCORE_TIER.NEGADO;
}

// Codes owned by other domains (`PRODUCT_ERROR_CODE.PRODUCT_UNAVAILABLE`,
// `LEASE_ERROR_CODE.LEASE_HAS_OPEN_GUARANTEE`) are composed into a mutation's
// error union at the call site rather than duplicated here.
export const GUARANTEE_ERROR_CODE = {
  TENANT_DENIED: "TENANT_DENIED",
  INVALID_RENT: "INVALID_RENT",
  CREDIT_ASSESSMENT_REQUIRED: "CREDIT_ASSESSMENT_REQUIRED",
  INVALID_TAX_ID: "INVALID_TAX_ID",
  NOT_FOUND: "NOT_FOUND",
  NOT_DRAFTED: "NOT_DRAFTED",
  CLOSURE_REQUIRED: "CLOSURE_REQUIRED",
  CLOSURE_NOT_ALLOWED: "CLOSURE_NOT_ALLOWED",
  CAPACITY_INVARIANT_BROKEN: "CAPACITY_INVARIANT_BROKEN",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  RELEASE_EXCEEDS_RESERVED: "RELEASE_EXCEEDS_RESERVED",
  GUARANTEE_CLOSED: "GUARANTEE_CLOSED",
  INVALID_RENEWAL_DATE: "INVALID_RENEWAL_DATE",
} as const satisfies Record<string, string>;

export type GuaranteeErrorCode = (typeof GUARANTEE_ERROR_CODE)[keyof typeof GUARANTEE_ERROR_CODE];

/**
 * How long a declared intent to rent keeps authorising a bureau consultation
 * on the subject. A prospective commercial relationship under Lei 12.414
 * art. 15 is not perpetual, so the record ages out rather than standing
 * forever.
 */
export const CONTRACT_APPLICATION_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

export type UrgencyTier =
  | "overdue"
  | "expiring"
  | "critical"
  | "warning"
  | "drafted"
  | "ok"
  | "inactive";

export const URGENCY_TIER = {
  OVERDUE: "overdue",
  EXPIRING: "expiring",
  CRITICAL: "critical",
  WARNING: "warning",
  DRAFTED: "drafted",
  OK: "ok",
  INACTIVE: "inactive",
} as const satisfies Record<Uppercase<UrgencyTier>, UrgencyTier>;

export const urgencyTierValidator = v.union(
  v.literal(URGENCY_TIER.OVERDUE),
  v.literal(URGENCY_TIER.EXPIRING),
  v.literal(URGENCY_TIER.CRITICAL),
  v.literal(URGENCY_TIER.WARNING),
  v.literal(URGENCY_TIER.DRAFTED),
  v.literal(URGENCY_TIER.OK),
  v.literal(URGENCY_TIER.INACTIVE),
);

const URGENCY_ORDER: Record<UrgencyTier, number> = {
  overdue: 0,
  expiring: 1,
  critical: 2,
  warning: 3,
  drafted: 4,
  ok: 5,
  inactive: 6,
};

export function urgencySortKey(tier: UrgencyTier): number {
  return URGENCY_ORDER[tier];
}

const EXPIRING_DAYS = 30;
const CRITICAL_DAYS = 60;
const WARNING_DAYS = 120;
const DAY_MS = 86_400_000;

function toUtcMidnight(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getTime();
}

/**
 * Renewal urgency for the list view. Only in-force guarantees have a renewal
 * to chase: a draft is waiting on the tenant, a closed guarantee has nothing
 * left to renew. Every insured state — including one in arrears or under
 * cover — still renews on its date, so they all share the date-driven tiers.
 */
export function getUrgencyTier({
  status,
  nextRenewalDate,
  referenceDate,
}: {
  status: GuaranteeState;
  nextRenewalDate: string;
  referenceDate: string;
}): UrgencyTier {
  if (status === GUARANTEE_STATE.CLOSED) return URGENCY_TIER.INACTIVE;
  if (status === GUARANTEE_STATE.DRAFTED) return URGENCY_TIER.DRAFTED;

  const renewalMs = toUtcMidnight(nextRenewalDate);
  const refMs = toUtcMidnight(referenceDate);
  if (Number.isNaN(renewalMs) || Number.isNaN(refMs)) return URGENCY_TIER.INACTIVE;

  const daysUntil = Math.floor((renewalMs - refMs) / DAY_MS);
  if (daysUntil < 0) return URGENCY_TIER.OVERDUE;
  if (daysUntil <= EXPIRING_DAYS) return URGENCY_TIER.EXPIRING;
  if (daysUntil <= CRITICAL_DAYS) return URGENCY_TIER.CRITICAL;
  if (daysUntil <= WARNING_DAYS) return URGENCY_TIER.WARNING;
  return URGENCY_TIER.OK;
}

function addDaysUtc(date: string, days: number): string {
  const ms = toUtcMidnight(date) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export function expiringRenewalBounds(referenceDate: string): { gte: string; lte: string } {
  return { gte: referenceDate, lte: addDaysUtc(referenceDate, CRITICAL_DAYS) };
}
