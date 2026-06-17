import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";

// ─── Type aliases ─────────────────────────────────────────────────────────────

export type AnchorOrder = Doc<"anchorOrders">;
export type AnchorOrderId = Id<"anchorOrders">;
export type AnchorOrderStatus = AnchorOrder["status"];

// ─── Status value object ──────────────────────────────────────────────────────

/**
 * Normalized anchor on-ramp lifecycle. Mirrors SEP-24's transaction status
 * enum so testanchor responses map 1:1; future non-SEP providers (Etherfuse)
 * translate their proprietary statuses into this set.
 *
 * Terminal: `completed`, `refunded`, `expired`, `error`.
 */
export const ANCHOR_ORDER_STATUS = {
  INCOMPLETE: "incomplete",
  PENDING_USER_TRANSFER_START: "pending_user_transfer_start",
  PENDING_USER_TRANSFER_COMPLETE: "pending_user_transfer_complete",
  PENDING_ANCHOR: "pending_anchor",
  PENDING_STELLAR: "pending_stellar",
  COMPLETED: "completed",
  REFUNDED: "refunded",
  EXPIRED: "expired",
  ERROR: "error",
} as const satisfies Record<Uppercase<string>, AnchorOrderStatus>;

export const anchorOrderStatusValidator = v.union(
  v.literal(ANCHOR_ORDER_STATUS.INCOMPLETE),
  v.literal(ANCHOR_ORDER_STATUS.PENDING_USER_TRANSFER_START),
  v.literal(ANCHOR_ORDER_STATUS.PENDING_USER_TRANSFER_COMPLETE),
  v.literal(ANCHOR_ORDER_STATUS.PENDING_ANCHOR),
  v.literal(ANCHOR_ORDER_STATUS.PENDING_STELLAR),
  v.literal(ANCHOR_ORDER_STATUS.COMPLETED),
  v.literal(ANCHOR_ORDER_STATUS.REFUNDED),
  v.literal(ANCHOR_ORDER_STATUS.EXPIRED),
  v.literal(ANCHOR_ORDER_STATUS.ERROR),
);

// ─── Predicates ───────────────────────────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<AnchorOrderStatus> = new Set([
  ANCHOR_ORDER_STATUS.COMPLETED,
  ANCHOR_ORDER_STATUS.REFUNDED,
  ANCHOR_ORDER_STATUS.EXPIRED,
  ANCHOR_ORDER_STATUS.ERROR,
]);

export function isTerminal(status: AnchorOrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isSuccess(status: AnchorOrderStatus): boolean {
  return status === ANCHOR_ORDER_STATUS.COMPLETED;
}
