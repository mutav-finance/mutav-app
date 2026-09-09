import type { GuaranteeState } from "../guarantees/domain";

/**
 * Platform-wide guarantee figures for the transparency dashboard. One count
 * per lifecycle state, plus the insured roll-up (`countInsured` = the five
 * in-force states, `sumInsuredCents` = their worst-case exposure).
 */
export type GuaranteeAggregates = {
  countByState: Record<GuaranteeState, number>;
  countInsured: number;
  sumInsuredCents: number;
  defaultRate: number | null;
  maxCapacityCents: number;
};

export type ReserveCoverage = { explorerUrl: string } & (
  | {
      available: true;
      storedValueCents: number;
      fxUsdBrl: number;
      fxSource: string;
      fxQuotedAt: string;
      capturedAt: number;
      assetCount: number;
    }
  | { available: false }
);
