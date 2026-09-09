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
  // Facade-window aliases (the 7→4 `toLegacyStatus` mapping: in-force states
  // → ativo, drafted → pendente) so the agency transparency panel keeps
  // compiling until PR4 renders `countByState`. Removed with the facade.
  countAtivos: number;
  countPendentes: number;
};

/** Facade-window alias for the agency transparency panels; removed with the facade in PR4. */
export type ContractAggregates = GuaranteeAggregates;

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
