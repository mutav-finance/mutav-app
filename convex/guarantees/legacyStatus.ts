import { CLOSE_REASON, GUARANTEE_STATE, type CloseReason, type GuaranteeState } from "./machine";

export const LEGACY_CONTRACT_STATUS = {
  PENDENTE: "pendente",
  ATIVO: "ativo",
  ENCERRADO: "encerrado",
  CANCELADO: "cancelado",
} as const;

export type LegacyContractStatus =
  (typeof LEGACY_CONTRACT_STATUS)[keyof typeof LEGACY_CONTRACT_STATUS];

/**
 * Exists only so the PR2 facade can keep the agency UI rendering the four
 * legacy contract statuses until PR4 replaces that UI with the guarantee
 * state. Delete together with the facade.
 */
export const toLegacyStatus = (
  state: GuaranteeState,
  closeReason?: CloseReason,
): LegacyContractStatus => {
  switch (state) {
    case GUARANTEE_STATE.DRAFTED:
      return LEGACY_CONTRACT_STATUS.PENDENTE;
    case GUARANTEE_STATE.ACTIVE:
    case GUARANTEE_STATE.IN_ARREARS:
    case GUARANTEE_STATE.DEFAULT_VERIFIED:
    case GUARANTEE_STATE.COVER_COMMITTED:
    case GUARANTEE_STATE.IN_EVICTION:
      return LEGACY_CONTRACT_STATUS.ATIVO;
    case GUARANTEE_STATE.CLOSED:
      return closeReason === CLOSE_REASON.CANCELED_PRE_ACTIVATION
        ? LEGACY_CONTRACT_STATUS.CANCELADO
        : LEGACY_CONTRACT_STATUS.ENCERRADO;
  }
};
