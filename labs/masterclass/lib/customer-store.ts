import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const STORE_PATH = ".data/etherfuse-customer.json";

type CustomerRecord = {
  // Both UUIDs are client-generated and reused forever (slide 18 pitfall #2).
  customerId: string;
  bankAccountId: string;
  walletPublicKey: string;
  blockchain: string;
  presignedOnboardingUrl?: string;
  onboardingCompletedAt?: string;
  createdAt: string;
};

export type Customer = CustomerRecord;

export const readCustomer = async (): Promise<CustomerRecord | null> => {
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "customerId" in parsed &&
      "bankAccountId" in parsed
    ) {
      // Disk boundary: trust the structure we wrote.
      return parsed as CustomerRecord;
    }
    return null;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
};

export const writeCustomer = async (record: CustomerRecord): Promise<void> => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(record, null, 2));
};

export const requireCustomer = async (): Promise<CustomerRecord> => {
  const customer = await readCustomer();
  if (!customer) {
    throw new Error(
      "No customer on file. Run `bun run 2:customer` first to generate UUIDs + get the onboarding URL.",
    );
  }
  return customer;
};
