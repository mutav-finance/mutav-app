import { query } from "../_generated/server";
import { getMaxGuaranteeCapacityCents } from "../lib/env";
import type { ContractAggregates, HealthTimeline } from "./domain";

export const getContractAggregates = query({
  args: {},
  handler: async (): Promise<ContractAggregates> => {
    // Mock platform-wide aggregates — replace with real queries in issue #52
    return {
      countAtivos: 1396,
      countPendentes: 58,
      sumInsuredCents: 163_500_000, // 32.7% of default maxCapacityCents
      defaultRate: 0.024,
      maxCapacityCents: getMaxGuaranteeCapacityCents(),
    };
  },
});

export const getTimeline = query({
  args: {},
  handler: async (): Promise<HealthTimeline> => {
    // Mock counts — replace with real platform-wide aggregates in production (issue #52)
    return {
      d30: { newContracts: 12 },
      d60: { newContracts: 32 },
      d90: { newContracts: 69 },
    };
  },
});
