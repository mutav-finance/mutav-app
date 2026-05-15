import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Payment = Doc<"payments">;
export type PaymentId = Id<"payments">;
export type PaymentLineItem = Payment["lineItems"][number];
export type PaymentLineItemKind = PaymentLineItem["kind"];

/** Discriminated union — the lifecycle state of a payment. */
export type PaymentState = Payment["state"];
export type PaymentStateKind = PaymentState["kind"];

/** Discriminated union — the chosen payment method, or null if not yet selected. */
export type PaymentMethod = Payment["method"];
export type PaymentMethodKind = NonNullable<PaymentMethod>["kind"];

// ─── State constants ──────────────────────────────────────────────────────────

export const PAYMENT_STATE_KIND = {
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
  CANCELED: "canceled",
} as const satisfies Record<Uppercase<PaymentStateKind>, PaymentStateKind>;

// ─── Method constants ─────────────────────────────────────────────────────────

export const PAYMENT_METHOD_KIND = {
  BOLETO: "boleto",
  STELLAR: "stellar",
  PIX: "pix",
  PIX_ANCHOR: "pix_anchor",
} as const satisfies Record<Uppercase<PaymentMethodKind>, PaymentMethodKind>;

// ─── Line item constants ──────────────────────────────────────────────────────

export const PAYMENT_LINE_ITEM_KIND = {
  RECURRING: "recurring",
  ACTIVATION: "activation",
} as const satisfies Record<Uppercase<PaymentLineItemKind>, PaymentLineItemKind>;

// ─── Validators (for use in Convex function args) ─────────────────────────────

export const paymentStateKindValidator = v.union(
  v.literal(PAYMENT_STATE_KIND.PENDING),
  v.literal(PAYMENT_STATE_KIND.PAID),
  v.literal(PAYMENT_STATE_KIND.OVERDUE),
  v.literal(PAYMENT_STATE_KIND.CANCELED),
);

export const paymentMethodKindValidator = v.union(
  v.literal(PAYMENT_METHOD_KIND.BOLETO),
  v.literal(PAYMENT_METHOD_KIND.STELLAR),
  v.literal(PAYMENT_METHOD_KIND.PIX),
  v.literal(PAYMENT_METHOD_KIND.PIX_ANCHOR),
);

export const paymentLineItemKindValidator = v.union(
  v.literal(PAYMENT_LINE_ITEM_KIND.RECURRING),
  v.literal(PAYMENT_LINE_ITEM_KIND.ACTIVATION),
);

// ─── State constructors (type-safe helpers) ───────────────────────────────────

export const PaymentStates = {
  pending: (): Extract<PaymentState, { kind: "pending" }> => ({ kind: "pending" }),
  paid: (paidAt: string): Extract<PaymentState, { kind: "paid" }> => ({ kind: "paid", paidAt }),
  overdue: (): Extract<PaymentState, { kind: "overdue" }> => ({ kind: "overdue" }),
  canceled: (): Extract<PaymentState, { kind: "canceled" }> => ({ kind: "canceled" }),
} as const;

// ─── Method constructors (type-safe helpers) ──────────────────────────────────

// ─── Predicates ───────────────────────────────────────────────────────────────

/** A payment is chargeable while its state is awaiting (or past) the due date. */
export function isChargeable(state: PaymentState): boolean {
  return state.kind === PAYMENT_STATE_KIND.PENDING || state.kind === PAYMENT_STATE_KIND.OVERDUE;
}

export const PaymentMethods = {
  boleto: (barcode: string | null = null): Extract<PaymentMethod, { kind: "boleto" }> => ({
    kind: "boleto",
    barcode,
  }),
  stellar: (
    destinationAddress: string,
    txHash: string | null = null,
  ): Extract<PaymentMethod, { kind: "stellar" }> => ({
    kind: "stellar",
    destinationAddress,
    txHash,
  }),
  pix: (pixKey: string, txId: string | null = null): Extract<PaymentMethod, { kind: "pix" }> => ({
    kind: "pix",
    pixKey,
    txId,
  }),
} as const;
