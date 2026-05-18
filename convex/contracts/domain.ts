import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Contract = Doc<"contracts">;
export type ContractId = Id<"contracts">;
export type ContractHistory = Doc<"contractHistory">;
export type ContractHistoryId = Id<"contractHistory">;
export type ContractStatus = Contract["status"];
export type PropertyKind = Contract["rental"]["propertyKind"];
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

export function tierForScore(score: number): ScoreTier {
  if (score >= SCORE_TIER_THRESHOLD.high) return SCORE_TIER.BOM;
  if (score >= SCORE_TIER_THRESHOLD.medium) return SCORE_TIER.REGULAR;
  if (score >= SCORE_TIER_THRESHOLD.low) return SCORE_TIER.RUIM;
  return SCORE_TIER.NEGADO;
}
