import { queryWithAuth } from "../lib/auth";
import { getMaxGuaranteeCapacityCents } from "../lib/env";
import type { ContractAggregates, HealthTimeline } from "./domain";

export const getContractAggregates = queryWithAuth({
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

export const getTimeline = queryWithAuth({
  args: {},
  handler: async (): Promise<HealthTimeline> => {
    // Mock counts — replace with real platform-wide aggregates in production (issue #52)
    return {
      d30: { activeContracts: 12, cancelledContracts: 2, delinquentContracts: 1 },
      d60: { activeContracts: 32, cancelledContracts: 5, delinquentContracts: 3 },
      d90: { activeContracts: 69, cancelledContracts: 9, delinquentContracts: 6 },
    };
  },
});
