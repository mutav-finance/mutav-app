import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type AgencyBankAccount = Doc<"agencyBankAccounts">;
export type AgencyBankAccountId = Id<"agencyBankAccounts">;
export type AgencyBankAccountType = AgencyBankAccount["type"];

export const AGENCY_BANK_ACCOUNT_TYPE = {
  PIX: "pix",
  SPEI: "spei",
} as const satisfies Record<Uppercase<string>, AgencyBankAccountType>;

export const agencyBankAccountTypeValidator = v.union(
  v.literal(AGENCY_BANK_ACCOUNT_TYPE.PIX),
  v.literal(AGENCY_BANK_ACCOUNT_TYPE.SPEI),
);
