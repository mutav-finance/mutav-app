import { etherfuse, printEtherfuseError } from "../lib/etherfuse.ts";
import { masterKeypair } from "../lib/stellar.ts";

type Asset = {
  symbol: string;
  identifier: string;
  currency: string;
  balance?: string | null;
};

type AssetsResponse = {
  assets: Asset[];
};

const wallet = masterKeypair().publicKey();

console.log(`Wallet: ${wallet}`);
console.log("Calling GET /ramp/assets?blockchain=stellar&currency=BRL&wallet=…");
console.log();

try {
  const response = await etherfuse.get<AssetsResponse>("/ramp/assets", {
    blockchain: "stellar",
    currency: "BRL",
    wallet,
  });

  console.log(`✓ ${response.assets.length} asset(s) returned`);
  for (const asset of response.assets) {
    console.log(
      `  • ${asset.symbol.padEnd(8)} ${asset.identifier}  currency=${asset.currency}  balance=${asset.balance ?? "null"}`,
    );
  }
  console.log();
  console.log("API key is valid. You can proceed to 02-customer-setup.ts.");
} catch (err: unknown) {
  printEtherfuseError(err);
  process.exit(1);
}
