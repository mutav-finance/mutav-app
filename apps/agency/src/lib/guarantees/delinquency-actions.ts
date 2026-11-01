import { isInsured } from "@convex/guarantees/domain";
import type { Guarantee } from "./types";

export const CLAIMS_PATH = "/claims";
/** `?case=<notice publicId>` opens a case panel; `?case=new` opens the report sheet. */
export const CLAIMS_CASE_PARAM = "case";
export const CLAIMS_NEW_VALUE = "new";

export function claimHrefFor(noticePublicId: string): string {
  const query = new URLSearchParams({ [CLAIMS_CASE_PARAM]: noticePublicId });
  return `${CLAIMS_PATH}?${query.toString()}`;
}

export type ReportLateRentAction = { enabled: true } | { enabled: false; reason: "notInForce" };

/**
 * Mirrors the `isInsured` guard in `delinquencies.mutations.openNotice`, so the
 * action is offered exactly when the server would accept a report.
 */
export function reportLateRentAction(guarantee: Pick<Guarantee, "status">): ReportLateRentAction {
  return isInsured(guarantee) ? { enabled: true } : { enabled: false, reason: "notInForce" };
}
