import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";

// ─── Type aliases ─────────────────────────────────────────────────────────────

export type ProviderOrder = Doc<"providerOrders">;
export type ProviderOrderId = Id<"providerOrders">;
export type ProviderOrderStatus = ProviderOrder["status"];

// ─── Status value object ──────────────────────────────────────────────────────

/**
 * Normalized anchor on-ramp lifecycle. Mirrors SEP-24's transaction status
 * enum so testanchor responses map 1:1; future non-SEP providers (Etherfuse)
 * translate their proprietary statuses into this set.
 *
 * Terminal: `completed`, `refunded`, `expired`, `error`.
 */
export const PROVIDER_ORDER_STATUS = {
  INCOMPLETE: "incomplete",
  PENDING_USER_TRANSFER_START: "pending_user_transfer_start",
  PENDING_USER_TRANSFER_COMPLETE: "pending_user_transfer_complete",
  PENDING_ANCHOR: "pending_anchor",
  PENDING_STELLAR: "pending_stellar",
  COMPLETED: "completed",
  REFUNDED: "refunded",
  EXPIRED: "expired",
  ERROR: "error",
} as const satisfies Record<Uppercase<string>, ProviderOrderStatus>;

export const providerOrderStatusValidator = v.union(
  v.literal(PROVIDER_ORDER_STATUS.INCOMPLETE),
  v.literal(PROVIDER_ORDER_STATUS.PENDING_USER_TRANSFER_START),
  v.literal(PROVIDER_ORDER_STATUS.PENDING_USER_TRANSFER_COMPLETE),
  v.literal(PROVIDER_ORDER_STATUS.PENDING_ANCHOR),
  v.literal(PROVIDER_ORDER_STATUS.PENDING_STELLAR),
  v.literal(PROVIDER_ORDER_STATUS.COMPLETED),
  v.literal(PROVIDER_ORDER_STATUS.REFUNDED),
  v.literal(PROVIDER_ORDER_STATUS.EXPIRED),
  v.literal(PROVIDER_ORDER_STATUS.ERROR),
);

// ─── Predicates ───────────────────────────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<ProviderOrderStatus> = new Set([
  PROVIDER_ORDER_STATUS.COMPLETED,
  PROVIDER_ORDER_STATUS.REFUNDED,
  PROVIDER_ORDER_STATUS.EXPIRED,
  PROVIDER_ORDER_STATUS.ERROR,
]);

export function isTerminal(status: ProviderOrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isSuccess(status: ProviderOrderStatus): boolean {
  return status === PROVIDER_ORDER_STATUS.COMPLETED;
}
