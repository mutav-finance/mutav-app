import { randomUUID } from "node:crypto";
import { BASE_FEE, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { etherfuse, printEtherfuseError } from "../lib/etherfuse.ts";
import { requireCustomer } from "../lib/customer-store.ts";
import { requireEtherfuseWallet } from "../lib/etherfuse-wallet.ts";
import { assertTestnet, explorerTx, network, usdcAsset } from "../lib/stellar.ts";

type QuoteResponse = {
  quoteId: string;
  sourceAmount: string;
  destinationAmount: string;
  destinationAmountAfterFee?: string | null;
  exchangeRate: string;
  expiresAt: string;
};

type OfframpOrderResponse = {
  offramp: {
    orderId: string;
    withdrawAnchorAccount: string;
    withdrawMemo: string;
    withdrawMemoType: "hash";
  } & Record<string, unknown>;
};

const USDC_SOURCE_ASSET = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_AMOUNT = "1";
const BLOCKCHAIN = "stellar";
const TX_TIMEOUT_SECONDS = 180;

assertTestnet();

const { horizon, passphrase } = network();
const customer = await requireCustomer();
const wallet = await requireEtherfuseWallet();

// Prereq check: the wallet needs a USDC trustline and ≥ USDC_AMOUNT.
const walletAccount = await horizon.loadAccount(wallet.publicKey()).catch(() => null);
if (!walletAccount) {
  console.error(`✗ Wallet ${wallet.publicKey()} doesn't exist yet on testnet.`);
  console.error("  Run `bun run 2:customer` first (it funds via friendbot).");
  process.exit(1);
}
const usdcBalance = walletAccount.balances.find(
  (b) => b.asset_type === "credit_alphanum4" && b.asset_code === "USDC",
);
if (!usdcBalance) {
  console.error(`✗ Wallet has no USDC trustline. Open one before off-ramping:`);
  console.error(`  https://lab.stellar.org → load secret → Change Trust → USDC / Circle issuer`);
  console.error(
    `  Then top up: https://faucet.circle.com → Stellar Testnet → ${wallet.publicKey()}`,
  );
  process.exit(1);
}
if (Number(usdcBalance.balance) < Number(USDC_AMOUNT)) {
  console.error(`✗ Wallet has only ${usdcBalance.balance} USDC, need ${USDC_AMOUNT}.`);
  console.error(`  Top up: https://faucet.circle.com → Stellar Testnet → ${wallet.publicKey()}`);
  process.exit(1);
}

const quoteId = randomUUID();
const orderId = randomUUID();

console.log(`customerId    : ${customer.customerId}`);
console.log(`bankAccountId : ${customer.bankAccountId}`);
console.log(`wallet        : ${wallet.publicKey()}  (USDC balance: ${usdcBalance.balance})`);
console.log(`quoteId       : ${quoteId}`);
console.log(`orderId       : ${orderId}`);
console.log(`amount        : ${USDC_AMOUNT} USDC → BRL`);
console.log();

try {
  console.log("1) POST /ramp/quote");
  const quote = await etherfuse.post<QuoteResponse>("/ramp/quote", {
    quoteId,
    customerId: customer.customerId,
    blockchain: BLOCKCHAIN,
    quoteAssets: {
      type: "offramp",
      sourceAsset: USDC_SOURCE_ASSET,
      targetAsset: "BRL",
    },
    sourceAmount: USDC_AMOUNT,
  });
  console.log(
    `   ${quote.sourceAmount} USDC → ${quote.destinationAmount} BRL  (rate ${quote.exchangeRate})`,
  );
  console.log(`   expiresAt: ${quote.expiresAt}`);
  console.log();

  console.log("2) POST /ramp/order  (useAnchor: true → Stellar classic + memo)");
  const order = await etherfuse.post<OfframpOrderResponse>("/ramp/order", {
    orderId,
    bankAccountId: customer.bankAccountId,
    quoteId,
    publicKey: wallet.publicKey(),
    useAnchor: true,
  });
  console.log(`   anchor account : ${order.offramp.withdrawAnchorAccount}`);
  console.log(`   memo (base64)  : ${order.offramp.withdrawMemo}`);
  console.log(`   memo type      : ${order.offramp.withdrawMemoType}`);
  console.log();

  console.log("3) Stellar payment with memo (classic — Soroban doesn't support memo)");
  const memoBuffer = Buffer.from(order.offramp.withdrawMemo, "base64");
  if (memoBuffer.length !== 32) {
    throw new Error(`Expected 32-byte hash memo, got ${memoBuffer.length} bytes`);
  }

  const tx = new TransactionBuilder(walletAccount, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(
      Operation.payment({
        destination: order.offramp.withdrawAnchorAccount,
        asset: usdcAsset(),
        amount: USDC_AMOUNT,
      }),
    )
    .addMemo(Memo.hash(memoBuffer))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
  tx.sign(wallet);
  const result = await horizon.submitTransaction(tx);

  console.log(`   ✓ Submitted: ${result.hash}`);
  console.log(`     ${explorerTx(result.hash)}`);
  console.log();
  console.log(`Track: bun run 2:poll ${order.offramp.orderId}`);
  console.log(
    `Explorer: https://stellar.expert/explorer/testnet/account/${customer.walletPublicKey}`,
  );
  console.log("Etherfuse will detect the on-chain payment, settle BRL via Pix, then notify.");
} catch (err: unknown) {
  printEtherfuseError(err);
  process.exit(1);
}
