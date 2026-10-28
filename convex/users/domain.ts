import type { Doc, Id } from "../_generated/dataModel";

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = Doc<"users">;
export type UserId = Id<"users">;

// ─── Error codes ──────────────────────────────────────────────────────────────

export const USER_ERROR_CODE = {
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  EMAIL_BOUND_TO_OTHER_IDENTITY: "EMAIL_BOUND_TO_OTHER_IDENTITY",
} as const satisfies Record<string, string>;

export type UserErrorCode = (typeof USER_ERROR_CODE)[keyof typeof USER_ERROR_CODE];
