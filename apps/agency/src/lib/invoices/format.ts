/**
 * Current UTC date as a `YYYY-MM-DD` string — the format the invoice
 * `dueDate` uses, so string comparison is a valid date comparison for
 * deriving overdue status on the client.
 */
export function utcTodayDate(): string {
  return new Date().toISOString().split("T")[0]!;
}
