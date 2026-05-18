import { v } from "convex/values";

// Pure Convex validators — no imports from _generated/dataModel.
// Safe to import from schema.ts without creating a circular dependency.

export const agencyDocumentKindValidator = v.union(
  v.literal("cartao_cnpj"),
  v.literal("contrato_social"),
  v.literal("comprovante_endereco"),
  v.literal("responsavel_id"),
);
