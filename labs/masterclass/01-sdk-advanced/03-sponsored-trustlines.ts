import { BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
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
const OP_COUNT = 4;
const TX_TIMEOUT_SECONDS = 180;

assertTestnet();

const { horizon, passphrase } = network();
const master = masterKeypair();
const sponsor = sponsorKeypair() ?? master;
const user = Keypair.random();

const sponsorIsMaster = sponsor.publicKey() === master.publicKey();
console.log(`Sponsor : ${sponsor.publicKey()}${sponsorIsMaster ? "  (same as master)" : ""}`);
console.log(`User    : ${user.publicKey()}`);
console.log();

await fundViaFriendbot(sponsor.publicKey());

// Pattern: BeginSponsoring → ops that consume reserves → EndSponsoring.
// Anything inside the bracket has its reserve charged to the sponsor.
// EndSponsoring must be sourced from the sponsored party — that's the
// account explicitly confirming "yes, I accept this sponsorship".
const sponsorAccount = await horizon.loadAccount(sponsor.publicKey());
const tx = new TransactionBuilder(sponsorAccount, {
  fee: String(Number(BASE_FEE) * OP_COUNT),
  networkPassphrase: passphrase,
})
  .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: user.publicKey() }))
  .addOperation(
    Operation.createAccount({
      destination: user.publicKey(),
      // 0 XLM starting balance — only legal because the base reserve is sponsored.
      startingBalance: USER_STARTING_BALANCE_XLM,
    }),
  )
  .addOperation(Operation.changeTrust({ source: user.publicKey(), asset: usdcAsset() }))
  .addOperation(Operation.endSponsoringFutureReserves({ source: user.publicKey() }))
  .setTimeout(TX_TIMEOUT_SECONDS)
  .build();

tx.sign(sponsor, user);

const result = await horizon.submitTransaction(tx);
console.log("✓ Submitted");
console.log(`  hash    : ${result.hash}`);
console.log(`  explorer: ${explorerTx(result.hash)}`);
console.log();

const userAccount = await horizon.loadAccount(user.publicKey());
const xlmBalance = userAccount.balances.find((b) => b.asset_type === "native");
console.log(`User XLM balance        : ${xlmBalance?.balance ?? "0"}`);
console.log(`User num_sponsored      : ${userAccount.num_sponsored}  (account + trustline)`);
console.log(`Verify on explorer      : ${explorerAccount(user.publicKey())}`);
console.log();
console.log("The user exists on-chain with 0 XLM. The sponsor's account holds the reserves.");
