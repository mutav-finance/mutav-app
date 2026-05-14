/**
 * Dev-only fallback. Production must set `STELLAR_MUTAV_SOURCE_ACCOUNT`.
 * Generated once for the demo so muxed-address derivation works out of the
 * box. Real deployments must override.
 */
const DEV_FALLBACK_TREASURY = "GBADFR6K6RXDXUZ33Z5TRRPPRVEU2VEXORITHL4US4MSUSGSUPBSWS3S";

const DEFAULT_HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const DEFAULT_HORIZON_PUBLIC = "https://horizon.stellar.org";

export function getMutavSourceAccount(): string {
  return process.env.STELLAR_MUTAV_SOURCE_ACCOUNT ?? DEV_FALLBACK_TREASURY;
}

export function getStellarNetwork(): "testnet" | "public" {
  return process.env.STELLAR_NETWORK === "public" ? "public" : "testnet";
}

export function getStellarHorizonUrl(): string {
  const explicit = process.env.STELLAR_HORIZON_URL;
  if (explicit) return explicit;
  return getStellarNetwork() === "public" ? DEFAULT_HORIZON_PUBLIC : DEFAULT_HORIZON_TESTNET;
}
