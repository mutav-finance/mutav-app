import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Payment = Doc<"payments">;
export type PaymentId = Id<"payments">;

/** Lifecycle status of a single settlement attempt. */
export type PaymentStatus = Payment["status"];

/** Discriminated union — the settlement rail used for this attempt. */
export type SettlementMethod = Payment["method"];
export type SettlementMethodKind = SettlementMethod["kind"];

// ─── Status constants ─────────────────────────────────────────────────────────

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
} as const satisfies Record<Uppercase<PaymentStatus>, PaymentStatus>;

// ─── Method constants ─────────────────────────────────────────────────────────

export const SETTLEMENT_METHOD_KIND = {
  BOLETO: "boleto",
  STELLAR: "stellar",
  PIX: "pix",
} as const satisfies Record<Uppercase<SettlementMethodKind>, SettlementMethodKind>;

// ─── Validators (for use in Convex function args) ─────────────────────────────

export const paymentStatusValidator = v.union(
  v.literal(PAYMENT_STATUS.PENDING),
  v.literal(PAYMENT_STATUS.PROCESSING),
  v.literal(PAYMENT_STATUS.SUCCEEDED),
  v.literal(PAYMENT_STATUS.FAILED),
  v.literal(PAYMENT_STATUS.CANCELED),
);

export const settlementMethodValidator = v.union(
  v.object({
    kind: v.literal(SETTLEMENT_METHOD_KIND.BOLETO),
    barcode: v.union(v.string(), v.null()),
  }),
  v.object({
    kind: v.literal(SETTLEMENT_METHOD_KIND.STELLAR),
    destinationAddress: v.string(),
    txHash: v.union(v.string(), v.null()),
  }),
  v.object({
    kind: v.literal(SETTLEMENT_METHOD_KIND.PIX),
    pixKey: v.string(),
    txId: v.union(v.string(), v.null()),
  }),
);

// ─── Method constructors (type-safe helpers) ──────────────────────────────────

export const SettlementMethods = {
  boleto: (barcode: string | null = null): Extract<SettlementMethod, { kind: "boleto" }> => ({
    kind: "boleto",
    barcode,
  }),
  stellar: (
    destinationAddress: string,
    txHash: string | null = null,
  ): Extract<SettlementMethod, { kind: "stellar" }> => ({
    kind: "stellar",
    destinationAddress,
    txHash,
  }),
  pix: (
    pixKey: string,
    txId: string | null = null,
  ): Extract<SettlementMethod, { kind: "pix" }> => ({
    kind: "pix",
    pixKey,
    txId,
  }),
} as const;

// ─── Predicates ───────────────────────────────────────────────────────────────

/** A settlement attempt has succeeded once its status reaches the terminal `succeeded`. */
export function isSuccess(status: PaymentStatus): boolean {
  return status === PAYMENT_STATUS.SUCCEEDED;
}
