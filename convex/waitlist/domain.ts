import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { redactPii } from "../lib/logger";

export type Waitlist = Doc<"waitlist">;
export type WaitlistId = Id<"waitlist">;
export type WaitlistAudience = Waitlist["audience"];

export const WAITLIST_AUDIENCE = {
  INVESTIDOR: "investidor",
  IMOBILIARIA: "imobiliaria",
} as const satisfies Record<Uppercase<WaitlistAudience>, WaitlistAudience>;

export const waitlistAudienceValidator = v.union(
  v.literal(WAITLIST_AUDIENCE.INVESTIDOR),
  v.literal(WAITLIST_AUDIENCE.IMOBILIARIA),
);

export type WaitlistErrorCode = "INVALID_EMAIL" | "DUPLICATE" | "SERVER_ERROR";

export const WAITLIST_ERROR_CODE = {
  INVALID_EMAIL: "INVALID_EMAIL",
  DUPLICATE: "DUPLICATE",
  SERVER_ERROR: "SERVER_ERROR",
} as const satisfies Record<WaitlistErrorCode, WaitlistErrorCode>;

// Simple RFC-5322-ish gate. Real validation happens at delivery time (Resend
// rejects unroutable addresses). We just want to reject obvious garbage so the
// table doesn't accumulate noise.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(input: string): boolean {
  return EMAIL_RE.test(input);
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

// Convex records a function's return value in the deployment function log, so
// a summary is a log channel of its own — the console rules apply to it. A
// failed backfill row is reported as a scrubbed, deduplicated vendor reason
// plus a count; the address it failed for never leaves the action.
export function summarizeBackfillFailures(vendorMessages: readonly string[]): readonly string[] {
  const reasons = vendorMessages.map((message) => redactPii(message));
  return [...new Set(reasons)];
}
