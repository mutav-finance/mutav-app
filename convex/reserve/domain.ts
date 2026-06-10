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

/**
 * Outcome of a reserve read. NEVER a mock: when the contract is unconfigured
 * or the RPC read fails, `available` is false and the dashboard shows no number.
 */
export type ReserveReadResult =
  | { available: true; storedValueCents: number; assets: ReserveAsset[] }
  | { available: false };

export const reserveAssetValidator = v.object({
  contractAddress: v.string(),
  symbol: v.string(),
  decimals: v.number(),
  rawBalance: v.string(),
});

/**
 * Convert an unscaled i128 balance string + token decimals into BRL cents.
 * Pure integer math (BigInt) to avoid float drift on large i128 values.
 * Rounds half up by magnitude (away from zero for negative inputs — a reserve balance is never negative).
 */
export function rawBalanceToCents(rawBalance: string, decimals: number): number {
  const negative = rawBalance.startsWith("-");
  const digits = negative ? rawBalance.slice(1) : rawBalance;
  const raw = BigInt(digits.length ? digits : "0");
  const scale = 10n ** BigInt(decimals);
  const centsScaled = raw * 100n;
  const whole = centsScaled / scale;
  const remainder = centsScaled % scale;
  const rounded = remainder * 2n >= scale ? whole + 1n : whole;
  const result = Number(rounded);
  return negative ? -result : result;
}

/**
 * Sum the BRL-pegged approved assets into integer cents. Non-pegged assets are
 * ignored in the headline (no price feed in v1) but remain in the snapshot.
 */
export function storedValueCentsFromAssets(
  assets: ReserveAsset[],
  brlPeggedSymbols: readonly string[],
): number {
  const pegged = new Set(brlPeggedSymbols);
  return assets.reduce(
    (cents, asset) =>
      pegged.has(asset.symbol)
        ? cents + rawBalanceToCents(asset.rawBalance, asset.decimals)
        : cents,
    0,
  );
}
