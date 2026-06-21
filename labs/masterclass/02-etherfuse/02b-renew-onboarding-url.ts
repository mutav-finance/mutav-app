import { etherfuse, printEtherfuseError } from "../lib/etherfuse.ts";
import { requireCustomer, writeCustomer } from "../lib/customer-store.ts";

type OnboardingUrlResponse = {
  presigned_url: string;
};

const customer = await requireCustomer();

console.log(`Renewing onboarding URL for customer ${customer.customerId}…`);

try {
  const response = await etherfuse.post<OnboardingUrlResponse>("/ramp/onboarding-url", {
    customerId: customer.customerId,
    bankAccountId: customer.bankAccountId,
    publicKey: customer.walletPublicKey,
    blockchain: customer.blockchain,
  });

  await writeCustomer({ ...customer, presignedOnboardingUrl: response.presigned_url });

  console.log("✓ Fresh URL (valid 15 min):");
  console.log();
  console.log(`  ${response.presigned_url}`);
} catch (err: unknown) {
  printEtherfuseError(err);
  process.exit(1);
}
