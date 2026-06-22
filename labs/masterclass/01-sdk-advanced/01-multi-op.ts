import { BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  assertTestnet,
  explorerAccount,
  explorerTx,
  fundViaFriendbot,
  masterKeypair,
  network,
  usdcAsset,
} from "../lib/stellar.ts";

const NEW_ACCOUNT_STARTING_BALANCE_XLM = "2";
const INITIAL_USDC_PAYMENT = "10";
const TX_TIMEOUT_SECONDS = 180;
const OP_COUNT = 3;

assertTestnet();

const { horizon, passphrase } = network();
const master = masterKeypair();
const user = Keypair.random();

console.log(`Master : ${master.publicKey()}`);
console.log(`User   : ${user.publicKey()}  (random, freshly generated)`);
console.log(`User secret: ${user.secret()}`);
console.log();

await fundViaFriendbot(master.publicKey());
const masterAccount = await horizon.loadAccount(master.publicKey());

const tx = new TransactionBuilder(masterAccount, {
  fee: String(Number(BASE_FEE) * OP_COUNT),
  networkPassphrase: passphrase,
})
  .addOperation(
    Operation.createAccount({
      destination: user.publicKey(),
      startingBalance: NEW_ACCOUNT_STARTING_BALANCE_XLM,
    }),
  )
  // The trustline modifies the NEW user account's state, so the operation
  // must be sourced from the user — otherwise Horizon rejects with op_no_source_account.
  .addOperation(
    Operation.changeTrust({
      source: user.publicKey(),
      asset: usdcAsset(),
    }),
  )
  .addOperation(
    Operation.payment({
      destination: user.publicKey(),
      asset: usdcAsset(),
      amount: INITIAL_USDC_PAYMENT,
    }),
  )
  .setTimeout(TX_TIMEOUT_SECONDS)
  .build();

tx.sign(master, user);

const result = await horizon.submitTransaction(tx);

console.log("✓ Submitted");
console.log(`  hash    : ${result.hash}`);
console.log(`  ledger  : ${result.ledger}`);
console.log(`  explorer: ${explorerTx(result.hash)}`);
console.log();
console.log(
  "Atomicity check: all 3 ops succeeded (the createAccount, the trustline, the payment).",
);
console.log(`Verify user has 10 USDC: ${explorerAccount(user.publicKey())}`);
