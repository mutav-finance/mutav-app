import type { Result } from "../lib/result";

/**
 * Delinquency notice lifecycle.
 *
 * A DIFFERENT object from the guarantee state ({@link ../guarantees/machine.ts}).
 * A notice is a per-event record ("agency reports tenant missed rent on this
 * date for this amount"); the guarantee state is contract-level.
 *
 * One contract can accumulate many notices over its life. Each notice moves
 * independently through this 3-status machine. Terms match the vocabulary
 * used in the existing agency UI (`apps/agency/src/components/delinquencies/`).
 */
export const DELINQUENCY_STATUS = {
  PENDENCIA_ABERTA: "pendencia_aberta",
  ENTREGUE: "entregue",
  CANCELADO: "cancelado",
} as const;

export type DelinquencyStatus = (typeof DELINQUENCY_STATUS)[keyof typeof DELINQUENCY_STATUS];

export const DELINQUENCY_STATUSES: readonly DelinquencyStatus[] = [
  DELINQUENCY_STATUS.PENDENCIA_ABERTA,
  DELINQUENCY_STATUS.ENTREGUE,
  DELINQUENCY_STATUS.CANCELADO,
] as const;

/**
 * Terminal statuses cannot be un-terminated. A resolved notice (`entregue`)
 * cannot become `cancelado`, and vice-versa. If a resolution turns out to be
 * wrong, open a new notice or a dispute — never mutate a terminal one.
 */
export const TERMINAL_STATUSES: ReadonlySet<DelinquencyStatus> = new Set([
  DELINQUENCY_STATUS.ENTREGUE,
  DELINQUENCY_STATUS.CANCELADO,
]);

export const isTerminal = (status: DelinquencyStatus): boolean => TERMINAL_STATUSES.has(status);

/**
 * The only two legal exits from `pendencia_aberta`. Resolution semantics
 * (WHY it went to entregue — tenant cured vs cover committed vs staff
 * dispute) live on the row's `resolution` field, not in this machine.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<DelinquencyStatus, readonly DelinquencyStatus[]>
> = {
  pendencia_aberta: [DELINQUENCY_STATUS.ENTREGUE, DELINQUENCY_STATUS.CANCELADO],
  entregue: [],
  cancelado: [],
} as const;

export type TransitionError =
  | { code: "SELF_TRANSITION" }
  | { code: "TERMINAL_STATE" }
  | { code: "ILLEGAL_TRANSITION" };

export type TransitionSuccess = { from: DelinquencyStatus; to: DelinquencyStatus };

export const assertTransition = (
  from: DelinquencyStatus,
  to: DelinquencyStatus,
): Result<TransitionSuccess, TransitionError> => {
  if (from === to) {
    return {
      success: false,
      error: { code: "SELF_TRANSITION" },
      message: `Refusing self-transition on delinquency status "${from}".`,
    };
  }
  if (isTerminal(from)) {
    return {
      success: false,
      error: { code: "TERMINAL_STATE" },
      message: `Delinquency status "${from}" is terminal; no outbound transitions permitted.`,
    };
  }
  const legalTargets = ALLOWED_TRANSITIONS[from];
  if (!legalTargets.includes(to)) {
    return {
      success: false,
      error: { code: "ILLEGAL_TRANSITION" },
      message: `Illegal delinquency transition ${from} -> ${to}. Allowed from ${from}: ${legalTargets.join(", ") || "(none)"}.`,
    };
  }
  return {
    success: true,
    data: { from, to },
    message: `Delinquency transition ${from} -> ${to} approved.`,
  };
};
