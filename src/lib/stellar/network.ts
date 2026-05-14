/**
 * Network identifiers. The string form `"stellar-testnet" | "stellar-mainnet"`
 * is shared with the asset registry so address lookups don't need a separate
 * chain enum — the registry filters by exact network string.
 */
export type ChainNetwork = "stellar-testnet" | "stellar-mainnet";

export const STELLAR_NETWORK_DEFAULT: ChainNetwork = "stellar-testnet";

export function getStellarNetwork(): ChainNetwork {
  return process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public"
    ? "stellar-mainnet"
    : STELLAR_NETWORK_DEFAULT;
}
