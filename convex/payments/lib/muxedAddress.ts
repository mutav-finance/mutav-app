import { Account, MuxedAccount } from "@stellar/stellar-base";
import { getMutavSourceAccount } from "../../lib/env";

let cachedBase: { sourceG: string; account: Account } | null = null;

function getBaseAccount(): Account {
  const sourceG = getMutavSourceAccount();
  if (cachedBase && cachedBase.sourceG === sourceG) return cachedBase.account;
  const account = new Account(sourceG, "0");
  cachedBase = { sourceG, account };
  return account;
}

/**
 * Derive the per-payment muxed `M…` address (SEP-23) for a given muxed-id,
 * anchored to the Mutav treasury source account.
 */
export function derivePaymentMuxedAddress(muxedId: string): string {
  return new MuxedAccount(getBaseAccount(), muxedId).accountId();
}
