import {
  CLOSE_REASON_ALLOWED_FROM,
  GUARANTEE_STATE,
  isInsured,
  type GuaranteeState,
} from "@convex/guarantees/domain";
import type { Guarantee } from "./types";

export const DELINQUENCIES_PATH = "/delinquencies";
export const DELINQUENCIES_GUARANTEE_PARAM = "guarantee";

export type OpenDelinquencyAction = { enabled: true } | { enabled: false; reason: "notInForce" };

export type TrackDelinquenciesAction =
  | { enabled: true; href: string }
  | { enabled: false; reason: "neverInForce" };

export type GuaranteeDelinquencyActions = {
  open: OpenDelinquencyAction;
  track: TrackDelinquenciesAction;
};

type GuaranteeForDelinquencyActions = Pick<Guarantee, "id" | "status" | "closure">;

export function delinquenciesHrefFor(guaranteePublicId: string): string {
  const query = new URLSearchParams({ [DELINQUENCIES_GUARANTEE_PARAM]: guaranteePublicId });
  return `${DELINQUENCIES_PATH}?${query.toString()}`;
}

function isStateThatInsures(status: GuaranteeState): boolean {
  return isInsured({ status });
}

// Notices can only be filed while insured, so only a guarantee that was once in
// force can carry notice history. A closed guarantee's reason tells us whether it
// ever was: `canceled_pre_activation` is only legal from `drafted`.
function mayHaveNoticeHistory(guarantee: GuaranteeForDelinquencyActions): boolean {
  if (guarantee.status === GUARANTEE_STATE.DRAFTED) return false;
  if (guarantee.status !== GUARANTEE_STATE.CLOSED || guarantee.closure === null) return true;
  return CLOSE_REASON_ALLOWED_FROM[guarantee.closure.reason].some(isStateThatInsures);
}

export function guaranteeDelinquencyActions(
  guarantee: GuaranteeForDelinquencyActions,
): GuaranteeDelinquencyActions {
  // Mirrors the `isInsured` guard in `delinquencies.mutations.openNotice`, so the
  // button is enabled exactly when the server would accept a notice.
  const open: OpenDelinquencyAction = isInsured(guarantee)
    ? { enabled: true }
    : { enabled: false, reason: "notInForce" };

  const track: TrackDelinquenciesAction = mayHaveNoticeHistory(guarantee)
    ? { enabled: true, href: delinquenciesHrefFor(guarantee.id) }
    : { enabled: false, reason: "neverInForce" };

  return { open, track };
}
