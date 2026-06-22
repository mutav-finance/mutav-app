import { BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  assertTestnet,
  explorerTx,
  fundViaFriendbot,
  masterKeypair,
  network,
  sponsorKeypair,
  usdcAsset,
} from "../lib/stellar.ts";

const NEW_USER_STARTING_BALANCE_XLM = "2";
const USDC_TO_SEED = "5";
const USDC_TO_RETURN = "1";
const SETUP_OP_COUNT = 3;
const TX_TIMEOUT_SECONDS = 180;

assertTestnet();

const { horizon, passphrase } = network();
const master = masterKeypair();
const sponsor = sponsorKeypair() ?? master;
const user = Keypair.random();

const sponsorIsMaster = sponsor.publicKey() === master.publicKey();
console.log(`Master  : ${master.publicKey()}`);
console.log(
  `Sponsor : ${sponsor.publicKey()}${sponsorIsMaster ? "  (same as master — set SPONSOR_SECRET to use a distinct account)" : ""}`,
);
console.log(`User    : ${user.publicKey()}  (random)`);
console.log();

await fundViaFriendbot(master.publicKey());
if (!sponsorIsMaster) {
  await fundViaFriendbot(sponsor.publicKey());
}

// Setup: create user, open USDC trustline, seed with 5 USDC. Same multi-op
// pattern as 01-multi-op.ts, just compressed into one block.
const masterAccount = await horizon.loadAccount(master.publicKey());
const setupTx = new TransactionBuilder(masterAccount, {
  fee: String(Number(BASE_FEE) * SETUP_OP_COUNT),
  networkPassphrase: passphrase,
})
  .addOperation(
    Operation.createAccount({
      destination: user.publicKey(),
      startingBalance: NEW_USER_STARTING_BALANCE_XLM,
    }),
  )
  .addOperation(Operation.changeTrust({ source: user.publicKey(), asset: usdcAsset() }))
  .addOperation(
    Operation.payment({
      destination: user.publicKey(),
      asset: usdcAsset(),
      amount: USDC_TO_SEED,
    }),
  )
  .setTimeout(TX_TIMEOUT_SECONDS)
  .build();
setupTx.sign(master, user);
await horizon.submitTransaction(setupTx);
console.log("✓ Setup tx submitted: user has 5 USDC, no spare XLM for fees");
console.log();

// Inner tx: user sends 1 USDC back to master. The inner fee is paid by the
// fee bump's outer source, so the user signs even though they have no spare
// XLM to cover fees.
const userAccount = await horizon.loadAccount(user.publicKey());
const innerTx = new TransactionBuilder(userAccount, {
  fee: BASE_FEE,
  networkPassphrase: passphrase,
})
  .addOperation(
    Operation.payment({
      destination: master.publicKey(),
      asset: usdcAsset(),
      amount: USDC_TO_RETURN,
    }),
  )
  .setTimeout(TX_TIMEOUT_SECONDS)
  .build();
innerTx.sign(user);

// CAP-15: outer fee must be ≥ inner_fee_per_op × (inner_ops + 1).
// With inner = 100 × 1 = 100, outer minimum is 100 × 2 = 200.
const FEE_BUMP_MULTIPLIER = 2;
const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
  sponsor,
  String(Number(BASE_FEE) * FEE_BUMP_MULTIPLIER),
  innerTx,
  passphrase,
);
feeBumpTx.sign(sponsor);

const result = await horizon.submitTransaction(feeBumpTx);

console.log("✓ Fee-bumped tx submitted");
console.log(`  outer hash (fee paid by sponsor): ${result.hash}`);
console.log(`  inner hash (state change)      : ${innerTx.hash().toString("hex")}`);
console.log(`  explorer: ${explorerTx(result.hash)}`);
console.log();
console.log("The user sent 1 USDC without spending any XLM on fees.");
console.log("This is the foundation of gasless UX — sponsor account swallows the cost.");
