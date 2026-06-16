import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type ReserveSnapshot = Doc<"reserveSnapshots">;
export type ReserveSnapshotId = Id<"reserveSnapshots">;

/** One approved asset held by the reserve vault, as read from chain. */
export type ReserveAsset = {
  contractAddress: string; // SEP-41 token contract id (C...)
  symbol: string; // SEP-41 symbol(), e.g. "BRLT"
  decimals: number; // SEP-41 decimals()
  rawBalance: string; // i128 balance() as an unscaled base-10 string
};

/** A reserve asset priced into BRL cents at the snapshot's FX rate (stored shape). */
export type ReserveValuedAsset = ReserveAsset & { valueCents: number };

/**
 * Outcome of a reserve read. NEVER a mock: when the contract is unconfigured
 * or the RPC read fails, `available` is false and the dashboard shows no number.
 */
export type ReserveReadResult =
  | {
      available: true;
      storedValueCents: number;
      fxUsdBrl: number;
      fxSource: string;
      fxQuotedAt: string;
      assets: ReserveValuedAsset[];
    }
  | { available: false };

export const reserveAssetValidator = v.object({
  contractAddress: v.string(),
  symbol: v.string(),
  decimals: v.number(),
  rawBalance: v.string(),
  valueCents: v.number(),
});

/** Symbol→BRL rate inputs for a single reserve read. */
export type ReservePricing = {
  brlSymbols: readonly string[];
  usdSymbols: readonly string[];
  usdBrlRate: number;
};

/**
 * Convert an unscaled i128 balance string + token decimals into BRL cents.
 * Pure integer math (BigInt) to avoid float drift on large i128 values.
 * Rounds half up by magnitude (away from zero for negative inputs — a reserve balance is never negative).
 */
export function rawBalanceToCents(rawBalance: string, decimals: number): number {
  const negative = rawBalance.startsWith("-");
  const digits = negative ? rawBalance.slice(1) : rawBalance;
  const raw = BigInt(digits.length ? digits : "0");
  const scale = BigInt(10) ** BigInt(decimals);
  const centsScaled = raw * BigInt(100);
  const whole = centsScaled / scale;
  const remainder = centsScaled % scale;
  const rounded = remainder * BigInt(2) >= scale ? whole + BigInt(1) : whole;
  const result = Number(rounded);
  return negative ? -result : result;
}

/**
 * BRL rate for an asset by symbol: 1 for BRL-pegged, the live USD→BRL rate for
 * USD-pegged, null when no price feed applies (excluded from the headline).
 */
export function assetRateBrl(symbol: string, pricing: ReservePricing): number | null {
  if (pricing.brlSymbols.includes(symbol)) return 1;
  if (pricing.usdSymbols.includes(symbol)) return pricing.usdBrlRate;
  return null;
}

/**
 * Value an i128 balance into BRL cents at `rateBrl`. Quantizes the rate to
 * micro-units so the conversion stays integer math:
 *   cents = round(raw × rateMicro / (10^decimals × 1e4)).
 * Note `assetValueCents(raw, dec, 1) === rawBalanceToCents(raw, dec)`.
 */
export function assetValueCents(rawBalance: string, decimals: number, rateBrl: number): number {
  const negative = rawBalance.startsWith("-");
  const digits = negative ? rawBalance.slice(1) : rawBalance;
  const raw = BigInt(digits.length ? digits : "0");
  const rateMicro = BigInt(Math.round(rateBrl * 1_000_000));
  const denom = BigInt(10) ** BigInt(decimals) * BigInt(10000);
  const num = raw * rateMicro;
  const whole = num / denom;
  const remainder = num % denom;
  const rounded = remainder * BigInt(2) >= denom ? whole + BigInt(1) : whole;
  const result = Number(rounded);
  return negative ? -result : result;
}

/** Price every asset into BRL cents; unpriced symbols carry valueCents 0. */
export function valueAssets(assets: ReserveAsset[], pricing: ReservePricing): ReserveValuedAsset[] {
  return assets.map((a) => {
    const rate = assetRateBrl(a.symbol, pricing);
    return {
      ...a,
      valueCents: rate === null ? 0 : assetValueCents(a.rawBalance, a.decimals, rate),
    };
  });
}

/** Sum the per-asset BRL cents into the headline coverage figure. */
export function storedValueCentsFromValuedAssets(assets: ReserveValuedAsset[]): number {
  return assets.reduce((c, a) => c + a.valueCents, 0);
}
