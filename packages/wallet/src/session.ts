/**
 * session.ts — connect / disconnect (the album/mutav-pulse pattern).
 *
 * Only the wallet id leaves the wallet — keys never do. The kit persists the
 * selected wallet itself, so reconnection is handled by the kit on `connect`.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { initWalletKit, type WalletNetwork } from "./kit";

/** Open the wallet picker and return the connected address. */
export async function connect(network: WalletNetwork): Promise<string> {
  initWalletKit(network);
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

/** Forget the active wallet (sign out). */
export async function disconnect(): Promise<void> {
  await StellarWalletsKit.disconnect().catch((err) => {
    console.error("[@mutav/wallet] disconnect error:", err);
  });
}
