/**
 * Dev-only fallback. Production must set `STELLAR_MUTAV_SOURCE_ACCOUNT`.
 * Generated once for the demo so muxed-address derivation works out of the
 * box. Real deployments must override.
 */
const DEV_FALLBACK_TREASURY = "GBADFR6K6RXDXUZ33Z5TRRPPRVEU2VEXORITHL4US4MSUSGSUPBSWS3S";

const DEFAULT_HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const DEFAULT_HORIZON_PUBLIC = "https://horizon.stellar.org";

const DEFAULT_ETHERFUSE_SANDBOX_URL = "https://api.sand.etherfuse.com";
const DEFAULT_ETHERFUSE_PROD_URL = "https://api.etherfuse.com";

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

export function getEtherfuseApiKey(): string {
  const key = process.env.ETHERFUSE_API_KEY;
  if (!key) {
    throw new Error("ETHERFUSE_API_KEY is required");
  }
  return key;
}

export function getEtherfuseBaseUrl(): string {
  const explicit = process.env.ETHERFUSE_BASE_URL;
  if (explicit) return explicit;
  return getStellarNetwork() === "public"
    ? DEFAULT_ETHERFUSE_PROD_URL
    : DEFAULT_ETHERFUSE_SANDBOX_URL;
}

export function getEtherfuseWebhookSecret(): string {
  const secret = process.env.ETHERFUSE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("ETHERFUSE_WEBHOOK_SECRET is required");
  }
  return secret;
}
