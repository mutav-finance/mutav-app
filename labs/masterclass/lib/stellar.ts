import { Asset, Horizon, Keypair, Networks } from "@stellar/stellar-sdk";
import { env } from "./env.ts";

export const network = () => ({
  horizon: new Horizon.Server(env.horizonUrl()),
  passphrase: env.networkPassphrase(),
});

export const masterKeypair = () => Keypair.fromSecret(env.masterSecret());

export const sponsorKeypair = () => {
  const secret = env.sponsorSecret();
  return secret ? Keypair.fromSecret(secret) : null;
};

export const usdcAsset = () => new Asset(env.usdcAssetCode(), env.usdcIssuer());

const FRIENDBOT_URL = "https://friendbot.stellar.org";

export const fundViaFriendbot = async (publicKey: string): Promise<void> => {
  const response = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!response.ok && response.status !== 400) {
    throw new Error(`Friendbot failed for ${publicKey}: HTTP ${response.status}`);
  }
  // 400 = "createAccountAlreadyExist" — fine, account is already funded.
};

const TESTNET_PASSPHRASE = Networks.TESTNET;

export const assertTestnet = (): void => {
  if (env.networkPassphrase() !== TESTNET_PASSPHRASE) {
    throw new Error(`Refusing to run lab on non-testnet network: ${env.networkPassphrase()}`);
  }
};

export const explorerTx = (hash: string): string =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;

export const explorerAccount = (publicKey: string): string =>
  `https://stellar.expert/explorer/testnet/account/${publicKey}`;
