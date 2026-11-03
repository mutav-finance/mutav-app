import { periodMonthInBrazil } from "@mutav/i18n/brazil";

/** The fields of a commission row this view model reads. */
export type CommissionRowLike = {
  guaranteeId: string;
  tenantName: string;
  commissionCents: number;
};

export type CommissionSummary = {
  totalCommissionCents: number;
  guaranteeCount: number;
};

/** The month the page opens on: the current month in São Paulo time. */
export function currentCommissionMonth(now: Date): string {
  return periodMonthInBrazil(now);
}

/** Move a `YYYY-MM` period by `delta` months. Pure calendar arithmetic, no time zone. */
export function shiftPeriodMonth(periodMonth: string, delta: number): string {
  const [year, month] = periodMonth.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

/** Rows whose guarantee ID or tenant name contains `search`, case-insensitively. */
export function filterCommissionRows<TRow extends CommissionRowLike>(
  rows: readonly TRow[],
  search: string,
): TRow[] {
  const term = search.trim().toLowerCase();
  if (!term) return [...rows];
  return rows.filter(
    (row) =>
      row.guaranteeId.toLowerCase().includes(term) || row.tenantName.toLowerCase().includes(term),
  );
}

/**
 * The month's KPI. Always pass the full month's rows: the search box narrows
 * the table only, never the month's total.
 */
export function summarizeCommission(rows: readonly CommissionRowLike[]): CommissionSummary {
  return {
    totalCommissionCents: rows.reduce((sum, row) => sum + row.commissionCents, 0),
    guaranteeCount: rows.length,
  };
}
