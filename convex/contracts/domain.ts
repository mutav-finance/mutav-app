import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Contract = Doc<"contracts">;
export type ContractId = Id<"contracts">;
export type ContractHistory = Doc<"contractHistory">;
export type ContractHistoryId = Id<"contractHistory">;
export type ContractStatus = Contract["status"];
export type PropertyKind = Contract["rental"]["propertyKind"];
// Decoupled from the schema: persistence is `v.string()` to tolerate legacy
// rows with bespoke values across these fields. The narrow unions below
// enforce write-time discipline so new code can only persist canonical values.
export type ExitCostMultiplier = "6x";
export type RentMultiplier = "30x";
export type ContractPlan = Contract["rental"]["plan"];
export type Payer = "inquilino";
export type DocumentKey = Contract["documents"][number]["key"];
export type DocumentStatus = Contract["documents"][number]["status"];
export type TenantApprovalStatus = Contract["tenantApproval"]["status"];

export const CONTRACT_STATUS = {
  ATIVO: "ativo",
  ENCERRADO: "encerrado",
  PENDENTE: "pendente",
  CANCELADO: "cancelado",
} as const satisfies Record<Uppercase<ContractStatus>, ContractStatus>;

export const PROPERTY_KIND = {
  RESIDENCIAL: "residencial",
  COMERCIAL: "comercial",
} as const satisfies Record<Uppercase<PropertyKind>, PropertyKind>;

export const contractStatusValidator = v.union(
  v.literal(CONTRACT_STATUS.ATIVO),
  v.literal(CONTRACT_STATUS.ENCERRADO),
  v.literal(CONTRACT_STATUS.PENDENTE),
  v.literal(CONTRACT_STATUS.CANCELADO),
);

/**
 * One bucket in the unified contract-activity time series. Shared between the
 * agency dashboard (`granularity: "month"`) and the platform health timeline
 * (`granularity: "week"`).
 *
 * `period` is the bucket start: `"YYYY-MM"` for month, `"YYYY-MM-DD"` (UTC
 * Monday) for week. `netActive` is the snapshot of contracts active at the END
 * of the period — the unified trend semantic on both charts.
 */
export type ActivityBucket = {
  period: string;
  activated: number;
  cancelled: number;
  expired: number;
  netActive: number;
};

export type ActivityGranularity = "month" | "week";

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

export const SCORE_TIER_THRESHOLD = {
  high: 800,
  medium: 600,
  low: 400,
} as const;

/**
 * Canonical multiplier values applied to a contract's rent. Schema persists
 * as `v.string()` to tolerate legacy rows with bespoke values; these enums
 * are the typed source of truth for new writes.
 */
export const EXIT_COST_MULTIPLIER = {
  "6X": "6x",
} as const satisfies Record<Uppercase<ExitCostMultiplier>, ExitCostMultiplier>;

export const RENT_MULTIPLIER = {
  "30X": "30x",
} as const satisfies Record<Uppercase<RentMultiplier>, RentMultiplier>;

export const DEFAULT_EXIT_COST_MULTIPLIER: ExitCostMultiplier = EXIT_COST_MULTIPLIER["6X"];
export const DEFAULT_RENT_MULTIPLIER: RentMultiplier = RENT_MULTIPLIER["30X"];

/**
 * The guarantee product chosen for a contract. `basic` = Mutav Fiança;
 * `plus` = Mutav Fiança + (adds credit-life insurance / seguro prestamista,
 * which raises the fee — priced in #184 Fatia D). Decoupled from the credit
 * tier: the score sets the fee rate, the plan is the broker's choice.
 */
export const CONTRACT_PLAN = {
  BASIC: "basic",
  PLUS: "plus",
} as const satisfies Record<Uppercase<ContractPlan>, ContractPlan>;

export const contractPlanValidator = v.union(
  v.literal(CONTRACT_PLAN.BASIC),
  v.literal(CONTRACT_PLAN.PLUS),
);

export const DEFAULT_CONTRACT_PLAN: ContractPlan = CONTRACT_PLAN.BASIC;

/**
 * Allowed values for `contracts.rental.payer` — the party responsible for
 * the contract's recurring fees. This is a category, not a display label;
 * UI components translate to user-facing copy via i18n.
 */
export const PAYER = {
  INQUILINO: "inquilino",
} as const satisfies Record<Uppercase<Payer>, Payer>;

export const payerValidator = v.literal(PAYER.INQUILINO);

export const DEFAULT_PAYER: Payer = PAYER.INQUILINO;

export function tierForScore(score: number): ScoreTier {
  if (score >= SCORE_TIER_THRESHOLD.high) return SCORE_TIER.BOM;
  if (score >= SCORE_TIER_THRESHOLD.medium) return SCORE_TIER.REGULAR;
  if (score >= SCORE_TIER_THRESHOLD.low) return SCORE_TIER.RUIM;
  return SCORE_TIER.NEGADO;
}

export const CONTRACT_ERROR_CODE = {
  TENANT_DENIED: "TENANT_DENIED",
} as const satisfies Record<string, string>;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODE)[keyof typeof CONTRACT_ERROR_CODE];

export type UrgencyTier =
  | "overdue"
  | "expiring"
  | "critical"
  | "warning"
  | "pendente"
  | "ok"
  | "inactive";

export const URGENCY_TIER = {
  OVERDUE: "overdue",
  EXPIRING: "expiring",
  CRITICAL: "critical",
  WARNING: "warning",
  PENDENTE: "pendente",
  OK: "ok",
  INACTIVE: "inactive",
} as const satisfies Record<Uppercase<UrgencyTier>, UrgencyTier>;

export const urgencyTierValidator = v.union(
  v.literal(URGENCY_TIER.OVERDUE),
  v.literal(URGENCY_TIER.EXPIRING),
  v.literal(URGENCY_TIER.CRITICAL),
  v.literal(URGENCY_TIER.WARNING),
  v.literal(URGENCY_TIER.PENDENTE),
  v.literal(URGENCY_TIER.OK),
  v.literal(URGENCY_TIER.INACTIVE),
);

const URGENCY_ORDER: Record<UrgencyTier, number> = {
  overdue: 0,
  expiring: 1,
  critical: 2,
  warning: 3,
  pendente: 4,
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

export function getUrgencyTier({
  status,
  nextRenewalDate,
  referenceDate,
}: {
  status: ContractStatus;
  nextRenewalDate: string;
  referenceDate: string;
}): UrgencyTier {
  if (status === CONTRACT_STATUS.ENCERRADO || status === CONTRACT_STATUS.CANCELADO)
    return URGENCY_TIER.INACTIVE;
  if (status === CONTRACT_STATUS.PENDENTE) return URGENCY_TIER.PENDENTE;

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
