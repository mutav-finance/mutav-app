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
      solvency: ReserveSolvencySnapshot;
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

// ── mutav-pulse solvency read ─────────────────────────────────────────────────
// The reserve is the mutav-pulse vault + policy + registry trio, which enforces
// `stable_assets ≥ coverage_required` on-chain. We store the raw i128 figures
// exactly as read (audit trail) and derive every displayed number at query time.

export const RESERVE_POSITION_KIND = {
  IDLE: "idle",
  STRATEGY: "strategy",
} as const satisfies Record<string, string>;

export type ReservePositionKind =
  (typeof RESERVE_POSITION_KIND)[keyof typeof RESERVE_POSITION_KIND];

export const reservePositionKindValidator = v.union(
  v.literal(RESERVE_POSITION_KIND.IDLE),
  v.literal(RESERVE_POSITION_KIND.STRATEGY),
);

/** Where the vault's underlying sits: idle in the vault, or deployed to one strategy. */
export type ReservePosition = {
  kind: ReservePositionKind;
  address: string; // vault id for `idle`, strategy contract id otherwise
  volatile: boolean; // volatile strategies do NOT count toward solvency
  rawBalance: string;
};

export const reservePositionValidator = v.object({
  kind: reservePositionKindValidator,
  address: v.string(),
  volatile: v.boolean(),
  rawBalance: v.string(),
});

/** One on-chain solvency read of the pulse reserve (stored shape). */
export type ReserveSolvencySnapshot = {
  vaultId: string;
  policyId: string;
  registryId: string;
  assetContractId: string;
  assetSymbol: string;
  assetDecimals: number;
  totalAssetsRaw: string;
  stableAssetsRaw: string;
  freeCapitalRaw: string;
  coverageRequiredRaw: string;
  rawCoverageRaw: string;
  coverageRatioBps: number;
  positions: ReservePosition[];
};

export const reserveSolvencyValidator = v.object({
  vaultId: v.string(),
  policyId: v.string(),
  registryId: v.string(),
  assetContractId: v.string(),
  assetSymbol: v.string(),
  assetDecimals: v.number(),
  totalAssetsRaw: v.string(),
  stableAssetsRaw: v.string(),
  freeCapitalRaw: v.string(),
  coverageRequiredRaw: v.string(),
  rawCoverageRaw: v.string(),
  coverageRatioBps: v.number(),
  positions: v.array(reservePositionValidator),
});

const BPS_DENOMINATOR = 10_000;

/**
 * An unscaled i128 string → whole asset units. The integer and fractional parts
 * are split in BigInt first so the whole part stays exact past 2^53 raw; only
 * the display-bound fraction goes through float.
 */
export function rawToUnits(raw: string, decimals: number): number {
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const value = BigInt(digits.length ? digits : "0");
  const scale = BigInt(10) ** BigInt(decimals);
  const units = Number(value / scale) + Number(value % scale) / Number(scale);
  return negative ? -units : units;
}

export type StrategyAllocation = { address: string; volatile: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The vault's `strategies()` return value as `scValToNative` hands it back
 * (`{ address, weight_bps, volatile }[]`). Null on any shape drift so the read
 * fails closed instead of publishing a half-parsed book.
 */
export function parseStrategyAllocations(raw: unknown): StrategyAllocation[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed: StrategyAllocation[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const { address, volatile } = entry;
    if (typeof address !== "string" || typeof volatile !== "boolean") return null;
    parsed.push({ address, volatile });
  }
  return parsed;
}

/**
 * The policy exposes no `coverage_ratio_bps` getter, so the ratio `c` is read
 * from its instance storage, where the `DataKey::CoverageRatioBps` unit variant
 * decodes to the key `["CoverageRatioBps"]`.
 */
export function findCoverageRatioBps(
  entries: readonly { key: unknown; val: unknown }[],
): number | null {
  for (const { key, val } of entries) {
    if (!Array.isArray(key) || key[0] !== "CoverageRatioBps") continue;
    return typeof val === "number" && Number.isInteger(val) && val >= 0 ? val : null;
  }
  return null;
}

export type SolvencyPositionFigures = {
  kind: ReservePositionKind;
  address: string;
  volatile: boolean;
  balance: number;
  share: number | null;
};

/** Display figures derived from one solvency read. Units = the vault asset (e.g. cUSD). */
export type SolvencyFigures = {
  totalAssets: number;
  stableAssets: number;
  coverageRequired: number;
  rawCoverage: number;
  /** stable assets ÷ coverage required — how many times the book is backed. */
  coverageRatio: number | null;
  /** The policy knob `c`: coverage_required = ceil(raw_coverage × c). */
  requiredCoverageRatio: number;
  /** = free_capital: surplus above the floor, what can still be underwritten or redeemed. */
  remainingCapacity: number;
  /** stable assets ÷ c — the largest raw book the vault can back. Null when c = 0. */
  capacityCeiling: number | null;
  /** coverage required ÷ stable assets. Null on an empty vault. */
  capacityUtilization: number | null;
  positions: SolvencyPositionFigures[];
};

export function deriveSolvencyFigures(snapshot: ReserveSolvencySnapshot): SolvencyFigures {
  const units = (raw: string) => rawToUnits(raw, snapshot.assetDecimals);
  const totalAssets = units(snapshot.totalAssetsRaw);
  const stableAssets = units(snapshot.stableAssetsRaw);
  const coverageRequired = units(snapshot.coverageRequiredRaw);
  const requiredCoverageRatio = snapshot.coverageRatioBps / BPS_DENOMINATOR;
  return {
    totalAssets,
    stableAssets,
    coverageRequired,
    rawCoverage: units(snapshot.rawCoverageRaw),
    coverageRatio: coverageRequired > 0 ? stableAssets / coverageRequired : null,
    requiredCoverageRatio,
    remainingCapacity: units(snapshot.freeCapitalRaw),
    capacityCeiling: requiredCoverageRatio > 0 ? stableAssets / requiredCoverageRatio : null,
    capacityUtilization: stableAssets > 0 ? coverageRequired / stableAssets : null,
    positions: snapshot.positions.map((p) => {
      const balance = units(p.rawBalance);
      return {
        kind: p.kind,
        address: p.address,
        volatile: p.volatile,
        balance,
        share: totalAssets > 0 ? balance / totalAssets : null,
      };
    }),
  };
}
