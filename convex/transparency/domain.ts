import type { GuaranteeState } from "../guarantees/domain";
import type { SolvencyFigures, SolvencyPositionFigures } from "../reserve/domain";
import type { ReserveHealth } from "../reserve/health";
import type { ReservePrices } from "../reserve/prices";
import type { ReserveAccountRef, ReserveSource } from "../reserve/reader";
import type { ValuedReserveHolding } from "../reserve/valuation";

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

/** The account that holds the reserve funds, with its Solana Explorer link so anyone can check the balance. */
export type ReserveAccount = ReserveAccountRef & { explorerUrl: string };

/**
 * Phase-1 reserve health (ADR 0012), read from the latest snapshot: every
 * holding of the reserve account, and the counted balance (BRS + USD
 * stablecoins, in BRL) against the coverage the in-force book requires. All
 * amounts in BRL cents. Copy: "gated by required coverage".
 *
 * `account` is the funds-holding account the figures were read from; before
 * the first snapshot it is the configured one, and null only when none is
 * configured.
 */
export type ReserveHealthReading =
  | ({
      available: true;
      capturedAt: number;
      source: ReserveSource;
      account: ReserveAccount;
      holdings: ValuedReserveHolding[];
      prices: ReservePrices;
      usdStablesUncounted: boolean;
    } & ReserveHealth)
  | { available: false; account: ReserveAccount | null };
