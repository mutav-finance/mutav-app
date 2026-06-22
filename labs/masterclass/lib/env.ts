const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing env var ${key}. Copy labs/masterclass/.env.example to .env and fill it in.`,
    );
  }
  return value;
};

const optionalEnv = (key: string): string | undefined => process.env[key] || undefined;

export const env = {
  horizonUrl: () => requiredEnv("HORIZON_URL"),
  sorobanRpcUrl: () => requiredEnv("SOROBAN_RPC_URL"),
  networkPassphrase: () => requiredEnv("NETWORK_PASSPHRASE"),
  masterSecret: () => requiredEnv("MASTER_SECRET"),
  sponsorSecret: () => optionalEnv("SPONSOR_SECRET"),
  usdcAssetCode: () => requiredEnv("USDC_ASSET_CODE"),
  usdcIssuer: () => requiredEnv("USDC_ISSUER"),
  etherfuseBaseUrl: () => requiredEnv("ETHERFUSE_BASE_URL"),
  etherfuseApiKey: () => requiredEnv("ETHERFUSE_API_KEY"),
  soroswapBaseUrl: () => process.env.SOROSWAP_BASE_URL ?? "https://api.soroswap.finance",
  soroswapApiKey: () => optionalEnv("SOROSWAP_API_KEY"),
  defindexBaseUrl: () => process.env.DEFINDEX_BASE_URL ?? "https://api.defindex.io",
  defindexApiKey: () => optionalEnv("DEFINDEX_API_KEY"),
};
