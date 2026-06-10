import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Contract = Doc<"contracts">;
export type ContractId = Id<"contracts">;
export type ContractHistory = Doc<"contractHistory">;
export type ContractHistoryId = Id<"contractHistory">;
export type ContractStatus = Contract["status"];
export type PropertyKind = Contract["rental"]["propertyKind"];
export type ExitCostMultiplier = Contract["rental"]["exitCostMultiplier"];
export type RentMultiplier = Contract["rental"]["rentMultiplier"];
// Decoupled from the schema: persistence is `v.string()` to tolerate legacy
// display-label rows; this narrow union enforces write-time discipline so new
// code can only persist canonical category values.
export type Payer = "inquilino";
export type DocumentKey = Contract["documents"][number]["key"];
export type DocumentStatus = Contract["documents"][number]["status"];
export type TenantApprovalStatus = Contract["tenant"]["approvalStatus"];

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
 * Allowed multiplier values applied to a contract's rent. Schema validates
 * via `exitCostMultiplierValidator` / `rentMultiplierValidator` (strict union
 * of literals); these enum objects are the typed source of truth for writes.
 * Append a value here AND in the matching inline validator in `schema.ts` to
 * grow the set — `satisfies` will surface drift at compile time.
 */
export const EXIT_COST_MULTIPLIER = {
  "5X": "5x",
  "6X": "6x",
} as const satisfies Record<Uppercase<ExitCostMultiplier>, ExitCostMultiplier>;

export const RENT_MULTIPLIER = {
  "30X": "30x",
} as const satisfies Record<Uppercase<RentMultiplier>, RentMultiplier>;

export const exitCostMultiplierValidator = v.union(
  v.literal(EXIT_COST_MULTIPLIER["5X"]),
  v.literal(EXIT_COST_MULTIPLIER["6X"]),
);

export const rentMultiplierValidator = v.literal(RENT_MULTIPLIER["30X"]);

export const DEFAULT_EXIT_COST_MULTIPLIER: ExitCostMultiplier = EXIT_COST_MULTIPLIER["5X"];
export const DEFAULT_RENT_MULTIPLIER: RentMultiplier = RENT_MULTIPLIER["30X"];

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
