import { randomUUID } from "node:crypto";
import { Asset, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { etherfuse, printEtherfuseError } from "../lib/etherfuse.ts";
import { requireCustomer } from "../lib/customer-store.ts";
import { requireEtherfuseWallet } from "../lib/etherfuse-wallet.ts";
import { assertTestnet, network } from "../lib/stellar.ts";

type QuoteAssetsOnramp = {
  type: "onramp";
  sourceAsset: "BRL";
  targetAsset: string;
};

type QuoteResponse = {
  quoteId: string;
  sourceAmount: string;
  destinationAmount: string;
  destinationAmountAfterFee?: string | null;
  exchangeRate: string;
  feeAmount?: string | null;
  expiresAt: string;
};

type OnrampOrderResponse = {
  onramp: {
    orderId: string;
    depositAmount?: number;
    depositBankName?: string;
    depositAccountHolder?: string;
    depositClabe?: string;
  } & Record<string, unknown>;
};

// TESOURO issuer is documented in slide 22 and confirmed via the smoke test.
const TESOURO_ASSET_CODE = "TESOURO";
const TESOURO_ISSUER = "GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";
const TESOURO_ASSET = `${TESOURO_ASSET_CODE}:${TESOURO_ISSUER}`;
const BRL_AMOUNT = "100";
const BLOCKCHAIN = "stellar";
const TX_TIMEOUT_SECONDS = 180;

assertTestnet();

const { horizon, passphrase } = network();
const customer = await requireCustomer();
const wallet = await requireEtherfuseWallet();

// Etherfuse rejects the order if the wallet can't hold the target asset.
// TESOURO is a 7-char code → credit_alphanum12 balance type.
const walletAccount = await horizon.loadAccount(wallet.publicKey());
const hasTesouroTrustline = walletAccount.balances.some(
  (b) =>
    b.asset_type === "credit_alphanum12" &&
    b.asset_code === TESOURO_ASSET_CODE &&
    b.asset_issuer === TESOURO_ISSUER,
);
if (!hasTesouroTrustline) {
  console.log("Opening TESOURO trustline (one-time, classic tx)…");
  const trustlineTx = new TransactionBuilder(walletAccount, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(TESOURO_ASSET_CODE, TESOURO_ISSUER),
      }),
    )
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
  trustlineTx.sign(wallet);
  const trustlineResult = await horizon.submitTransaction(trustlineTx);
  console.log(`✓ Trustline opened: ${trustlineResult.hash}`);
  console.log();
}

const quoteId = randomUUID();
const orderId = randomUUID();

console.log(`customerId    : ${customer.customerId}`);
console.log(`bankAccountId : ${customer.bankAccountId}`);
console.log(`wallet        : ${customer.walletPublicKey}`);
console.log(`quoteId       : ${quoteId}  (this call)`);
console.log(`orderId       : ${orderId}  (this call)`);
console.log(`amount        : R$ ${BRL_AMOUNT} → TESOURO`);
console.log();

try {
  console.log("1) POST /ramp/quote");
  const quote = await etherfuse.post<QuoteResponse>("/ramp/quote", {
    quoteId,
    customerId: customer.customerId,
    blockchain: BLOCKCHAIN,
    quoteAssets: {
      type: "onramp",
      sourceAsset: "BRL",
      targetAsset: TESOURO_ASSET,
    } satisfies QuoteAssetsOnramp,
    sourceAmount: BRL_AMOUNT,
  });

  console.log(`   sourceAmount       : ${quote.sourceAmount} BRL`);
  console.log(`   destinationAmount  : ${quote.destinationAmount} TESOURO`);
  if (quote.destinationAmountAfterFee) {
    console.log(`   afterFee           : ${quote.destinationAmountAfterFee} TESOURO`);
  }
  console.log(`   exchangeRate       : ${quote.exchangeRate}`);
  if (quote.feeAmount) console.log(`   feeAmount          : ${quote.feeAmount}`);
  console.log(`   expiresAt          : ${quote.expiresAt}`);
  console.log();

  console.log("2) POST /ramp/order");
  const order = await etherfuse.post<OnrampOrderResponse>("/ramp/order", {
    orderId,
    bankAccountId: customer.bankAccountId,
    quoteId,
    publicKey: customer.walletPublicKey,
  });

  console.log(`   ✓ Order created`);
  console.log();
  console.log("Raw onramp response:");
  console.log(JSON.stringify(order.onramp, null, 2));
  console.log();
  console.log("=== Pix payment instructions ===");
  if (order.onramp.depositAmount) console.log(`Amount      : R$ ${order.onramp.depositAmount}`);
  if (order.onramp.depositBankName) console.log(`Bank        : ${order.onramp.depositBankName}`);
  if (order.onramp.depositAccountHolder)
    console.log(`Recipient   : ${order.onramp.depositAccountHolder}`);
  console.log();
  console.log(`Track the order: bun run 2:poll ${order.onramp.orderId}`);
  console.log(
    "(In sandbox the order may auto-progress or require manual action via the dashboard.)",
  );
} catch (err: unknown) {
  printEtherfuseError(err);
  process.exit(1);
}
