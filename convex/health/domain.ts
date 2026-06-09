export type ContractAggregates = {
  countAtivos: number;
  countPendentes: number;
  sumInsuredCents: number;
  defaultRate: number;
  maxCapacityCents: number;
};

export type TimelinePeriod = {
  activeContracts: number;
  cancelledContracts: number;
  delinquentContracts: number;
};

export type HealthTimeline = {
  d30: TimelinePeriod;
  d60: TimelinePeriod;
  d90: TimelinePeriod;
};

export type TreasurySnapshot = {
  address: string;
  xlmBalance: number;
  brlBalanceCents: number;
  explorerUrl: string;
};
