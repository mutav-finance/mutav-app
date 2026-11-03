import { BRS_DECIMALS } from "./health";

/**
 * The assets the phase-1 reserve knows by name (ADR 0012, multi-asset
 * amendment). Every holding the Squads vault reports is shown on the
 * transparency page; this registry only labels it and decides whether it
 * counts toward required coverage. A mint that is not here is listed as
 * unknown, never hidden and never counted.
 */

export const RESERVE_ASSET_KIND = {
  /** Native SOL (and wrapped SOL): shown with a BRL value, never counted — volatile, pays fees. */
  SOL: "sol",
  /** BRL stablecoins (BRS), counted 1:1 with BRL. */
  BRL_STABLE: "brl_stable",
  /** USD stablecoins (USDC, USDT), counted at the BCB PTAX rate. */
  USD_STABLE: "usd_stable",
  UNKNOWN: "unknown",
} as const satisfies Record<string, string>;

export type ReserveAssetKind = (typeof RESERVE_ASSET_KIND)[keyof typeof RESERVE_ASSET_KIND];

/** Which program holds a balance: the System program (native lamports) or one of the SPL token programs. */
export const RESERVE_TOKEN_PROGRAM = {
  NATIVE: "native",
  SPL_TOKEN: "spl-token",
  SPL_TOKEN_2022: "spl-token-2022",
} as const satisfies Record<string, string>;

export type ReserveTokenProgram =
  (typeof RESERVE_TOKEN_PROGRAM)[keyof typeof RESERVE_TOKEN_PROGRAM];

/** On-chain program ids of the two SPL token programs, keyed by the name `jsonParsed` reports. */
export const SPL_TOKEN_PROGRAM_IDS = {
  [RESERVE_TOKEN_PROGRAM.SPL_TOKEN]: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  [RESERVE_TOKEN_PROGRAM.SPL_TOKEN_2022]: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
} as const;

/** The wrapped-SOL mint; native SOL is reported under it so every holding has a mint. */
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;

/** Mainnet BRS: classic SPL, 6 decimals, with a freeze authority. */
export const BRS_MINT_MAINNET = "BRSxQRUaGswjLs7ewcH7uXj3r7SgmfKSSLLXyCKHZtUo";
/** Devnet BRS — set `RESERVE_BRS_MINT` to this on a devnet deployment. */
export const BRS_MINT_DEVNET = "BRS2CELW6Cueo2mrMUVvAr5GDT7Pw8TeostC2JLMpBk4";
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT_MAINNET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export type KnownReserveAsset = {
  mint: string;
  symbol: string;
  decimals: number;
  kind: Exclude<ReserveAssetKind, typeof RESERVE_ASSET_KIND.UNKNOWN>;
};

/** The registry for one deployment. Only the BRS mint varies (mainnet vs devnet). */
export function reserveAssetRegistry(brsMint: string): readonly KnownReserveAsset[] {
  return [
    { mint: WRAPPED_SOL_MINT, symbol: "SOL", decimals: SOL_DECIMALS, kind: RESERVE_ASSET_KIND.SOL },
    { mint: brsMint, symbol: "BRS", decimals: BRS_DECIMALS, kind: RESERVE_ASSET_KIND.BRL_STABLE },
    { mint: USDC_MINT_MAINNET, symbol: "USDC", decimals: 6, kind: RESERVE_ASSET_KIND.USD_STABLE },
    { mint: USDT_MINT_MAINNET, symbol: "USDT", decimals: 6, kind: RESERVE_ASSET_KIND.USD_STABLE },
  ];
}

export function findKnownAsset(
  registry: readonly KnownReserveAsset[],
  mint: string,
): KnownReserveAsset | null {
  return registry.find((asset) => asset.mint === mint) ?? null;
}

/** Coverage counts BRL and USD stablecoins only. SOL and unknown mints are shown, not counted. */
export function isCoverageEligible(kind: ReserveAssetKind): boolean {
  return kind === RESERVE_ASSET_KIND.BRL_STABLE || kind === RESERVE_ASSET_KIND.USD_STABLE;
}
