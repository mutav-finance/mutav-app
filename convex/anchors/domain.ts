import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

// Re-export Anchor interface types from the vendored module so the
// convex/anchors/ domain is the single import surface for downstream callers
// (useCases.ts, actions.ts, webhook handlers in WC).
export type {
  KycStatus,
  TransactionStatus,
  Customer,
  Quote,
  OnRampTransaction,
  OffRampTransaction,
  PaymentInstructions,
  PixPaymentInstructions,
  CreateCustomerInput,
  GetQuoteInput,
  CreateOnRampInput,
} from "../../src/lib/anchors/types";
export { AnchorError } from "../../src/lib/anchors/types";

// ─── Doc / Id aliases ─────────────────────────────────────────────────────────

export type AnchorOnRampTransaction = Doc<"anchorOnRampTransactions">;
export type AnchorOnRampTransactionId = Id<"anchorOnRampTransactions">;
export type AnchorWebhookEvent = Doc<"anchorWebhookEvents">;
export type AnchorWebhookEventId = Id<"anchorWebhookEvents">;

// ─── Provider constants ───────────────────────────────────────────────────────

export const ANCHOR_PROVIDER = {
  ETHERFUSE: "etherfuse",
} as const;
export type AnchorProvider = (typeof ANCHOR_PROVIDER)[keyof typeof ANCHOR_PROVIDER];

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Mirrors the `TransactionStatus` union from src/lib/anchors/types.ts. The
 * schema-level definition in convex/schema.ts is structurally identical but
 * not exported, so this file owns the validator that callers reach for.
 */
export const transactionStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("cancelled"),
  v.literal("refunded"),
);

/** Mirrors the `KycStatus` union from src/lib/anchors/types.ts. */
export const kycStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("not_started"),
  v.literal("update_required"),
);

// ─── Error codes ──────────────────────────────────────────────────────────────

export const ANCHOR_ERROR_CODE = {
  QUOTE_FAILED: "QUOTE_FAILED",
  ORDER_FAILED: "ORDER_FAILED",
  AGENCY_NOT_ONBOARDED: "AGENCY_NOT_ONBOARDED",
  AGENCY_NOT_FOUND: "AGENCY_NOT_FOUND",
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  PAYMENT_NOT_CHARGEABLE: "PAYMENT_NOT_CHARGEABLE",
  PAYMENT_MUXED_ID_MISSING: "PAYMENT_MUXED_ID_MISSING",
  ORDER_EXPIRED: "ORDER_EXPIRED",
  WEBHOOK_HMAC_INVALID: "WEBHOOK_HMAC_INVALID",
  WEBHOOK_REPLAY: "WEBHOOK_REPLAY",
} as const;
export type AnchorErrorCode = (typeof ANCHOR_ERROR_CODE)[keyof typeof ANCHOR_ERROR_CODE];
