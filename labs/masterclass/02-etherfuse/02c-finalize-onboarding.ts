import { randomUUID } from "node:crypto";
import { etherfuse, printEtherfuseError } from "../lib/etherfuse.ts";
import { requireCustomer, writeCustomer } from "../lib/customer-store.ts";

type KycResponse = {
  status: "proposed" | "approved";
  message: string;
};

type AgreementResponse = {
  success?: boolean;
  acceptedAt?: string;
  agreementType?: string;
};

const buildSandboxKycPayload = () => ({
  identity: {
    id: randomUUID(),
    name: {
      givenName: "Masterclass",
      familyName: "Sandbox",
    },
    dateOfBirth: "1990-01-01",
    address: {
      id: randomUUID(),
      street: "Rua Teste 100",
      city: "São Paulo",
      region: "SP",
      postalCode: "01310-100",
      country: "BR",
    },
    idNumbers: [{ id: randomUUID(), value: "12345678909", type: "CPF" }],
  },
});

const customer = await requireCustomer();
if (!customer.presignedOnboardingUrl) {
  console.error("✗ No presignedOnboardingUrl on file. Run `bun run 2:renew-url` first.");
  process.exit(1);
}

console.log(`Finalizing onboarding for ${customer.customerId}…`);
console.log();

try {
  console.log("1) POST /ramp/customer/{id}/kyc  (auto-approves in sandbox)");
  const kyc = await etherfuse.post<KycResponse>(`/ramp/customer/${customer.customerId}/kyc`, {
    id: randomUUID(),
    ...buildSandboxKycPayload(),
    pubkey: customer.walletPublicKey,
  });
  console.log(`   status: ${kyc.status}  message: ${kyc.message}`);
  if (kyc.status !== "approved") {
    console.error(`   ✗ Expected approved (sandbox), got ${kyc.status}`);
    process.exit(1);
  }
  console.log();

  console.log("2) POST /ramp/agreements/terms-and-conditions");
  const terms = await etherfuse.post<AgreementResponse>("/ramp/agreements/terms-and-conditions", {
    presignedUrl: customer.presignedOnboardingUrl,
  });
  console.log(`   ✓ accepted`);
  if (terms.acceptedAt) console.log(`     acceptedAt: ${terms.acceptedAt}`);
  console.log();

  await writeCustomer({
    ...customer,
    onboardingCompletedAt: new Date().toISOString(),
  });
  console.log("✓ Onboarding finalized. Run `bun run 2:onramp` to start the BRL → TESOURO flow.");
} catch (err: unknown) {
  printEtherfuseError(err);
  process.exit(1);
}
