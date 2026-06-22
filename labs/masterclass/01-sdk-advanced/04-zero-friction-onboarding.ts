import { BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { printHorizonError } from "../lib/debug-tx-error.ts";
import {
  assertTestnet,
  explorerAccount,
  explorerTx,
  fundViaFriendbot,
  masterKeypair,
  network,
  sponsorKeypair,
  usdcAsset,
} from "../lib/stellar.ts";

const USER_STARTING_BALANCE_XLM = "0";
const INITIAL_USDC_PAYMENT = "10";
const USDC_TO_RETURN = "1";
const ONBOARDING_OP_COUNT = 5;
const RETURN_OP_COUNT = 1;
const FEE_BUMP_MULTIPLIER = 2;
const TX_TIMEOUT_SECONDS = 180;

assertTestnet();

const { horizon, passphrase } = network();
const master = masterKeypair();
const sponsor = sponsorKeypair() ?? master;
const user = Keypair.random();

console.log("=== Zero-Friction Onboarding ===");
console.log(`Master  : ${master.publicKey()}  (holds USDC, sends initial payment)`);
console.log(
  `Sponsor : ${sponsor.publicKey()}${sponsor.publicKey() === master.publicKey() ? "  (= master)" : "  (pays fee bump)"}`,
);
console.log(`User    : ${user.publicKey()}  (new, never touches XLM)`);
console.log();

await fundViaFriendbot(master.publicKey());
if (sponsor.publicKey() !== master.publicKey()) {
  await fundViaFriendbot(sponsor.publicKey());
}

// Guard: master needs USDC to send the initial payment. Circle's testnet
// faucet at https://faucet.circle.com tops up Stellar testnet addresses.
const masterAccount = await horizon.loadAccount(master.publicKey());
const masterUsdcBalance = masterAccount.balances.find(
  (b) => b.asset_type === "credit_alphanum4" && b.asset_code === "USDC",
);
if (!masterUsdcBalance || Number(masterUsdcBalance.balance) < Number(INITIAL_USDC_PAYMENT)) {
  console.log("✗ Master has no USDC. Get some from Circle's testnet faucet:");
  console.log(`    https://faucet.circle.com → Stellar Testnet → ${master.publicKey()}`);
  console.log("  Then re-run.");
  process.exit(0);
}

// === Step 1: onboarding (multi-op + sponsored reserves) ===
// Master + sponsor combine: master is source, sponsor brackets the
// reserve-consuming ops. User signs the ops that affect their own state.
const onboardingTx = new TransactionBuilder(masterAccount, {
  fee: String(Number(BASE_FEE) * ONBOARDING_OP_COUNT),
  networkPassphrase: passphrase,
})
  .addOperation(
    Operation.beginSponsoringFutureReserves({
      source: sponsor.publicKey(),
      sponsoredId: user.publicKey(),
    }),
  )
  .addOperation(
    Operation.createAccount({
      destination: user.publicKey(),
      startingBalance: USER_STARTING_BALANCE_XLM,
    }),
  )
  .addOperation(Operation.changeTrust({ source: user.publicKey(), asset: usdcAsset() }))
  .addOperation(Operation.endSponsoringFutureReserves({ source: user.publicKey() }))
  .addOperation(
    Operation.payment({
      destination: user.publicKey(),
      asset: usdcAsset(),
      amount: INITIAL_USDC_PAYMENT,
    }),
  )
  .setTimeout(TX_TIMEOUT_SECONDS)
  .build();
// Dedupe: if sponsor === master they're the same keypair and signing
// twice triggers tx_bad_auth_extra.
const onboardingSigners =
  sponsor.publicKey() === master.publicKey() ? [master, user] : [master, sponsor, user];
onboardingTx.sign(...onboardingSigners);
const onboardingResult = await horizon.submitTransaction(onboardingTx).catch((err: unknown) => {
  printHorizonError(err);
  throw err;
});
console.log(`✓ Onboarding tx: ${onboardingResult.hash}`);
console.log(`  ${explorerTx(onboardingResult.hash)}`);
console.log();

// === Step 2: user's first action (fee bump) ===
// User now exists with 0 XLM and 10 USDC. They want to spend USDC but
// have nothing to pay tx fees with. Sponsor wraps the user's inner tx
// in a fee bump and the network charges the sponsor.
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

const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
  sponsor,
  String(Number(BASE_FEE) * (RETURN_OP_COUNT + FEE_BUMP_MULTIPLIER - 1)),
  innerTx,
  passphrase,
);
feeBumpTx.sign(sponsor);
const feeBumpResult = await horizon.submitTransaction(feeBumpTx);
console.log(`✓ User's first tx (fee-bumped): ${feeBumpResult.hash}`);
console.log(`  ${explorerTx(feeBumpResult.hash)}`);
console.log();

console.log("=== Result ===");
console.log(`User account     : ${explorerAccount(user.publicKey())}`);
console.log(`User XLM balance : 0 (still)`);
console.log(`User USDC balance: 9 (10 received − 1 returned)`);
console.log();
console.log("The user onboarded, opened a trustline, received USDC, and made a payment —");
console.log("without ever holding XLM or hearing the word 'gas'.");
