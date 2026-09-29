import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type CoverOperation = Doc<"coverOperations">;
export type CoverOperationId = Id<"coverOperations">;
export type CoverOperationExecution = NonNullable<CoverOperation["execution"]>;

/**
 * Two phases, one direction. `recorded` = compliance committed cover against
 * a verified default and capacity is reserved; `executed` = the off-chain
 * payout to the landlord has left and carries its payment reference. There is
 * no way back from `executed`: a payout that has left is undone by a new
 * receivable, not by rewriting this row.
 */
export const COVER_OPERATION_STATUS = {
  RECORDED: "recorded",
  EXECUTED: "executed",
} as const satisfies Record<string, string>;

export type CoverOperationStatus =
  (typeof COVER_OPERATION_STATUS)[keyof typeof COVER_OPERATION_STATUS];

export const coverOperationStatusValidator = v.union(
  v.literal(COVER_OPERATION_STATUS.RECORDED),
  v.literal(COVER_OPERATION_STATUS.EXECUTED),
);

export const COVER_OPERATION_ERROR_CODE = {
  EMPTY_BATCH: "EMPTY_BATCH",
  BATCH_TOO_LARGE: "BATCH_TOO_LARGE",
  DUPLICATE_NOTICE_IN_BATCH: "DUPLICATE_NOTICE_IN_BATCH",
  COVER_ALREADY_RECORDED: "COVER_ALREADY_RECORDED",
  COVER_OPERATION_NOT_FOUND: "COVER_OPERATION_NOT_FOUND",
  COVER_ALREADY_EXECUTED: "COVER_ALREADY_EXECUTED",
  PAYMENT_REFERENCE_REQUIRED: "PAYMENT_REFERENCE_REQUIRED",
} as const satisfies Record<string, string>;

/**
 * Upper bound on one batch. A batch is one transaction, and every notice in
 * it costs a handful of reads and writes (notice, guarantee, capacity,
 * history, aggregates, two audit entries); the bound keeps the worst case far
 * inside Convex's per-mutation limits. It matches the defaults queue's page
 * size, which is the most rows an operator can select at once.
 */
export const MAX_COVER_BATCH_SIZE = 25;

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-\d{2}/;

/**
 * The billing month a notice's missed rent belongs to, as `YYYY-MM` — the
 * period half of ADR 0004's `(guaranteeId, coveragePeriod)` idempotency key.
 * Read straight off the ISO date string rather than through `Date`: a
 * `YYYY-MM-DD` parsed as a Date is UTC midnight, and any local-time
 * formatting would slide the first of the month into the previous one.
 * Returns null for a string that is not an ISO date so the caller refuses the
 * notice instead of minting a key like `"NaN-NaN"`.
 */
export function coveragePeriodOf(rentDueDate: string): string | null {
  const match = ISO_DATE_PREFIX.exec(rentDueDate);
  if (!match) return null;
  const [, year, month] = match;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return null;
  return `${year}-${month}`;
}

export const isExecuted = (status: CoverOperationStatus): boolean =>
  status === COVER_OPERATION_STATUS.EXECUTED;
