import type { ReactNode } from "react";
import { StatusTag, type Tone } from "./guarantee-state-tag";

/**
 * The status an agency and Mutav staff both read for one late-rent case.
 * Declared here rather than imported from the Convex domain because
 * `@mutav/ui` carries no backend dependency; `apps/agency`'s
 * `claim-status-tag.test.ts` checks this list against `AGENCY_CASE_STATUSES`.
 */
export const CLAIM_STATUS_NAMES = [
  "reported",
  "ready_to_claim",
  "under_review",
  "info_requested",
  "approved",
  "paid",
  "cured",
  "withdrawn",
  "refused",
  "expired",
] as const;

export type ClaimStatusName = (typeof CLAIM_STATUS_NAMES)[number];

/**
 * Tones follow the guarantee the case drives: a reported case leaves the
 * guarantee `in_arrears` (amber) and a confirmed one `default_verified`
 * (orange), so the case tag and the guarantee tag beside it agree. A claim
 * waiting on the agency (`info_requested`) shares the act-now orange.
 */
export const CLAIM_STATUS_TONE: Record<ClaimStatusName, Tone> = {
  reported: "expiring",
  ready_to_claim: "expiring",
  under_review: "caution",
  info_requested: "caution",
  approved: "success",
  paid: "success",
  cured: "success",
  withdrawn: "muted",
  refused: "error",
  expired: "muted",
};

export function ClaimStatusTag({
  status,
  children,
  className,
}: {
  status: ClaimStatusName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <StatusTag tone={CLAIM_STATUS_TONE[status]} className={className}>
      {children}
    </StatusTag>
  );
}
