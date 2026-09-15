import { v } from "convex/values";
import type { Result } from "../lib/result";

export const GUARANTEE_STATE = {
  DRAFTED: "drafted",
  ACTIVE: "active",
  IN_ARREARS: "in_arrears",
  DEFAULT_VERIFIED: "default_verified",
  COVER_COMMITTED: "cover_committed",
  IN_EVICTION: "in_eviction",
  CLOSED: "closed",
} as const;

export type GuaranteeState = (typeof GUARANTEE_STATE)[keyof typeof GUARANTEE_STATE];

export const GUARANTEE_STATES: readonly GuaranteeState[] = [
  GUARANTEE_STATE.DRAFTED,
  GUARANTEE_STATE.ACTIVE,
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
  GUARANTEE_STATE.IN_EVICTION,
  GUARANTEE_STATE.CLOSED,
] as const;

export const TERMINAL_STATES: ReadonlySet<GuaranteeState> = new Set([GUARANTEE_STATE.CLOSED]);

export const isTerminal = (state: GuaranteeState): boolean => TERMINAL_STATES.has(state);

/**
 * Canonical transition table derived from docs/operation/contract-default-scenarios.md
 * in the mutav protocol repo. Each key is the FROM state; the array lists every
 * legal TO state. Self-transitions are always rejected. `closed` has no key
 * (terminal). Keep this table in lockstep with the scenarios doc — the doc is
 * the source of truth, this map is the enforcement point.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<GuaranteeState, readonly GuaranteeState[]>> = {
  drafted: [GUARANTEE_STATE.ACTIVE, GUARANTEE_STATE.CLOSED],
  active: [GUARANTEE_STATE.IN_ARREARS, GUARANTEE_STATE.CLOSED, GUARANTEE_STATE.IN_EVICTION],
  in_arrears: [
    GUARANTEE_STATE.ACTIVE,
    GUARANTEE_STATE.DEFAULT_VERIFIED,
    GUARANTEE_STATE.CLOSED,
    GUARANTEE_STATE.IN_EVICTION,
  ],
  default_verified: [
    GUARANTEE_STATE.COVER_COMMITTED,
    GUARANTEE_STATE.ACTIVE,
    GUARANTEE_STATE.CLOSED,
    GUARANTEE_STATE.IN_EVICTION,
  ],
  cover_committed: [
    GUARANTEE_STATE.ACTIVE,
    GUARANTEE_STATE.IN_ARREARS,
    GUARANTEE_STATE.CLOSED,
    GUARANTEE_STATE.IN_EVICTION,
  ],
  in_eviction: [GUARANTEE_STATE.CLOSED],
  closed: [],
} as const;

export type TransitionError =
  | { code: "SELF_TRANSITION" }
  | { code: "TERMINAL_STATE" }
  | { code: "ILLEGAL_TRANSITION" };

export type TransitionSuccess = { from: GuaranteeState; to: GuaranteeState };

export const assertTransition = (
  from: GuaranteeState,
  to: GuaranteeState,
): Result<TransitionSuccess, TransitionError> => {
  if (from === to) {
    return {
      success: false,
      error: { code: "SELF_TRANSITION" },
      message: `Refusing self-transition on guarantee state "${from}".`,
    };
  }
  if (isTerminal(from)) {
    return {
      success: false,
      error: { code: "TERMINAL_STATE" },
      message: `Guarantee state "${from}" is terminal; no outbound transitions permitted.`,
    };
  }
  const legalTargets = ALLOWED_TRANSITIONS[from];
  if (!legalTargets.includes(to)) {
    return {
      success: false,
      error: { code: "ILLEGAL_TRANSITION" },
      message: `Illegal guarantee transition ${from} -> ${to}. Allowed from ${from}: ${legalTargets.join(", ") || "(none)"}.`,
    };
  }
  return {
    success: true,
    data: { from, to },
    message: `Guarantee transition ${from} -> ${to} approved.`,
  };
};

export const CLOSE_REASON = {
  END_OF_LEASE: "end_of_lease",
  RESCISSION: "rescission",
  ABANDONMENT: "abandonment",
  EVICTION: "eviction",
  DISPUTE_REVERSAL: "dispute_reversal",
  CANCELED_PRE_ACTIVATION: "canceled_pre_activation",
  DEATH: "death",
} as const;

export type CloseReason = (typeof CLOSE_REASON)[keyof typeof CLOSE_REASON];

export const CLOSE_REASONS: readonly CloseReason[] = [
  CLOSE_REASON.END_OF_LEASE,
  CLOSE_REASON.RESCISSION,
  CLOSE_REASON.ABANDONMENT,
  CLOSE_REASON.EVICTION,
  CLOSE_REASON.DISPUTE_REVERSAL,
  CLOSE_REASON.CANCELED_PRE_ACTIVATION,
  CLOSE_REASON.DEATH,
] as const;

export const closeReasonValidator = v.union(
  v.literal(CLOSE_REASON.END_OF_LEASE),
  v.literal(CLOSE_REASON.RESCISSION),
  v.literal(CLOSE_REASON.ABANDONMENT),
  v.literal(CLOSE_REASON.EVICTION),
  v.literal(CLOSE_REASON.DISPUTE_REVERSAL),
  v.literal(CLOSE_REASON.CANCELED_PRE_ACTIVATION),
  v.literal(CLOSE_REASON.DEATH),
);

/**
 * A draft is canceled, never ended: the lease-ending reasons exclude `drafted`
 * on purpose, and `canceled_pre_activation` is the only way out of it.
 */
const ENDED_FROM_ANY_ACTIVATED_STATE: readonly GuaranteeState[] = [
  GUARANTEE_STATE.ACTIVE,
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
  GUARANTEE_STATE.IN_EVICTION,
] as const;

export const CLOSE_REASON_ALLOWED_FROM: Readonly<Record<CloseReason, readonly GuaranteeState[]>> = {
  end_of_lease: ENDED_FROM_ANY_ACTIVATED_STATE,
  rescission: ENDED_FROM_ANY_ACTIVATED_STATE,
  abandonment: ENDED_FROM_ANY_ACTIVATED_STATE,
  death: ENDED_FROM_ANY_ACTIVATED_STATE,
  eviction: [GUARANTEE_STATE.IN_EVICTION],
  dispute_reversal: [GUARANTEE_STATE.DEFAULT_VERIFIED, GUARANTEE_STATE.COVER_COMMITTED],
  canceled_pre_activation: [GUARANTEE_STATE.DRAFTED],
} as const;

export type CloseError = { code: "TERMINAL_STATE" } | { code: "REASON_NOT_ALLOWED_FROM_STATE" };

export type CloseSuccess = { from: GuaranteeState; reason: CloseReason };

export const assertClose = (
  from: GuaranteeState,
  reason: CloseReason,
): Result<CloseSuccess, CloseError> => {
  if (isTerminal(from)) {
    return {
      success: false,
      error: { code: "TERMINAL_STATE" },
      message: `Guarantee state "${from}" is terminal; it cannot be closed again.`,
    };
  }
  const legalOrigins = CLOSE_REASON_ALLOWED_FROM[reason];
  if (!legalOrigins.includes(from)) {
    return {
      success: false,
      error: { code: "REASON_NOT_ALLOWED_FROM_STATE" },
      message: `Close reason "${reason}" is not allowed from guarantee state "${from}". Allowed from: ${legalOrigins.join(", ")}.`,
    };
  }
  return {
    success: true,
    data: { from, reason },
    message: `Guarantee close from ${from} with reason "${reason}" approved.`,
  };
};
