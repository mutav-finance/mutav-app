/** Format a period month string like "2026-04" into a human-readable label. */
export function formatPeriodMonth(periodMonth: string): string {
  const [year, month] = periodMonth.split("-");
  if (!year || !month) return periodMonth;
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return periodMonth;
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}
