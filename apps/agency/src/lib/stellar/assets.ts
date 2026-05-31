import type { ChainNetwork } from "./network";

/**
 * Discriminated address shape per chain. Stellar today; EVM / Solana / etc.
 * can be added as additional union members without touching consumers (the
 * registry resolver narrows by `chain`).
 */
type StellarAssetAddress = {
  chain: "stellar";
  network: ChainNetwork;
  /** `null` for native XLM; G-strkey for issued assets. */
  issuer: string | null;
  /** Optional Soroban SAC contract id (C-strkey) once we wire contract mode. */
  sacContractId?: string;
};

export type AssetAddress = StellarAssetAddress;

export type AssetSymbol = "XLM" | "USDC";

export function isAssetSymbol(value: string): value is AssetSymbol {
  return ASSETS.some((a) => a.symbol === value);
}

export type Asset = {
  symbol: AssetSymbol;
  decimals: number;
  /** Display decimals; not on-chain precision. Stellar assets are all 7 on-chain. */
  displayDecimals: number;
  /** Frozen demo rate; v1.1 will read a feed. */
  brlPerUnit: number;
  label: { ptBR: string; en: string };
  addresses: AssetAddress[];
};

export const ASSETS: Asset[] = [
  {
    symbol: "XLM",
    decimals: 7,
    displayDecimals: 4,
    brlPerUnit: 0.228,
    label: { ptBR: "Stellar Lumens", en: "Stellar Lumens" },
    addresses: [
      { chain: "stellar", network: "stellar-testnet", issuer: null },
      { chain: "stellar", network: "stellar-mainnet", issuer: null },
    ],
  },
  {
    symbol: "USDC",
    decimals: 7,
    displayDecimals: 2,
    brlPerUnit: 5.0,
    label: { ptBR: "Dólar (USDC)", en: "USD Coin" },
    addresses: [
      {
        chain: "stellar",
        network: "stellar-testnet",
        // Circle's canonical testnet USDC issuer — 18k+ trustlines.
        issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      },
      {
        chain: "stellar",
        network: "stellar-mainnet",
        // Circle's canonical mainnet USDC issuer — 2.1M trustlines, ~$150M/wk volume.
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      },
    ],
  },
];

export type ResolvedAsset = {
  symbol: string;
  issuer: string | null;
  decimals: number;
  displayDecimals: number;
  brlPerUnit: number;
  label: { ptBR: string; en: string };
  sacContractId?: string;
};

export function resolveAsset(symbol: string, network: ChainNetwork): ResolvedAsset | null {
  const asset = ASSETS.find((a) => a.symbol === symbol);
  if (!asset) return null;
  const addr = asset.addresses.find((a) => a.chain === "stellar" && a.network === network);
  if (!addr) return null;
  return {
    symbol: asset.symbol,
    issuer: addr.issuer,
    decimals: asset.decimals,
    displayDecimals: asset.displayDecimals,
    brlPerUnit: asset.brlPerUnit,
    label: asset.label,
    sacContractId: addr.sacContractId,
  };
}

export function getActiveAssets(network: ChainNetwork): ResolvedAsset[] {
  return ASSETS.map((a) => resolveAsset(a.symbol, network)).filter(
    (x): x is ResolvedAsset => x !== null,
  );
}
