import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { fundViaFriendbot } from "./stellar.ts";

const WALLET_PATH = ".data/etherfuse-wallet.json";

type StoredWallet = {
  publicKey: string;
  secret: string;
  createdAt: string;
  fundedAt?: string;
};

const readStoredWallet = async (): Promise<StoredWallet | null> => {
  try {
    const raw = await readFile(WALLET_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "publicKey" in parsed &&
      "secret" in parsed
    ) {
      // Disk boundary: trust the structure we wrote.
      return parsed as StoredWallet;
    }
    return null;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
};

const writeStoredWallet = async (wallet: StoredWallet): Promise<void> => {
  await mkdir(dirname(WALLET_PATH), { recursive: true });
  await writeFile(WALLET_PATH, JSON.stringify(wallet, null, 2));
};

export const getOrCreateEtherfuseWallet = async (): Promise<Keypair> => {
  const stored = await readStoredWallet();
  if (stored) {
    return Keypair.fromSecret(stored.secret);
  }
  const keypair = Keypair.random();
  const wallet: StoredWallet = {
    publicKey: keypair.publicKey(),
    secret: keypair.secret(),
    createdAt: new Date().toISOString(),
  };
  await writeStoredWallet(wallet);
  console.log(`✓ Generated new Etherfuse wallet: ${wallet.publicKey}`);
  console.log(`  Persisted to ${WALLET_PATH} (gitignored)`);

  await fundViaFriendbot(wallet.publicKey);
  await writeStoredWallet({ ...wallet, fundedAt: new Date().toISOString() });
  console.log(`✓ Funded via friendbot`);
  console.log();

  return keypair;
};

export const requireEtherfuseWallet = async (): Promise<Keypair> => {
  const stored = await readStoredWallet();
  if (!stored) {
    throw new Error(
      "No Etherfuse wallet yet. Run `bun run 2:customer` first — it auto-generates and funds one.",
    );
  }
  return Keypair.fromSecret(stored.secret);
};
