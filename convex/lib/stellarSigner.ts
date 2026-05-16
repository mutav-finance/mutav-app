/**
 * Server-side Stellar signer for SEP-10 challenges.
 *
 * The signer wraps the Mutav treasury keypair (read lazily from env via
 * `getTreasurySecret`). It implements the `Sep10SignerFn` shape that the
 * SEP-10 module expects: `(xdr, networkPassphrase) => signedXdr`.
 *
 * Safety check: on every signer construction we assert that the public
 * key derived from the secret matches `STELLAR_MUTAV_SOURCE_ACCOUNT`.
 * Mismatch = somebody pointed the indexer at one account but the signer
 * at another, which would silently route deposits to the wrong place.
 */

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

import type { Sep10SignerFn } from "../../src/lib/anchors/sep/sep10";
import { getMutavSourceAccount, getTreasurySecret } from "./env";

export interface TreasurySigner {
  publicKey: string;
  sign: Sep10SignerFn;
}

export function getTreasurySigner(): TreasurySigner {
  const keypair = Keypair.fromSecret(getTreasurySecret());
  const publicKey = keypair.publicKey();
  const expected = getMutavSourceAccount();

  if (publicKey !== expected) {
    throw new Error(
      `Treasury signer public key ${publicKey} does not match STELLAR_MUTAV_SOURCE_ACCOUNT ${expected}. ` +
        `The signer secret and the indexer account must reference the same Stellar account.`,
    );
  }

  return {
    publicKey,
    sign: async (xdr: string, networkPassphrase: string): Promise<string> => {
      const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      tx.sign(keypair);
      return tx.toEnvelope().toXDR("base64");
    },
  };
}
