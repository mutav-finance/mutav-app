import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Payment = Doc<"payments">;
export type PaymentId = Id<"payments">;
export type PaymentStatus = Payment["status"];
export type PaymentLineItem = Payment["lineItems"][number];
export type PaymentLineItemKind = PaymentLineItem["kind"];

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
  CANCELED: "canceled",
} as const satisfies Record<Uppercase<PaymentStatus>, PaymentStatus>;

export const PAYMENT_LINE_ITEM_KIND = {
  RECURRING: "recurring",
  ACTIVATION: "activation",
} as const satisfies Record<Uppercase<PaymentLineItemKind>, PaymentLineItemKind>;

export const paymentStatusValidator = v.union(
  v.literal(PAYMENT_STATUS.PENDING),
  v.literal(PAYMENT_STATUS.PAID),
  v.literal(PAYMENT_STATUS.OVERDUE),
  v.literal(PAYMENT_STATUS.CANCELED),
);

export const paymentLineItemKindValidator = v.union(
  v.literal(PAYMENT_LINE_ITEM_KIND.RECURRING),
  v.literal(PAYMENT_LINE_ITEM_KIND.ACTIVATION),
);
