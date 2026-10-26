import { dueDateFor } from "@convex/leases/domain";

/**
 * Case- and accent-insensitive form used to match what an agency types
 * ("joao harmonia") against tenant names and addresses ("João", "Harmonia").
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

type Searchable = {
  tenantName: string;
  streetAndNumber: string;
  complement: string;
  cityUF: string;
  guaranteePublicId: string;
};

/**
 * Every word of the query must appear somewhere in the row, so "harm 410"
 * finds "Rua Harmonia, 410". The public id is matched too, for support calls
 * where someone reads one out, but the UI never asks for it.
 */
export function matchesGuaranteeSearch(row: Searchable, query: string): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeForSearch(
    [row.tenantName, row.streetAndNumber, row.complement, row.cityUF, row.guaranteePublicId].join(
      " ",
    ),
  );
  return words.every((word) => haystack.includes(word));
}

const MAX_REPORTABLE_MONTHS = 12;

/**
 * The months an agency can report late rent for, newest first: from the month
 * the guarantee started (or a year back, whichever is later) up to the latest
 * month whose rent is already overdue. Mirrors the server's
 * `RENT_NOT_YET_DUE` / `RENT_DUE_BEFORE_ACTIVATION` guards so the select never
 * offers a month the mutation would refuse.
 */
export function reportableMonths({
  today,
  dueDay,
  activatedAt,
}: {
  today: string;
  dueDay: number;
  activatedAt: string | null;
}): string[] {
  const activationDate = activatedAt?.slice(0, 10) ?? null;
  const months: string[] = [];
  const [year, month] = today.split("-").map(Number);
  for (let offset = 0; offset <= MAX_REPORTABLE_MONTHS; offset += 1) {
    const referenceMonth = new Date(Date.UTC(year, month - 1 - offset, 1))
      .toISOString()
      .slice(0, 7);
    const dueDate = dueDateFor({ referenceMonth, dueDay });
    if (dueDate === null) continue;
    if (activationDate !== null && dueDate < activationDate) break;
    if (dueDate < today) months.push(referenceMonth);
  }
  return months.slice(0, MAX_REPORTABLE_MONTHS);
}
