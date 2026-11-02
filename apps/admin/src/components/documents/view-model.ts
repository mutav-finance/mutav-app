import type { GuaranteeDocumentStatus } from "@convex/guarantees/domain";
import type { Tone } from "@mutav/ui/guarantee-state-tag";

/**
 * Every error code the guarantee-document staff mutations put on the wire,
 * mapped to a message key under the `guaranteeDocuments` namespace. An unknown
 * code falls back to `errors.unexpected` rather than echoing the server's
 * English operator sentence. `UPLOAD_FAILED` is the client's own code for a
 * File Storage POST that did not return a storage id.
 */
export const DOCUMENT_ERROR_CODES = [
  "GUARANTEE_NOT_FOUND",
  "GUARANTEE_CLOSED",
  "FILE_NOT_FOUND",
  "FILE_ALREADY_ATTACHED",
  "UNSUPPORTED_CONTENT_TYPE",
  "FILE_TOO_LARGE",
  "FILE_EMPTY",
  "INVALID_FILE_NAME",
  "DOCUMENT_NOT_FOUND",
  "NOT_PENDING_REVIEW",
  "REJECTION_REASON_REQUIRED",
  "REJECTION_REASON_TOO_LONG",
  "UPLOAD_FAILED",
] as const;

export const UPLOAD_FAILED_CODE = "UPLOAD_FAILED";
export const UNEXPECTED_MESSAGE_KEY = "errors.unexpected";
export const FORBIDDEN_MESSAGE_KEY = "errors.FORBIDDEN";

const TRANSLATED_CODES: ReadonlySet<string> = new Set(DOCUMENT_ERROR_CODES);

export function errorMessageKey(code: string): string {
  return TRANSLATED_CODES.has(code) ? `errors.${code}` : UNEXPECTED_MESSAGE_KEY;
}

/**
 * Role gates throw from the wrapper instead of returning a Result, so a
 * support user pressing approve gets an exception — name it as a role
 * problem, not as "something went wrong".
 */
const FORBIDDEN_MESSAGE_PATTERN = /Requires '\w+' role or higher|Not a Mutav staff member/;

export function thrownMessageKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return FORBIDDEN_MESSAGE_PATTERN.test(message) ? FORBIDDEN_MESSAGE_KEY : UNEXPECTED_MESSAGE_KEY;
}

export const DOCUMENT_STATUS_TONE: Record<GuaranteeDocumentStatus, Tone> = {
  pending_review: "accent",
  approved: "success",
  rejected: "error",
  superseded: "muted",
};

/** Mirrors the server allowlist; the server re-checks against storage metadata. */
export const ACCEPTED_FILE_TYPES = "application/pdf,image/jpeg,image/png";

export const DOCUMENT_SLOTS = ["rentalContract", "inspection", "policy"] as const;

export type ApprovalOutcome =
  | { reviewSigned: false; activation: null }
  | {
      reviewSigned: true;
      activation: { outcome: "activated" } | { outcome: "awaiting_capacity" } | null;
    };

/**
 * Which toast an approval earns. Approving the signed rental contract of a
 * draft out for signature also runs the activation (issue #427): it goes
 * active, waits for reserve capacity, or — when a blocker such as an
 * inactive agency holds it back — stays signed.
 */
export function approvalMessageKey(approval: ApprovalOutcome): string {
  if (!approval.reviewSigned) return "toast.approved";
  if (approval.activation === null) return "toast.approvedAndSigned";
  return approval.activation.outcome === "activated"
    ? "toast.approvedAndActivated"
    : "toast.approvedAndWaiting";
}

/** A rejection without a reason tells the agency nothing; the server enforces it too. */
export function canSubmitRejection(reason: string): boolean {
  return reason.trim().length > 0;
}

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes >= BYTES_PER_MEGABYTE) return `${(sizeBytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(sizeBytes / BYTES_PER_KILOBYTE))} KB`;
}
