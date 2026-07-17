import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Delinquency = Doc<"delinquencies">;
export type DelinquencyId = Id<"delinquencies">;
export type DelinquencyStatus = Delinquency["status"];

export const DELINQUENCY_STATUS = {
  OPEN: "open",
  UNDER_REVIEW: "under_review",
  PROVISIONED: "provisioned",
  PAID: "paid",
  CLOSED: "closed",
} as const satisfies Record<Uppercase<DelinquencyStatus>, DelinquencyStatus>;

export const delinquencyStatusValidator = v.union(
  v.literal(DELINQUENCY_STATUS.OPEN),
  v.literal(DELINQUENCY_STATUS.UNDER_REVIEW),
  v.literal(DELINQUENCY_STATUS.PROVISIONED),
  v.literal(DELINQUENCY_STATUS.PAID),
  v.literal(DELINQUENCY_STATUS.CLOSED),
);

export const DELINQUENCY_ERROR_CODE = {
  NOT_FOUND: "NOT_FOUND",
  CONTRACT_NOT_ACTIVE: "CONTRACT_NOT_ACTIVE",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
} as const satisfies Record<string, string>;

export type DelinquencyErrorCode =
  (typeof DELINQUENCY_ERROR_CODE)[keyof typeof DELINQUENCY_ERROR_CODE];

const LEGAL_TRANSITIONS: Record<DelinquencyStatus, readonly DelinquencyStatus[]> = {
  [DELINQUENCY_STATUS.OPEN]: [DELINQUENCY_STATUS.UNDER_REVIEW, DELINQUENCY_STATUS.CLOSED],
  [DELINQUENCY_STATUS.UNDER_REVIEW]: [DELINQUENCY_STATUS.PROVISIONED, DELINQUENCY_STATUS.CLOSED],
  [DELINQUENCY_STATUS.PROVISIONED]: [DELINQUENCY_STATUS.PAID],
  [DELINQUENCY_STATUS.PAID]: [DELINQUENCY_STATUS.CLOSED],
  [DELINQUENCY_STATUS.CLOSED]: [],
};

export function canTransition(from: DelinquencyStatus, to: DelinquencyStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
