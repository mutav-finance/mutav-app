import { v } from "convex/values";

// Pure Convex validators — no imports from _generated/dataModel.
// Safe to import from schema.ts without creating a circular dependency.

export const agencyDocumentKindValidator = v.union(
  v.literal("documento_empresa"),
  v.literal("responsavel_id"),
);
