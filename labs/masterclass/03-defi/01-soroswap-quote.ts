import { env } from "../lib/env.ts";

// USDC and XLM (native) on mainnet — change to suit. Soroswap doesn't index
// testnet liquidity, so quoting on testnet returns empty routes.
const NETWORK = "mainnet";
const USDC_MAINNET = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const XLM_NATIVE = "native";
const AMOUNT_IN = "100000000"; // 10 USDC in stroops (7 decimals)

type QuoteRequest = {
  assetIn: string;
  assetOut: string;
  amount: string;
  tradeType: "EXACT_IN" | "EXACT_OUT";
  protocols: string[];
};

type QuoteResponse = {
  routePlan: unknown[];
  amountIn: string;
  amountOut: string;
  priceImpactPct?: string;
} & Record<string, unknown>;

const apiKey = env.soroswapApiKey();
if (!apiKey) {
  console.log("⚠ SOROSWAP_API_KEY not set in .env");
  console.log("  Free signup: https://api.soroswap.finance/register");
  console.log();
  console.log("  Once you have the key, paste it into labs/masterclass/.env and retry.");
  process.exit(0);
}

const body: QuoteRequest = {
  assetIn: USDC_MAINNET,
  assetOut: XLM_NATIVE,
  amount: AMOUNT_IN,
  tradeType: "EXACT_IN",
  protocols: ["soroswap", "phoenix", "aqua", "sdex"],
};

console.log(`POST /quote?network=${NETWORK}`);
console.log(`  ${body.amount} of ${body.assetIn} → ${body.assetOut}`);
console.log();

const response = await fetch(`${env.soroswapBaseUrl()}/quote?network=${NETWORK}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

if (!response.ok) {
  console.error(`✗ HTTP ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

// External API boundary.
const quote = (await response.json()) as QuoteResponse;
console.log("✓ Quote:");
console.log(JSON.stringify(quote, null, 2));
console.log();
console.log(`Note: testnet returns empty routes (no indexed liquidity).`);
console.log(`Production MVP flow per slide 36 (BRL → TESOURO → USDC → XLM → payment)`);
console.log(`hits this endpoint at the USDC → XLM step.`);
