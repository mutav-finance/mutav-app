/**
 * Current UTC date as a `YYYY-MM-DD` string — the format the invoice
 * `dueDate` uses, so string comparison is a valid date comparison for
 * deriving overdue status on the client.
 */
export function utcTodayDate(): string {
  return new Date().toISOString().split("T")[0]!;
}

/** Format a period month string like "2026-04" into a human-readable label. */
export function formatPeriodMonth(periodMonth: string): string {
  const [year, month] = periodMonth.split("-");
  if (!year || !month) return periodMonth;
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return periodMonth;
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}
