import { action } from "../_generated/server";
import { getMutavSourceAccount, getStellarHorizonUrl, getStellarNetwork } from "../lib/env";
import type { TreasurySnapshot } from "./domain";

type HorizonBalance = {
  asset_type: string;
  balance: string;
};

type HorizonAccountResponse = {
  balances?: HorizonBalance[];
};

export const getTreasurySnapshot = action({
  args: {},
  handler: async (): Promise<TreasurySnapshot> => {
    const address = getMutavSourceAccount();
    const horizonUrl = getStellarHorizonUrl();
    const network = getStellarNetwork();

    const res = await fetch(`${horizonUrl}/accounts/${address}`);
    if (!res.ok) throw new Error(`Horizon: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as HorizonAccountResponse; // hook-ok: external API response
    const nativeBalance = data.balances?.find((b) => b.asset_type === "native");
    const xlmBalance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;

    const explorerUrl = `https://stellar.expert/explorer/${network}/account/${address}`;

    return { address, xlmBalance, explorerUrl };
  },
});
