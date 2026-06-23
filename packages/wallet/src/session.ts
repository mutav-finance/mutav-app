/**
 * session.ts — connect / restore / disconnect.
 *
 * Keys never leave the wallet. NOTE: Stellar Wallets Kit v2 persists the active
 * wallet in localStorage and silently restores a *live, signable* session at
 * module load — the React provider does NOT reflect that until it calls
 * `restore()`. So UI-state and kit-state can diverge: high-security surfaces
 * (admin) opt out of restore and clear the persisted session on load, so
 * "connected" always requires an explicit gesture (see WalletProvider
 * `persistSession`). See ADR 0005.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { initWalletKit, type WalletNetwork } from "./kit";

/** Open the wallet picker and return the connected address. */
export async function connect(network: WalletNetwork): Promise<string> {
  initWalletKit(network);
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

/**
 * Re-read the kit's persisted session and return its address, or null when
 * there is none / it can't be restored. Lets the provider reconcile React state
 * with the kit's actual (possibly auto-restored) session.
 */
export async function restore(): Promise<string | null> {
  try {
    const { address } = await StellarWalletsKit.getAddress();
    return address || null;
  } catch {
    return null;
  }
}

/** Forget the active wallet (sign out). */
export async function disconnect(): Promise<void> {
  await StellarWalletsKit.disconnect().catch((err) => {
    console.error("[@mutav/wallet] disconnect error:", err);
  });
}
