export const COMMISSION_RATE = 0.015;

export type CommissionSplit = {
  /** Broker commission rounded to whole cents. */
  commissionCents: number;
  /** What the payer owes: fee + commission. Guaranteed additive. */
  totalCents: number;
};

/**
 * Split a base fee into its commission component and the total owed.
 * Derives `totalCents` by addition so `total === fee + commission` holds
 * for every input — the `Math.round(fee * 1.015)` form does not.
 */
export function splitCommission(feeCents: number): CommissionSplit {
  const commissionCents = Math.round(feeCents * COMMISSION_RATE);
  return {
    commissionCents,
    totalCents: feeCents + commissionCents,
  };
}
