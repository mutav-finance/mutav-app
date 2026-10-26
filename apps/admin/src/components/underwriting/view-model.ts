import {
  BASIS_POINTS_PER_UNIT,
  MAX_STAFF_FEE_RATE_BPS,
  MIN_STAFF_FEE_RATE_BPS,
} from "@convex/guarantees/review";

/**
 * Pure decisions behind the underwriting screens: what a rate input parses
 * to, which message an outcome earns. The hooks own state and toasts; the
 * tests live here.
 */

export const UNDERWRITING_ACTION = {
  ACCEPT: "accept",
  REFUSE: "refuse",
  SEND: "send",
} as const satisfies Record<string, string>;

export type UnderwritingAction = (typeof UNDERWRITING_ACTION)[keyof typeof UNDERWRITING_ACTION];

/**
 * Every code the three staff decisions can return, each with a message under
 * `underwriting.errors`. Anything else falls back to `errors.unexpected`
 * rather than the server's English sentence.
 */
export const UNDERWRITING_ERROR_CODES = [
  "NOT_FOUND",
  "NOT_DRAFTED",
  "CAPACITY_INVARIANT_BROKEN",
  "INVALID_FEE_RATE",
  "TEXT_TOO_LONG",
  "REFUSAL_REASON_REQUIRED",
  "PRODUCT_UNAVAILABLE",
  "REVIEW_SELF_TRANSITION",
  "REVIEW_TERMINAL",
  "REVIEW_ILLEGAL_TRANSITION",
  "SELF_TRANSITION",
  "TERMINAL_STATE",
  "ILLEGAL_TRANSITION",
  "REASON_NOT_ALLOWED_FROM_STATE",
  "CLOSURE_REQUIRED",
  "CLOSURE_NOT_ALLOWED",
  // Sending for signature reads the reserve and holds capital (ADR 0010).
  "INVALID_HOLD_DAYS",
  "INSUFFICIENT_FREE_CAPITAL",
  "TOO_MANY_OPEN_HOLDS",
  "OFFER_STILL_HELD",
  "INVALID_RESERVE_READING",
  "RESERVE_READER_UNAVAILABLE",
] as const;

const TRANSLATED_CODES: ReadonlySet<string> = new Set(UNDERWRITING_ERROR_CODES);

export const UNEXPECTED_MESSAGE_KEY = "errors.unexpected";
export const FORBIDDEN_MESSAGE_KEY = "errors.FORBIDDEN";

export function errorMessageKey(code: string): string {
  return TRANSLATED_CODES.has(code) ? `errors.${code}` : UNEXPECTED_MESSAGE_KEY;
}

export type DecisionResult = { success: true } | { success: false; error: { code: string } };

export type ActionOutcome = { kind: "success" | "error"; messageKey: string };

const SUCCESS_MESSAGE_KEY: Record<UnderwritingAction, string> = {
  accept: "toast.accepted",
  refuse: "toast.refused",
  send: "toast.sent",
};

export function outcomeForResult({
  action,
  result,
}: {
  action: UnderwritingAction;
  result: DecisionResult;
}): ActionOutcome {
  if (!result.success) return { kind: "error", messageKey: errorMessageKey(result.error.code) };
  return { kind: "success", messageKey: SUCCESS_MESSAGE_KEY[action] };
}

/** The role gate throws in the wrapper instead of returning a Result. */
const FORBIDDEN_MESSAGE_PATTERN = /Requires '\w+' role or higher|Not a Mutav staff member/;

export function outcomeForThrown(error: unknown): ActionOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "error",
    messageKey: FORBIDDEN_MESSAGE_PATTERN.test(message)
      ? FORBIDDEN_MESSAGE_KEY
      : UNEXPECTED_MESSAGE_KEY,
  };
}

const BASIS_POINTS_PER_PERCENT = BASIS_POINTS_PER_UNIT / 100;
const RATE_INPUT_PATTERN = /^\d{1,2}([.,]\d{1,2})?$/;

/**
 * `"13"` → 1300, `"12,5"` → 1250. `null` for anything that is not a percent
 * with at most two decimals, or that falls outside the bounds the server
 * enforces — the button stays disabled rather than sending a sure refusal.
 */
export function parseRatePercent(input: string): number | null {
  const trimmed = input.trim();
  if (!RATE_INPUT_PATTERN.test(trimmed)) return null;
  const bps = Math.round(Number(trimmed.replace(",", ".")) * BASIS_POINTS_PER_PERCENT);
  if (bps < MIN_STAFF_FEE_RATE_BPS || bps > MAX_STAFF_FEE_RATE_BPS) return null;
  return bps;
}

/** The accept dialog opens on the rate the draft is currently quoted at. */
export function ratePercentInput(bps: number): string {
  return String(bps / BASIS_POINTS_PER_PERCENT);
}

export const RATE_BOUNDS_PERCENT = {
  min: MIN_STAFF_FEE_RATE_BPS / BASIS_POINTS_PER_PERCENT,
  max: MAX_STAFF_FEE_RATE_BPS / BASIS_POINTS_PER_PERCENT,
} as const;

const HOLD_DAYS_INPUT_PATTERN = /^\d{1,2}$/;
const MIN_HOLD_DAYS = 1;
const MAX_HOLD_DAYS = 90;

/**
 * The optional per-contract hold period. Blank means "use the agency,
 * product or platform setting" (`undefined`); a whole number of days in range
 * is the override; anything else is `null` and keeps the button disabled.
 */
export function parseHoldDaysInput(input: string): number | undefined | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  if (!HOLD_DAYS_INPUT_PATTERN.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= MIN_HOLD_DAYS && days <= MAX_HOLD_DAYS ? days : null;
}

export const HOLD_DAYS_BOUNDS = { min: MIN_HOLD_DAYS, max: MAX_HOLD_DAYS } as const;

const DAY_MS = 86_400_000;

/** Whole days a request has waited, floored, never negative. */
export function daysWaiting({ requestedAt, now }: { requestedAt: string; now: number }): number {
  const elapsed = now - new Date(requestedAt).getTime();
  return Number.isNaN(elapsed) ? 0 : Math.max(0, Math.floor(elapsed / DAY_MS));
}
