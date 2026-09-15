import type { GuaranteeCapacity } from "@convex/guarantees/domain";

/**
 * The three staff dispositions this screen offers, each bound to one Convex
 * mutation. Batch cover is deliberately absent: `staffMarkResolvedByCover`
 * takes a single notice, and a UI loop over it would report a partial failure
 * as a success.
 */
export const DEFAULT_ACTION = {
  VERIFY: "verify",
  COVER: "cover",
  DISMISS: "dismiss",
} as const satisfies Record<string, string>;

export type DefaultAction = (typeof DEFAULT_ACTION)[keyof typeof DEFAULT_ACTION];

/**
 * Every error code the three mutations can put on the wire, mapped to a
 * message key under the `defaults` namespace. A code absent from this set
 * falls back to `errors.unexpected` rather than rendering the server's own
 * sentence — the server writes those in English for operators reading logs,
 * and `next-intl` would echo a missing key verbatim.
 *
 * The transition codes (`SELF_TRANSITION`, `TERMINAL_STATE`,
 * `ILLEGAL_TRANSITION`) come from the NOTICE machine. A refusal from the
 * GUARANTEE machine arrives collapsed as `GUARANTEE_TRANSITION_REFUSED`,
 * which is why its message has to describe the class of problem rather than
 * the specific hop.
 *
 * `CLOSURE_REQUIRED`, `CLOSURE_NOT_ALLOWED`, `GUARANTEE_CLOSED` and
 * `INVALID_RENEWAL_DATE` are the guarantee-domain siblings PR5 added. They are
 * not reachable from these three mutations today — the guarantee lifecycle
 * mutations that return them are bound to other screens — but they belong to
 * the same error surface, so they are translated here rather than waiting to
 * surface untranslated.
 */
export const DEFAULTS_ERROR_CODES = [
  "NOTICE_NOT_FOUND",
  "NOTICE_NOT_VERIFIED",
  "SELF_TRANSITION",
  "TERMINAL_STATE",
  "ILLEGAL_TRANSITION",
  "GUARANTEE_TRANSITION_REFUSED",
  "INVALID_AMOUNT",
  "CAPACITY_INVARIANT_BROKEN",
  "RELEASE_EXCEEDS_RESERVED",
  "CLOSURE_REQUIRED",
  "CLOSURE_NOT_ALLOWED",
  "GUARANTEE_CLOSED",
  "INVALID_RENEWAL_DATE",
] as const;

export type DefaultsErrorCode = (typeof DEFAULTS_ERROR_CODES)[number];

const TRANSLATED_CODES: ReadonlySet<string> = new Set(DEFAULTS_ERROR_CODES);

export const UNEXPECTED_MESSAGE_KEY = "errors.unexpected";
export const FORBIDDEN_MESSAGE_KEY = "errors.FORBIDDEN";

export function errorMessageKey(code: string): string {
  return TRANSLATED_CODES.has(code) ? `errors.${code}` : UNEXPECTED_MESSAGE_KEY;
}

/**
 * The minimum a caller has to hand over. Typing against the generated Convex
 * return would drag `_generated/api` into the pure module and make it
 * untestable without a deployment.
 */
export type DispositionResult = { success: true } | { success: false; error: { code: string } };

export type ActionOutcome =
  | { kind: "success"; messageKey: string }
  | { kind: "error"; messageKey: string };

const SUCCESS_MESSAGE_KEY: Record<DefaultAction, string> = {
  verify: "toast.verified",
  cover: "toast.covered",
  dismiss: "toast.dismissed",
};

export function outcomeForResult({
  action,
  result,
}: {
  action: DefaultAction;
  result: DispositionResult;
}): ActionOutcome {
  if (!result.success) {
    return { kind: "error", messageKey: errorMessageKey(result.error.code) };
  }
  return { kind: "success", messageKey: SUCCESS_MESSAGE_KEY[action] };
}

/**
 * `mutationWithMutavRole` THROWS on an authorization failure instead of
 * returning a `Result` — the role gate runs in the wrapper, before the
 * handler that owns the result type. A staff member below `compliance` who
 * reaches this screen (the server gate admits any `mutavStaff` row, the
 * mutation demands the compliance rung) therefore gets an exception, and
 * without this branch it would read as "something went wrong" when the real
 * answer is "your role cannot do this".
 */
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

export type CoverPreview = {
  /** What the operator is asking to pay out — the notice's updated amount. */
  requestedCents: number;
  /** What the guarantee can still reserve. */
  availableCents: number;
  /** What `reserveCoverCapacity` will actually apply: `min` of the two. */
  appliedCents: number;
  /** True when the ceiling, not the claim, decides the payout. */
  clamped: boolean;
  /** The part of the claim no coverage remains for. Zero when not clamped. */
  shortfallCents: number;
};

/**
 * Restates the clamp `reserveCoverCapacity` performs server-side so the
 * operator sees the number that will land BEFORE submitting. The server is
 * still the authority — this is a preview, not a second implementation of the
 * rule — but a cover that silently pays less than the claim is exactly the
 * surprise a reserve operator must never get from a confirmation dialog.
 */
export function coverPreview({
  requestedCents,
  capacity,
}: {
  requestedCents: number;
  capacity: GuaranteeCapacity;
}): CoverPreview {
  const availableCents = capacity.availableCents;
  const appliedCents = Math.min(availableCents, requestedCents);
  return {
    requestedCents,
    availableCents,
    appliedCents,
    clamped: appliedCents < requestedCents,
    shortfallCents: requestedCents - appliedCents,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long a notice has sat in the queue. Whole days, floored, never negative
 * — a seeded `openedAt` in the future would otherwise render "-3 days open".
 */
export function daysOpen({ openedAt, now }: { openedAt: string; now: number }): number {
  const opened = new Date(openedAt).getTime();
  if (Number.isNaN(opened)) return 0;
  return Math.max(0, Math.floor((now - opened) / MS_PER_DAY));
}
