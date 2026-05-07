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
