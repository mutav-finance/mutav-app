/**
 * ownership.ts — prove control of the connected wallet via a SEP-10-style signed
 * challenge transaction. Transaction signing is uniform across wallets and the
 * signature is deterministically verifiable (ed25519 over the tx hash), unlike
 * message signing whose scheme varies per wallet. The challenge is NEVER
 * submitted: source is the connected address at sequence 0, so no on-chain
 * (funded) account is required.
 *
 * SECURITY: client-side verification only confirms the signature is valid for
 * the address — it is NOT a trust boundary (a malicious client could assert
 * "verified"). Binding a wallet to a staff identity (enrolling it as a multisig
 * signer) must be verified SERVER-SIDE against a server-issued, single-use
 * challenge. See ADR 0005 + SEP-10 / SEP-45.
 */
import { Account, BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

/**
 * Ask the connected wallet to sign a throwaway challenge transaction and verify
 * the resulting signature against `address`. Returns true iff the connected key
 * actually signed it (i.e. the user controls the address).
 */
export async function proveOwnership(address: string, networkPassphrase: string): Promise<boolean> {
  const nonce = globalThis.crypto.randomUUID();
  // Sequence "0" — this envelope is for signing only and is never submitted.
  const account = new Account(address, "0");
  const challenge = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(Operation.manageData({ name: "mutav:ownership", value: nonce }))
    .setTimeout(300)
    .build();

  const { signedTxXdr } = await StellarWalletsKit.signTransaction(challenge.toXDR(), {
    networkPassphrase,
    address,
  });

  const signed = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
  if (!("signatures" in signed)) return false; // fee-bump envelope — not expected here
  const keypair = Keypair.fromPublicKey(address);
  const hash = signed.hash();
  return signed.signatures.some((sig) => {
    try {
      return keypair.verify(hash, sig.signature());
    } catch {
      return false;
    }
  });
}
