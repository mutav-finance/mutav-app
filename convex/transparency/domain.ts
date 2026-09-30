import type { GuaranteeState } from "../guarantees/domain";
import type { SolvencyFigures, SolvencyPositionFigures } from "../reserve/domain";

/**
 * Platform-wide guarantee figures for the transparency dashboard. One count
 * per lifecycle state, plus the insured roll-up (`countInsured` = the five
 * in-force states, `sumInsuredCents` = their worst-case exposure in BRL
 * centavos) and the slice of that exposure already in verified default.
 */
export type GuaranteeAggregates = {
  countByState: Record<GuaranteeState, number>;
  countInsured: number;
  sumInsuredCents: number;
  countVerifiedDefault: number;
  verifiedDefaultExposureCents: number;
  defaultRate: number | null;
};

export type StellarNetworkName = "testnet" | "public";

/** A contract id rendered as text, with its block-explorer link. */
export type ContractReference = { id: string; explorerUrl: string };

export type ReserveSolvencyPosition = SolvencyPositionFigures & { explorerUrl: string };

/**
 * The on-chain solvency read of the mutav-pulse reserve. Every amount is in
 * whole units of `assetSymbol` (the vault's deposit token — cUSD on testnet),
 * never BRL: the conversion caveat lives in `docs/transparency-metrics.md`.
 */
export type ReserveSolvency = Omit<SolvencyFigures, "positions"> & {
  network: StellarNetworkName;
  assetSymbol: string;
  contracts: {
    vault: ContractReference;
    policy: ContractReference;
    registry: ContractReference;
  };
  positions: ReserveSolvencyPosition[];
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
      solvency: ReserveSolvency | null;
    }
  | { available: false }
);
