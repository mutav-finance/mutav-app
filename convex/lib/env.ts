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

/**
 * Lazy getter for the Stellar treasury secret (`S...`) — required only
 * inside anchor actions that sign SEP-10 challenges. Throws with a
 * helpful message if the env var is missing, so callers that never sign
 * (e.g., the Horizon indexer) don't trip on missing config.
 *
 * Production keys MUST be set via a secret manager / HSM — the env-var
 * route here is fine for dev and per-PR preview deployments only.
 */
export function getTreasurySecret(): string {
  const secret = process.env.MUTAV_TREASURY_SECRET;
  if (!secret) {
    throw new Error(
      "MUTAV_TREASURY_SECRET is not set. " +
        "Anchor on-ramp actions (SEP-10 auth) require the treasury Stellar secret. " +
        "Set it via `bunx convex env set MUTAV_TREASURY_SECRET S...` for dev/preview; " +
        "production must wire a secret manager.",
    );
  }
  if (!secret.startsWith("S") || secret.length !== 56) {
    throw new Error(
      "MUTAV_TREASURY_SECRET does not look like a Stellar secret seed (expected 'S' prefix, 56 chars).",
    );
  }
  return secret;
}
