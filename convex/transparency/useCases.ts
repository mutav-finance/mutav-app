import { queryWithAuth } from "../lib/auth";
import { ativoInsuredCentsPlatform, contractsByStatusPlatform } from "../contracts/aggregate";
import { CONTRACT_STATUS } from "../contracts/domain";
import { getMaxGuaranteeCapacityCents } from "../lib/env";
import type { ContractAggregates } from "./domain";

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
