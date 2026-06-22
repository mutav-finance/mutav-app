import { env } from "../lib/env.ts";

// Find vault addresses at https://app.defindex.io — or list them via
// GET /factory/vaults?network=testnet once authenticated.
const NETWORK = "testnet";
const VAULT_ADDRESS = process.env.DEFINDEX_VAULT_ADDRESS;

type VaultBalance = {
  totalAssets?: string;
  totalSupply?: string;
} & Record<string, unknown>;

type VaultApy = {
  apy?: number;
  apr?: number;
} & Record<string, unknown>;

const apiKey = env.defindexApiKey();
if (!apiKey) {
  console.log("⚠ DEFINDEX_API_KEY not set in .env");
  console.log("  Free signup: https://api.defindex.io/register");
  console.log();
  console.log("  Once you have the key, paste it into labs/masterclass/.env and retry.");
  process.exit(0);
}

if (!VAULT_ADDRESS) {
  console.log("⚠ DEFINDEX_VAULT_ADDRESS not set");
  console.log("  Pick a vault from https://app.defindex.io and export its contract address:");
  console.log("  export DEFINDEX_VAULT_ADDRESS=C... && bun run 3:defindex");
  process.exit(0);
}

const base = env.defindexBaseUrl();
const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};

console.log(`Vault   : ${VAULT_ADDRESS}`);
console.log(`Network : ${NETWORK}`);
console.log();

console.log(`GET /vault/${VAULT_ADDRESS}/balance?network=${NETWORK}`);
const balanceResponse = await fetch(`${base}/vault/${VAULT_ADDRESS}/balance?network=${NETWORK}`, {
  headers,
});
if (balanceResponse.ok) {
  const balance = (await balanceResponse.json()) as VaultBalance;
  console.log("  ", JSON.stringify(balance));
} else {
  console.log(`  ✗ HTTP ${balanceResponse.status}: ${await balanceResponse.text()}`);
}
console.log();

console.log(`GET /vault/${VAULT_ADDRESS}/apy?network=${NETWORK}`);
const apyResponse = await fetch(`${base}/vault/${VAULT_ADDRESS}/apy?network=${NETWORK}`, {
  headers,
});
if (apyResponse.ok) {
  const apy = (await apyResponse.json()) as VaultApy;
  console.log("  ", JSON.stringify(apy));
} else {
  console.log(`  ✗ HTTP ${apyResponse.status}: ${await apyResponse.text()}`);
}
