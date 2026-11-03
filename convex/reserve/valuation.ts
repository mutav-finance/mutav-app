import {
  isCoverageEligible,
  RESERVE_ASSET_KIND,
  type ReserveAssetKind,
  type ReserveTokenProgram,
} from "./assets";
import { BRS_DECIMALS } from "./health";
import type { ReservePrices } from "./prices";

/**
 * Values the vault's holdings in BRL and sums the ones that count toward
 * required coverage. Every figure rounds down, so neither a holding nor the
 * counted total is ever overstated.
 *
 * The counted total is expressed in BRS base units (BRL at 6 decimals,
 * 1 BRS = R$1) so it stays comparable with the offer holds and the
 * activation preflight, which already speak that unit.
 */

/** One balance the vault holds, as read from chain. */
export type ReserveHolding = {
  mint: string;
  /** Registry symbol; null for a mint the registry does not know. */
  symbol: string | null;
  kind: ReserveAssetKind;
  tokenProgram: ReserveTokenProgram;
  decimals: number;
  amountBaseUnits: bigint;
};

/** A holding as stored on the snapshot and shown on the transparency page. */
export type ValuedReserveHolding = Omit<ReserveHolding, "amountBaseUnits"> & {
  /** Unscaled base units as a base-10 string — the audit-trail figure. */
  amountBaseUnits: string;
  /** BRL value in cents; null when no price applies (unknown mint, or a price feed was down). */
  valueCents: number | null;
  /** Whether this holding's value is part of the counted total. */
  counted: boolean;
};

export type ReserveValuation = {
  holdings: ValuedReserveHolding[];
  /** Σ counted holdings, in BRS base units. */
  countedBaseUnits: bigint;
  /** USD stablecoins are held but PTAX was unavailable, so they were left out of the counted total. */
  usdStablesUncounted: boolean;
};

const MICRO = BigInt(1_000_000);
const BRL_BASE_UNITS_PER_CENT = BigInt(10) ** BigInt(BRS_DECIMALS) / BigInt(100);

function toMicro(rate: number): bigint {
  return BigInt(Math.round(rate * 1_000_000));
}

function scaleOf(decimals: number): bigint {
  return BigInt(10) ** BigInt(decimals);
}

/** Base units of an asset → BRL in BRS base units (6 decimals), or null when it cannot be priced. */
function brlBaseUnitsOf(holding: ReserveHolding, prices: ReservePrices): bigint | null {
  const { amountBaseUnits: raw, decimals } = holding;
  const brlPerUnitScale = scaleOf(BRS_DECIMALS);
  switch (holding.kind) {
    case RESERVE_ASSET_KIND.BRL_STABLE:
      return (raw * brlPerUnitScale) / scaleOf(decimals);
    case RESERVE_ASSET_KIND.USD_STABLE:
      if (!prices.usdBrl) return null;
      return (raw * toMicro(prices.usdBrl.rate) * brlPerUnitScale) / (scaleOf(decimals) * MICRO);
    case RESERVE_ASSET_KIND.SOL:
      if (!prices.usdBrl || !prices.solUsd) return null;
      return (
        (raw * toMicro(prices.solUsd.price) * toMicro(prices.usdBrl.rate) * brlPerUnitScale) /
        (scaleOf(decimals) * MICRO * MICRO)
      );
    case RESERVE_ASSET_KIND.UNKNOWN:
      return null;
  }
}

export function valueReserveHoldings(
  holdings: readonly ReserveHolding[],
  prices: ReservePrices,
): ReserveValuation {
  let countedBaseUnits = BigInt(0);
  let usdStablesUncounted = false;
  const valued = holdings.map((holding): ValuedReserveHolding => {
    const brl = brlBaseUnitsOf(holding, prices);
    const counted = brl !== null && isCoverageEligible(holding.kind);
    if (counted) countedBaseUnits += brl;
    if (
      holding.kind === RESERVE_ASSET_KIND.USD_STABLE &&
      brl === null &&
      holding.amountBaseUnits > BigInt(0)
    ) {
      usdStablesUncounted = true;
    }
    return {
      ...holding,
      amountBaseUnits: holding.amountBaseUnits.toString(),
      valueCents: brl === null ? null : Number(brl / BRL_BASE_UNITS_PER_CENT),
      counted,
    };
  });
  return { holdings: valued, countedBaseUnits, usdStablesUncounted };
}
