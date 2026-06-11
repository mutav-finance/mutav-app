import { queryWithAuth } from "../lib/auth";
import { ativoInsuredCentsPlatform, contractsByStatusPlatform } from "../contracts/aggregate";
import { CONTRACT_STATUS } from "../contracts/domain";
import { getMaxGuaranteeCapacityCents, getReserveContractId, getStellarNetwork } from "../lib/env";
import type { ContractAggregates, ReserveCoverage } from "./domain";

// Aggregates in this module are platform-wide BY DESIGN — every viewer sees the
// same numbers (transparency dashboard). Do NOT add per-agency filtering here;
// if a scoped variant is needed, add a separate `queryWithAgencyScope` handler
// in a sibling file.

export const getContractAggregates = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<ContractAggregates> => {
    const [countAtivos, countPendentes] = await contractsByStatusPlatform.countBatch(ctx, [
      {
        bounds: {
          lower: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
          upper: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
        },
      },
      {
        bounds: {
          lower: { key: CONTRACT_STATUS.PENDENTE, inclusive: true },
          upper: { key: CONTRACT_STATUS.PENDENTE, inclusive: true },
        },
      },
    ]);

    const sumInsuredCents = await ativoInsuredCentsPlatform.sum(ctx, {
      bounds: {
        lower: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
        upper: { key: CONTRACT_STATUS.ATIVO, inclusive: true },
      },
    });

    // defaultRate is derived as 0 because the contracts schema has no
    // `inadimplente` state yet — default tracking lands in a future PR.
    const defaultRate = 0;

    return {
      countAtivos: countAtivos ?? 0,
      countPendentes: countPendentes ?? 0,
      sumInsuredCents,
      defaultRate,
      maxCapacityCents: getMaxGuaranteeCapacityCents(),
    };
  },
});

function reserveExplorerUrl(): string {
  const id = getReserveContractId();
  const network = getStellarNetwork() === "public" ? "public" : "testnet";
  // When unconfigured (mainnet, no id) link to the network's contract index root.
  return id
    ? `https://stellar.expert/explorer/${network}/contract/${id}`
    : `https://stellar.expert/explorer/${network}`;
}

// Platform-wide BY DESIGN — every viewer sees the same onchain coverage figure.
export const getReserveCoverage = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<ReserveCoverage> => {
    const explorerUrl = reserveExplorerUrl();
    const snap = await ctx.db
      .query("reserveSnapshots")
      .withIndex("by_capturedAt")
      .order("desc")
      .first();
    if (!snap) return { explorerUrl, available: false };
    return {
      explorerUrl,
      available: true,
      storedValueCents: snap.storedValueCents,
      capturedAt: snap.capturedAt,
      assetCount: snap.assets.length,
    };
  },
});
