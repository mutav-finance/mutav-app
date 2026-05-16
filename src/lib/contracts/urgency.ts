import type { ContractStatus } from "./types";

/**
 * Urgency tiers for a contract, computed from status + days until next renewal.
 *
 * Sort order (ascending urgency): overdue → expiring → critical → warning → pendente → ok → inactive
 */
export type UrgencyTier =
  | "overdue"
  | "expiring"
  | "critical"
  | "warning"
  | "pendente"
  | "ok"
  | "inactive";

const EXPIRING_DAYS = 30;

/** Numeric sort key — lower = more urgent. */
const URGENCY_ORDER: Record<UrgencyTier, number> = {
  overdue: 0,
  expiring: 1,
  critical: 2,
  warning: 3,
  pendente: 4,
  ok: 5,
  inactive: 6,
};

/**
 * Returns the urgency tier for a contract.
 *
 * Thresholds (for `ativo` contracts):
 *  - overdue:  nextRenewalDate is in the past
 *  - expiring: 1–20 days until renewal (needs renewal action)
 *  - critical: 21–60 days until renewal
 *  - warning:  61–120 days until renewal
 *  - ok:       > 120 days until renewal
 */
export function getUrgencyTier(status: ContractStatus, nextRenewalDate: string): UrgencyTier {
  if (status === "encerrado" || status === "cancelado") return "inactive";
  if (status === "pendente") return "pendente";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const renewal = new Date(nextRenewalDate);
  const daysUntil = Math.floor((renewal.getTime() - today.getTime()) / 86_400_000);

  if (daysUntil < 0) return "overdue";
  if (daysUntil <= EXPIRING_DAYS) return "expiring";
  if (daysUntil <= 60) return "critical";
  if (daysUntil <= 120) return "warning";
  return "ok";
}

/** Numeric sort key for urgency — use as a TanStack Table sort value. */
export function urgencySortKey(tier: UrgencyTier): number {
  return URGENCY_ORDER[tier];
}
