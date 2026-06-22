import { randomUUID } from "node:crypto";
import { etherfuse, printEtherfuseError } from "../lib/etherfuse.ts";
import { readCustomer, writeCustomer } from "../lib/customer-store.ts";
import { getOrCreateEtherfuseWallet } from "../lib/etherfuse-wallet.ts";

type OnboardingUrlResponse = {
  presigned_url: string;
};

const BLOCKCHAIN = "stellar";

const existing = await readCustomer();
if (existing) {
  console.log("Existing customer on file:");
  console.log(`  customerId        : ${existing.customerId}`);
  console.log(`  bankAccountId     : ${existing.bankAccountId}`);
  console.log(`  walletPublicKey   : ${existing.walletPublicKey}`);
  console.log(`  blockchain        : ${existing.blockchain}`);
  console.log(`  createdAt         : ${existing.createdAt}`);
  if (existing.onboardingCompletedAt) {
    console.log(`  onboardingCompleted: ${existing.onboardingCompletedAt}`);
  } else if (existing.presignedOnboardingUrl) {
    console.log();
    console.log("⚠ Onboarding not yet marked complete. URL:");
    console.log(`  ${existing.presignedOnboardingUrl}`);
  }
  console.log();
  console.log("To start fresh: rm labs/masterclass/.data/etherfuse-customer.json");
  process.exit(0);
}

// We generate the UUIDs. Etherfuse trusts them and registers them
// when the user completes the hosted onboarding flow.
// The wallet is lab-only (auto-generated, funded, persisted in .data/) —
// can't reuse the shared dev treasury here because other devs already
// registered it under their orgs (slide 28 pitfall #2: G… → one customer).
const customerId = randomUUID();
const bankAccountId = randomUUID();
const wallet = (await getOrCreateEtherfuseWallet()).publicKey();

console.log(`customerId    : ${customerId}  (we generated this)`);
console.log(`bankAccountId : ${bankAccountId}  (we generated this)`);
console.log(`wallet        : ${wallet}`);
console.log(`blockchain    : ${BLOCKCHAIN}`);
console.log();
console.log("Calling POST /ramp/onboarding-url…");

try {
  const response = await etherfuse.post<OnboardingUrlResponse>("/ramp/onboarding-url", {
    customerId,
    bankAccountId,
    publicKey: wallet,
    blockchain: BLOCKCHAIN,
  });

  await writeCustomer({
    customerId,
    bankAccountId,
    walletPublicKey: wallet,
    blockchain: BLOCKCHAIN,
    presignedOnboardingUrl: response.presigned_url,
    createdAt: new Date().toISOString(),
  });

  console.log(`✓ Saved to .data/etherfuse-customer.json`);
  console.log();
  console.log("Open this URL to complete onboarding (KYC + bank account):");
  console.log(`  ${response.presigned_url}`);
  console.log();
  console.log("On the hosted page:");
  console.log("  1. Complete KYC with fake data (sandbox accepts anything)");
  console.log("  2. Add a bank account — pick 'pix' as the bank type");
  console.log("  3. Save");
  console.log();
  console.log("Then run, in order:");
  console.log(
    "  bun run 2:finalize   # submits KYC programmatically + accepts terms (sandbox auto-approves)",
  );
  console.log("  bun run 2:onramp     # quote + order, prints Pix instructions");
} catch (err: unknown) {
  printEtherfuseError(err);
  process.exit(1);
}
